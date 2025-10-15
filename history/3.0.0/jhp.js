/* eslint-disable max-len */
import * as acornLoose from 'acorn-loose';
import Fs from 'fs';
import Path from 'path';
import Processors from './processors.js';
import { SimpleHtmlParser } from './simple-html-parser.js';

const VERSION = '3.0.0';

/**
 * JavaScript Hypertext Preprocessor (JHP) is a preprocessor that handles HTML files with embedded
 * JavaScript, similar to how PHP manages templates. It provides dynamic preprocessing, managing
 * context, variables, and includes while ensuring security and structure, bringing PHP-like
 * templating to JavaScript.
 * @module JSHypertextPreprocessor
 */
class JSHypertextPreprocessor {

    /** @type {String[]} Reserved function names that cannot be overridden */
    #builtInDollarFunctions = ['context', 'define', 'echo', 'else', 'elseif', 'end', 'if', 'include', 'obClose', 'obOpen', 'obStatus', 'version'];

    /** @type {Set<string>} Built-in JavaScript globals that shouldn't be treated as undefined */
    #builtInGlobals = new Set([
        'Array', 'Boolean', 'console', 'Date', 'Error', 'Function', 'Infinity',
        'JSON', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'RegExp', 'String',
        'Symbol', 'undefined', 'BigInt', 'Set', 'Map', 'WeakMap', 'WeakSet',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Intl', 'eval', 'globalThis'
    ]);

    /** @type {RegExp[]} Compiled dangerous patterns for faster processing */
    #compiledDangerousPatterns = [];

    /** @type {Map<string, any>} Stores constant values that cannot be redefined */
    #constants = new Map();

    /** @type {Array<string>} Accumulates processed template content */
    #currentBuffer = [];

    /** @type {Map<string, any>} Current variable context for template processing */
    #currentContext = new Map();

    /** @type {string} Current working directory for resolving includes */
    #cwd = '';

    /** @type {Object} Built-in functions available in templates with $ prefix */
    #dollar = {
        conditionalScope: () => {
            /**
             * Placeholder for conditional scope, will be overridden by #processTemplate.
             * This allows us to conditionally include blocks based on if/else/elseif conditions.
             */
        },
        context: (key, value) => {
            this.#currentContext.set(key, value);
        },
        define: (key, value) => {
            // Check if the constant has been declared as a variable already
            if (this.#currentContext.has(key)) {
                const constantError = `<< Error: Variable '${key}' already declared, unable to declare as constant. >>`;
                if (this.#htmlOutputBuffer.open) {
                    this.#htmlOutputBuffer.value.push(constantError);
                } else {
                    this.#currentBuffer.push(constantError);
                }
                return;
            }

            // If not already defined, add to constants
            if (!this.#constants.has(key)) {
                this.#constants.set(key, value);
                return;
            }

            // If the value is the same, ignore it (no error)
            if (this.#constants.get(key) === value) {
                return;
            }

            // If the value is different, log an error into the current buffer
            const constantError = `<< Error: Attempted to redeclare defined constant '${key}'. >>`;
            if (this.#htmlOutputBuffer.open) {
                this.#htmlOutputBuffer.value.push(constantError);
            } else {
                this.#currentBuffer.push(constantError);
            }
        },
        echo: (content, conditionalScope) => {
            /**
             * If we are inside a conditional tree check to see if this include is within a block
             * that should be shown. If not, return early and don't process the echo.
             */
            if (conditionalScope !== undefined && !conditionalScope.show()) {
                return;
            }

            if (this.#htmlOutputBuffer.open) {
                this.#htmlOutputBuffer.value.push(content);
            } else {
                this.#currentBuffer.push(content);
            }
        },
        else: (conditionalScope) => {
            conditionalScope.block(true);
        },
        elseif: (result, conditionalScope) => {
            conditionalScope.block(result);
        },
        end(conditionalScope) {
            conditionalScope.block('__END__');
        },
        if: (result, conditionalScope) => {
            conditionalScope.block(result);
        },
        include: (file, conditionalScope, assignMode = false) => {
            return this.#include(file, conditionalScope, assignMode);
        },
        obClose: () => {
            this.#htmlOutputBuffer.open = false;
            return this.#htmlOutputBuffer.value.join().trim();
        },
        obOpen: () => {
            this.#htmlOutputBuffer.value = [];
            this.#htmlOutputBuffer.open = true;
        },
        obStatus: () => {
            return this.#htmlOutputBuffer.open;
        },
        version: () => {
            return this.version();
        }
    };

    /** @type {Object} Manages buffered HTML output for template sections */
    #htmlOutputBuffer = {
        open: false,
        value: []
    };

    /** @type {Map<string, string>} Cache for included files */
    #includes = new Map();

    /** @type {Map<string, any>} Initial context values provided at instantiation */
    #initialConstants = new Map();

    /** @type {String[]} Custom JHP tags to recognize */
    #jhpTags = ['jhp', 's_'];

    /** @type {Set<Function>} Stores pre and post processors for template processing */
    #processors = {
        pre: new Set(),
        post: new Set()
    };

    /** @type {Object} Regular expressions used for parsing and processing */
    #regex = {
        arrowFunction: /([a-zA-Z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>/,
        backtickEscape: /`/g,
        conditionalNoParams: /(\$\.?(?:else|end))\([^)]*\)/,
        conditionalWithParams: /(\$\.?(?:if|echo|elseif|include))\(([^)]*)\)/,
        dangerousPatterns: [
            /Function\s*\(/,
            /Object\.defineProperty/,
            /Object\.setPrototypeOf/,
            /\.\s*exec\s*\(/,
            /__proto__/,
            /child_process/,
            /crypto\.subtle/,
            /dd\s+if=.+/i,
            /del\s+\/s\s+/i,
            /eval\s*\(/,
            /fs\.unlinkSync|fs\.rmdirSync/,
            /fs\.writeFileSync/,
            /import\s*\(/,
            /new\s+Function/,
            /process\.exit/,
            /prototype\s*\[/,
            /require\(.+?\)/,
            /rm\s+-rf?\s+\//i,
            /setInterval\s*\(.*?,.*\)/,
            /setTimeout\s*\(.*?,.*\)/,
            /shutdown\s+\/s/i,
            /sudo\s+.+/i
        ],
        declaration: /\b(?:const|let|var)\s+(.+?);/g,
        fileExtension: /\.\w+$/,
        functionDeclaration: /function\s+([a-zA-Z_$][\w$]*)/,
        osPaths: {
            relative: /^\.{1,2}[\/\\]/,
            unc: /^\\\\/,
            unix: /^\//,
            windows: /^[a-zA-Z]:[\/\\]/
        },
        preprocess: /\$(\w+)/g,
        reassignment: /\b([a-zA-Z_$][\w$]*)\s*=\s*([^;]+);/g,
        regexSpecialCharactersEscape: /[.*+?^${}()|[\]\\]/g,
        templateLiteralEscape: /\$\{/g
    };

    /** @type {string|null} Relative path for URL resolution */
    #relPath = null;

    /** @type {string} Root directory for file resolution */
    #rootDir = null;

    /** @type {Set<Function>} Stores temporary pre and post processors for template processing */
    #tmpProcessors = {
        pre: new Set(),
        post: new Set()
    };

    /**
     * Creates a new JSHypertextPreprocessor instance.
     * @param {Object} options Configuration options for the preprocessor
     * @param {Map|Object|null} options.globalConstants Initial variables and functions for template context
     * @param {Function[]} [options.preProcessors] Array of preprocessor functions to add
     * @param {Function[]} [options.postProcessors] Array of postprocessor functions to add
     * @param {Boolean} [options.registerJhpProcessors] Whether to register built-in JHP processors (default: true)
     * @param {String[]} [options.jhpTags] Array of custom JHP tags to recognize
     * @param {String} [options.rootDir] Root directory for file resolution
     */
    constructor(options = {}) {
        // Merge options with defaults
        const mergedOptions = {
            globalConstants: null,
            jhpTags: ['jhp', 'script', 's_'],
            postProcessors: [],
            preProcessors: [],
            registerJhpProcessors: true,
            rootDir: null,
            ...options
        };

        // Extract specific options
        const {
            globalConstants,
            jhpTags,
            postProcessors,
            preProcessors,
            registerJhpProcessors,
            rootDir
        } = mergedOptions;

        if (globalConstants) {
            if (globalConstants instanceof Map) {
                this.#initialConstants = globalConstants;
            } else if (typeof globalConstants === 'object') {
                this.#initialConstants = new Map(Object.entries(globalConstants));
            }
        }

        // Register built-in JHP processors if enabled
        if (registerJhpProcessors) {
            this.addPreProcessor(Processors.pre);
            this.addPostProcessor(Processors.post);
        }

        // Add provided preProcessors
        this.addPreProcessor(preProcessors);

        // Add provided postProcessors
        this.addPostProcessor(postProcessors);

        // Register provided JHP tag(s)
        if (Array.isArray(jhpTags) && jhpTags.length > 0) {
            this.#jhpTags = jhpTags;
        }

        // Set the root directory for file resolution only if it was explicitly provided
        if (rootDir) {
            this.#rootDir = rootDir;
        }

        // Precompile dangerous patterns for faster processing
        // eslint-disable-next-line no-confusing-arrow
        this.#compiledDangerousPatterns = this.#regex.dangerousPatterns.map((pattern) =>
            // eslint-disable-next-line arrow-body-style
            typeof pattern === 'string' ? new RegExp(pattern) : pattern);
    }

    /**
     * Adds one or more preprocessor functions to the processing pipeline.
     * @param {Function|Function[]} preProcessors Preprocessor function(s) to add
     */
    addPreProcessor(preProcessors) {
        if (Array.isArray(preProcessors)) {
            for (const preProcessor of preProcessors) {
                if (typeof preProcessor === 'function') {
                    this.#processors.pre.add(preProcessor);
                }
            }
        } else if (typeof preProcessors === 'function') {
            this.#processors.pre.add(preProcessors);
        }
    }

    /**
     * Adds one or more postprocessor functions to the processing pipeline.
     * @param {Function|Function[]} postProcessors Postprocessor function(s) to add
     */
    addPostProcessor(postProcessors) {
        if (Array.isArray(postProcessors)) {
            for (const postProcessor of postProcessors) {
                if (typeof postProcessor === 'function') {
                    this.#processors.post.add(postProcessor);
                }
            }
        } else if (typeof postProcessors === 'function') {
            this.#processors.post.add(postProcessors);
        }
    }

    /**
     * Escapes special characters in a string to make it safe for use in a regular expression.
     * @param {string} string String to escape
     * @returns {string} Escaped string
     */
    escapeRegExp(string) {
        return string.replace(this.#regex.regexSpecialCharactersEscape, '\\$&');
    }

    /**
     * Finds the index of the closing parenthesis in a string.
     * @param {string} str String to search
     * @param {number} startPos Starting position to search from
     * @returns {number} Index of the closing parenthesis or -1 if not found
     * @private
     */
    #findClosingParenIndex(str, startPos) {
        let depth = 1;
        for (let i = startPos; i < str.length; i += 1) {
            if (str[i] === '(') {
                depth += 1;
            } else if (str[i] === ')') {
                depth -= 1;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1; // No matching parenthesis found
    }

    /**
     * Handles file inclusion with path resolution.
     * @param {string} file Path to file to include
     * @param {Object} conditionalScope Conditional scope object for if/else/elseif blocks
     * @returns {string} Processed file content or error message
     * @private
     */
    #include = (file, conditionalScope, assignMode = false) => {
        /**
         * If we are inside a conditional tree check to see if this include is within a block that
         * should be shown. If not, return early and don't process the include.
         */
        if (conditionalScope !== undefined && !conditionalScope.show()) {
            return;
        }

        const resolvedPath = this.#resolvePath(file, this.#cwd);
        if (!resolvedPath || resolvedPath === '') {
            const includeError = `<< Error: Unable to resolve include path '${file}' >>`;
            this.#dollar.echo(includeError);
            return includeError;
        }

        const previousCwd = this.#cwd;
        this.#cwd = Path.dirname(resolvedPath);

        if (assignMode) {
            // Save state
            const prevBuffer = this.#currentBuffer;
            this.#currentBuffer = [];

            // Process in isolation
            this.#processFile(resolvedPath);

            // Capture result and restore state
            const result = this.#currentBuffer;
            this.#currentBuffer = prevBuffer;
            this.#cwd = previousCwd;
            return result.join('');
        }

        // Normal include, output directly
        this.#processFile(resolvedPath);
        this.#cwd = previousCwd;
    };

    /**
     * Checks if code contains potentially dangerous patterns.
     * @param {string} code Code to check
     * @returns {boolean} True if code appears safe
     */
    isCodeGenerallySafe(code) {
        return !this.#compiledDangerousPatterns.some((pattern) => { return pattern.test(code); });
    }

    /**
     * Ultra-fast detector to determine if a string is code or a file path
     * @param {string} fileOrCode - The string to analyze
     * @return {boolean} - Returns true if input is code, false if it's likely a path
     */
    isCodeNotPath(fileOrCode) {
        // Empty check
        if (!fileOrCode) {
            return true;
        }

        // Guaranteed code indicators
        if (fileOrCode.includes('{') ||
            fileOrCode.includes('}') ||
            fileOrCode.includes('<') ||
            fileOrCode.includes('>') ||
            fileOrCode.includes(';')) {
            return true;
        }

        // If the string has path separators and ends with a file extension it's likely a path
        if (this.#regex.fileExtension.test(fileOrCode) && (fileOrCode.includes('/') || fileOrCode.includes('\\'))) {
            return false;
        }

        // Common path starting patterns indicate a path
        if (this.#regex.osPaths.windows.test(fileOrCode)  || // Windows drive
            this.#regex.osPaths.unix.test(fileOrCode)     || // Unix root
            this.#regex.osPaths.relative.test(fileOrCode) || // Relative
            this.#regex.osPaths.unc.test(fileOrCode)) {      // UNC
            return false;
        }

        // Default to code for anything unclear
        return true;
    }

    /**
     * Parses variable declarations from a declaration statement using AST parsing
     * to properly handle string literals and avoid false positive variable names.
     * This replaces the problematic regex-based approach that incorrectly identified
     * words inside string values as variable names.
     *
     * @param {string} declarationStatement - The variable declaration statement (e.g., "a = 'hello', b = 42")
     * @returns {Array<{name: string, value: string|null}>} Array of variable objects with name and value properties
     * @private
     */
    #parseVariableDeclarations(declarationStatement) {
        const variables = [];

        try {
            // Create a complete declaration statement for parsing
            // We need to add a declaration keyword since the input is just the assignment part
            const fullStatement = `var ${declarationStatement}`;

            // Parse the statement using acornLoose for fault tolerance
            const ast = acornLoose.parse(fullStatement, {
                ecmaVersion: 2020,
                sourceType: 'script',
                allowReturnOutsideFunction: true,
                allowImportExportEverywhere: true
            });

            // Walk the AST to find variable declarations
            this.#walkVariableDeclarations(ast, variables);

        } catch (err) {
            // If AST parsing fails, fall back to a safer approach
            // This handles cases where the declaration might be malformed
            console.warn(`Failed to parse variable declaration: ${declarationStatement}`, err);

            // Try a simple fallback: just extract the first identifier before '='
            const simpleMatch = declarationStatement.match(/^\s*([a-zA-Z_$][\w$]*)\s*=/);
            if (simpleMatch) {
                variables.push({
                    name: simpleMatch[1].trim(),
                    value: '' // We can't safely extract the value without proper parsing
                });
            }
        }

        return variables;
    }

    /**
     * Perform various preprocessing steps on the parsed HTML DOM structure.
     * @param {Node} dom Parsed HTML DOM structure.
     * @private
     */
    #preprocessFile(dom) {
        for (const processor of this.#tmpProcessors.pre) {
            processor({
                cwd: this.#cwd,
                dom,
                relPath: this.#relPath
            });
        }
        for (const processor of this.#processors.pre) {
            processor({
                cwd: this.#cwd,
                dom,
                relPath: this.#relPath
            });
        }
    }

    /**
     * Processes code to capture variable declarations and handle context, including constant protection.
     * @param {string} code JavaScript code to process
     * @returns {string} Modified code with context handling and constant protection
     * @private
     */
    #preprocessScriptBlock(code) {
        const currentDeclarations = new Set();
        const injections = [];
        let currentlyProcessingFunction = null;
        let currentBraceDepth = 0;
        const contextVarSet = new Set(this.#currentContext.keys());

        // Process the code line by line
        const lines = code.split('\n').map((line) => {
            // Function declarations handling
            const arrowMatch = line.match(this.#regex.arrowFunction);
            const funcMatch = line.match(this.#regex.functionDeclaration);

            if (arrowMatch || funcMatch) {
                const funcName = arrowMatch ? arrowMatch[1] : funcMatch[1];
                if (!line.includes('{')) {
                    return `${line}\n$.context('${funcName}', ${funcName});`;
                }
                currentlyProcessingFunction = funcName;
                currentBraceDepth = 1;
                return line;
            }

            if (currentlyProcessingFunction) {
                currentBraceDepth += (line.match(/{/g) || []).length;
                currentBraceDepth -= (line.match(/}/g) || []).length;

                if (currentBraceDepth === 0) {
                    const funcName = currentlyProcessingFunction;
                    currentlyProcessingFunction = null;
                    return `${line}\n$.context('${funcName}', ${funcName});`;
                }
                return line;
            }

            // Handle conditional scope injections
            let processedLine = line;

            // Handle $ function calls with conditionalScope
            if (line.trim().startsWith('$')) {
                // Handle else and end - replace with just the scope parameter
                if (this.#regex.conditionalNoParams.test(line)) {
                    return line.replace(this.#regex.conditionalNoParams, '$1($.conditionalScope)');
                }

                // Handle if, elseif, echo and include with proper parameter parsing
                const match = line.match(/(\$\.?(?:if|echo|elseif|include))\(/);
                if (match) {
                    const functionStart = match.index;
                    const paramsStart = functionStart + match[0].length;
                    const closingParenIndex = this.#findClosingParenIndex(line, paramsStart);

                    if (closingParenIndex !== -1) {
                        const params = line.substring(paramsStart, closingParenIndex);
                        const functionName = match[1];
                        return `${line.substring(0, functionStart) +
                            functionName}(${params}, $.conditionalScope)${
                            line.substring(closingParenIndex + 1)}`;
                    }
                }

                return line;
            }

            // Process variable declarations
            processedLine = line.replace(this.#regex.declaration, (match, declarationList) => {
                let result = match;

                // Use AST-based parsing instead of regex to properly handle string literals
                const variables = this.#parseVariableDeclarations(declarationList);

                for (const variable of variables) {
                    const varName = variable.name;

                    if (this.#constants.has(varName)) {
                        const constValue = this.#constants.get(varName);
                        const valueStr = this.#serializeValue(constValue);
                        result = `$.echo(\`<< Error: Attempt to redeclare defined constant '${varName}'. >>\`);
                                ${varName} = ${valueStr};`;
                    } else if (!match.startsWith('var')) {
                        currentDeclarations.add(varName);
                        result += `\n$.context('${varName}', ${varName});`;
                    }
                }

                return result;
            });

            // Handle reassignments
            if (!processedLine.includes('$')) {
                processedLine = processedLine.replace(this.#regex.reassignment, (match, varName) => {
                    if (this.#constants.has(varName)) {
                        const constValue = this.#constants.get(varName);
                        const valueStr = this.#serializeValue(constValue);
                        return `$.echo(\`<< Error: Attempt to redeclare defined constant '${varName}'. >>\`);
                                \n${varName} = ${valueStr};`;
                    }

                    if (!match.includes('const ') && !match.includes('let ') && !match.includes('var ')) {
                        currentDeclarations.add(varName);
                        return `${match}\n$.context('${varName}', ${varName});`;
                    }
                    return match;
                });
            }

            return processedLine;
        });

        // Add constants to injections
        for (const [key, value] of this.#constants.entries()) {
            const valueStr = this.#serializeValue(value);
            injections.push(`const ${key} = ${valueStr};`);
        }

        // Add context variables to injections
        for (const [key, value] of this.#currentContext.entries()) {
            const valueStr = this.#serializeValue(value);
            injections.push(`var ${key} = ${valueStr};`);
        }

        // Join code and apply single-pass transformation
        let modifiedCode = lines.join('\n');

        // Apply single-pass transformation for redeclarations
        if (contextVarSet.size > 0) {
            const varNames = Array.from(contextVarSet).map((name) => { return this.escapeRegExp(name); }).join('|');
            const declPattern = new RegExp(`\\b(const|let)\\s+(${varNames})\\b`, 'g');
            modifiedCode = modifiedCode.replace(declPattern, (match, declType, varName) => { return varName; });
        }

        // Final transformations
        modifiedCode = this.#walkAndReplaceScriptParts(`${injections.join('\n')}\n${modifiedCode}`);
        return modifiedCode;
    }

    /**
     * Initiates processing of a code string or file with the given options.
     * @param {string} fileOrCode Code to process or the path to the file to process
     * @param {Object} [options] Configuration options for processing
     * @param {Object} [options.context] Initial variables and functions for template context
     * @param {string|null} [options.relPath] Relative path for URL resolution; devs should predetermine this on the initial call
     * @param {string} [options.cwd] Current working directory for file resolution; devs should predetermine this on the initial call
     * @param {Object} [options.processors] Pre and post processors for template processing
     * @param {Function[]} [options.processors.pre] Array of preprocessor functions to add
     * @param {Function[]} [options.processors.post] Array of postprocessor functions to add
     * @returns {string} Processed template content
     */
    process(fileOrCode, options = {}) {
        // Merge options with defaults
        const mergedOptions = {
            context: {},
            cwd: null,
            processors: { pre: [], post: [] },
            relPath: null,
            ...options
        };

        // Extract specific options
        const {
            context,
            cwd,
            processors,
            relPath
        } = mergedOptions;

        // Reset state for new file processing
        this.#constants.clear();
        this.#currentBuffer = [];
        this.#currentContext.clear();
        this.#htmlOutputBuffer.open = false;
        this.#htmlOutputBuffer.value = [];
        this.#includes.clear();
        this.#relPath = relPath;
        this.#tmpProcessors.post.clear();
        this.#tmpProcessors.pre.clear();

        // Set the current context if provided
        if (context) {
            if (context instanceof Map) {
                this.#currentContext = context;
            } else if (typeof context === 'object') {
                this.#currentContext = new Map(Object.entries(context));
            }
        }

        // Add temporary processors if provided
        for (const processor of processors.pre) {
            this.#tmpProcessors.pre.add(processor);
        }
        for (const processor of processors.post) {
            this.#tmpProcessors.post.add(processor);
        }

        // Initialize constants with any provided global constants
        for (const [key, value] of this.#initialConstants.entries()) {
            this.#constants.set(key, value);
        }

        // Determine root directory if its not already set
        const inputIsCodeNotAPath = this.isCodeNotPath(fileOrCode);
        if (inputIsCodeNotAPath) {
            if (!this.#rootDir) {
                this.#rootDir = cwd || process.cwd();
            }
            this.#cwd = cwd || process.cwd();
        } else {
            if (!this.#rootDir) {
                this.#rootDir = cwd || Path.dirname(fileOrCode);
            }
            this.#cwd = cwd || Path.dirname(fileOrCode);
        }

        // Process the code or file into the buffer
        this.#processFile(fileOrCode, inputIsCodeNotAPath);

        // Get a new parser instance
        const parser = new SimpleHtmlParser(this.#jhpTags);

        // Parse the buffer and post-process the DOM
        const dom = parser.parse(this.#currentBuffer.join('').trim());
        this.#postProcessFile(dom);
        return dom.toHtml();
    }

    /**
     * Processes a single file by parsing it into a DOM and processing the template.
     * @param {string} fileOrCode Path to the file to process
     * @returns {string|undefined} Processed content or error message
     * @private
     */
    #processFile(fileOrCode, isCodeNotPath = undefined) {
        if (isCodeNotPath === undefined) {
            // eslint-disable-next-line no-param-reassign
            isCodeNotPath = this.isCodeNotPath(fileOrCode);
        }

        const parser = new SimpleHtmlParser(this.#jhpTags);
        const scriptTags = parser.getSpecialTags();

        try {
            let templateText = fileOrCode;
            if (!isCodeNotPath) {
                templateText = Fs.readFileSync(fileOrCode, 'utf8') || '';
            }
            const dom = parser.parse(templateText);
            this.#preprocessFile(dom);
            this.#processTemplate(dom.toHtml(), scriptTags);
        } catch (err) {
            return `<< Error: Unable to read file ${fileOrCode}: ${err.message} >>`;
        }
    }

    /**
     * Processes a template string by handling script blocks and HTML content.
     * @param {string} template Template string to process
     * @param {String[]} tags Array of possible script tags
     * @private
     */
    #processTemplate(template, tags) {
        let lastIndex = 0;

        // Create a regex pattern that matches any of the tags
        const tagPattern = tags.map((tag) => { return this.escapeRegExp(tag); }).join('|');

        // We must declare this here to avoid issues with the regex lastIndex property
        const regex = new RegExp(`<(${tagPattern})>([\\s\\S]*?)<\\/\\1>`, 'g');
        let match;

        let addBlockContentToBuffer = true;
        let blockHasBeenShown = false;
        let conditionalBlockOpen = false;

        const conditionalScope = {
            block: (result) => {
                // If the end block is reached, reset the output flags
                if (result === '__END__') {
                    addBlockContentToBuffer = true;
                    blockHasBeenShown = false;
                    conditionalBlockOpen = false;
                    return;
                }

                // If a block has already been shown, no others should be shown
                if (blockHasBeenShown) {
                    addBlockContentToBuffer = false;
                    return;
                }

                // If no black has been shown, only show if the result is true
                if (!result) {
                    addBlockContentToBuffer = false;
                    return;
                }

                // This block passed, so show it change the output flags
                addBlockContentToBuffer = true;
                blockHasBeenShown = true;
                conditionalBlockOpen = true;
            },
            show: () => {
                return addBlockContentToBuffer;
            }
        };

        while ((match = regex.exec(template)) !== null) {
            // Add HTML content before script block to output; contingent on conditional state
            if (addBlockContentToBuffer) {
                const htmlContent = template.slice(lastIndex, match.index);
                if (this.#htmlOutputBuffer.open) {
                    this.#htmlOutputBuffer.value.push(htmlContent);
                } else {
                    this.#currentBuffer.push(htmlContent);
                }
            }

            // Process script block
            let code = this.#tokenReplacement(match[2]);
            try {
                code = this.#preprocessScriptBlock(code);
                const wrapper = new Function('$', `${code}`);
                wrapper({ ...this.#dollar, conditionalScope });
            } catch (err) {
                console.error(err);
                this.#currentBuffer.push(`<< Error: ${err.message}. >>`);
            }

            // eslint-disable-next-line prefer-destructuring
            lastIndex = regex.lastIndex;
        }

        if (conditionalBlockOpen) {
            this.#currentBuffer.push('<< Error: Unclosed conditional block detected. >>');
        }

        // Add remaining HTML content after last script block
        const remainingHtml = template.slice(lastIndex);
        if (this.#htmlOutputBuffer.open) {
            this.#htmlOutputBuffer.value.push(remainingHtml);
        } else {
            this.#currentBuffer.push(remainingHtml);
        }

        /*
        This is as close as I could get to using the DOM structure for processing
        but it's not working as expected. I'll revisit this later to see if I can
        get it to work properly. The issue we need process the node in order but
        if a script tag is not at the root of an element, we don't see it and
        toHtml just returns the inner content.

        for (const node of dom.children) {
            if (!node.scriptBlock) {
                // Process HTML content
                if (this.#htmlOutputBuffer.open) {
                    this.#htmlOutputBuffer.value.push(node.toHtml());
                } else {
                    this.#currentBuffer += node.toHtml();
                }
                continue;
            }

            // Remove script blocks from the DOM; both open and close tags
            node.remove();

            if (node.type === 'tag-close') {
                continue;
            }

            // Process script
            let scriptContent = node.innerHtml();
            try {
                scriptContent = this.#tokenReplacement(scriptContent);
                scriptContent = this.#preprocessScriptBlock(scriptContent);

                // Check for potentially unsafe code and skip processing if found
                if (!this.isCodeGenerallySafe(scriptContent)) {
                    this.#currentBuffer += `<< Error: Potentially unsafe code detected. >>`;
                    continue;
                }

                const wrapper = new Function('$', `${scriptContent}`);
                wrapper(this.#dollar);
            } catch (err) {
                // Log errors and continue processing
                console.error(err);
                this.#currentBuffer += `<< Error: ${err.message}. >>`;
            }
        }
        */
    }

    /**
     * Perform various postprocessing steps on the DOM.
     * @param {Node} dom The DOM to process
     * @private
     */
    #postProcessFile(dom) {
        for (const processor of this.#tmpProcessors.post) {
            processor({
                cwd: this.#cwd,
                dom,
                relPath: this.#relPath
            });
        }
        for (const processor of this.#processors.post) {
            processor({
                cwd: this.#cwd,
                dom,
                relPath: this.#relPath
            });
        }
    }

    /**
     * Registers a new function to be available in templates with a $ prefix.
     * @param {string} name Name of the function
     * @param {*} value The value to assign to this property; commonly a function or object
     * @throws {Error} If the function name is reserved and cannot be overridden
     */
    registerDollarProperty(name, value) {
        // Block attempts to overwrite built-in functions
        if (this.#builtInDollarFunctions.includes(name)) {
            throw new Error(`<< Error: Function name '${name}' is reserved and cannot be overridden. >>`);
        };

        // If thisContext is provided, bind the function to it
        this.#dollar[name] = value;
    }

    /**
     * Resolves a file path relative to the current directory or root directory.
     * @param {string} file Path to resolve
     * @param {string} currentDir Current working directory
     * @returns {string|null} Resolved absolute path or null if not found
     * @private
     */
    #resolvePath(file, currentDir) {
        // Check if it's a root-relative path (starts with /)
        if (file.startsWith('/')) {
            // Remove the leading slash and resolve from the root directory
            const relativeToRoot = file.substring(1);
            const resolvedPath = Path.resolve(this.#rootDir, relativeToRoot);

            if (Fs.existsSync(resolvedPath)) {
                return resolvedPath;
            }
            return null;
        }

        // If it's already an absolute path, return it directly
        if (Path.isAbsolute(file)) {
            return Fs.existsSync(file) ? file : null;
        }

        // Try resolving relative to current directory
        let resolvedPath = Path.resolve(currentDir, file);
        if (Fs.existsSync(resolvedPath)) {
            return resolvedPath;
        }

        // Fall back to root directory
        if (this.#rootDir !== currentDir) {
            resolvedPath = Path.resolve(this.#rootDir, file);
            if (Fs.existsSync(resolvedPath)) {
                return resolvedPath;
            }
        }

        return null;
    }

    /**
     * Safely serialize any JavaScript value for injection into code
     * @param {any} value Value to serialize
     * @returns {string} Serialized value safe for code injection
     * @private
     */
    #serializeValue(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';

        switch (typeof value) {
            case 'string':
                return `\`${value.replace(this.#regex.backtickEscape, '\\`').replace(this.#regex.templateLiteralEscape, '\\${')}\``;
            case 'number':
            case 'boolean':
            case 'bigint':
                return value.toString();
            case 'function':
                return value.toString();
            case 'symbol':
                return value.toString();
            case 'object':
                if (Array.isArray(value)) {
                    return `[${value.map((item) => { return this.#serializeValue(item); }).join(', ')}]`;
                }
                if (value instanceof Date) {
                    return `new Date(${value.getTime()})`;
                }
                if (value instanceof RegExp) {
                    return value.toString();
                }
                // Handle plain objects
                return `{${Object.entries(value)
                    .map(([key, val]) => { return `${JSON.stringify(key)}: ${this.#serializeValue(val)}`; })
                    .join(', ')}}`;
            default:
                return 'undefined';
        }
    }

    /**
     * Replaces $ tokens with their corresponding function calls.
     * @param {string} code Code containing $ tokens
     * @returns {string} Processed code
     * @private
     */
    #tokenReplacement(code) {
        return code.replace(this.#regex.preprocess, (match, key) => {
            return key in this.#dollar ? `$.${key}` : match;
        });
    }

    version() {
        return `JHP v${VERSION}`;
    }

    /**
     * Walks the AST of a script block and performs various transformations.
     * @param {string} code JavaScript code to analyze
     * @returns {string[]} Array of undefined variable names
     */
    #walkAndReplaceScriptParts(code) {
        /** Skip processing if this is not a script block
         * @deprecated
        if (!code.includes('<script>') &&
            !code.includes('</script>') &&
            (code.includes('<') || code.includes('>'))) {
            return code;
        }
         */

        try {
            // Track declared and used variables
            const declaredVars = new Set();
            const usedVars = new Set();

            // Track locations of transformations for later application
            const transformations = [];

            const ast = acornLoose.parse(code, {
                ecmaVersion: 2020,
                sourceType: 'script',
                allowReturnOutsideFunction: true,
                allowImportExportEverywhere: true,
                allowAwaitOutsideFunction: true,
                onComment: (_, __, start, end) => {
                    transformations.push([start, end, '']);
                }
            });

            function walk(node, parent = null) {
                if (!node || typeof node !== 'object') return;

                // Don't process identifiers inside arrays
                if (parent?.type === 'ArrayExpression') {
                    return;
                }

                // Handle let/const to var conversion
                if (node.type === 'VariableDeclaration' && (node.kind === 'const' || node.kind === 'let')) {
                    transformations.push([node.start, node.start + node.kind.length, 'var']);
                }

                // Handle includes in assignments
                if ((node.type === 'VariableDeclarator' || node.type === 'AssignmentExpression') &&
                    node.init?.type === 'CallExpression' &&
                    node.init.callee?.type === 'MemberExpression' &&
                    node.init.callee.object?.name === '$' &&
                    node.init.callee.property?.name === 'include') {
                    // Add the true parameter before the closing parenthesis
                    transformations.push([node.init.end - 1, node.init.end - 1, ', true']);
                }

                // Rest of the existing walk logic
                if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
                    declaredVars.add(node.id.name);
                }

                if (node.type === 'Identifier' && parent &&
                    node.name !== 'undefined' &&
                    !(parent.type === 'MemberExpression' && parent.property === node) &&
                    !(parent.type === 'Property' && parent.key === node)) {
                    usedVars.add(node.name);
                }

                for (const key in node) {
                    const child = node[key];
                    if (Array.isArray(child)) {
                        child.forEach((c) => { walk(c, node); });
                    } else if (child && typeof child === 'object') {
                        walk(child, node);
                    }
                }
            }

            walk(ast);

            // Considered $-prefixed variables as declared
            for (const varName of usedVars) {
                if (varName.startsWith('$')) declaredVars.add(varName);
            }

            // Add undefined variable declarations
            const undefinedVars = Array.from(usedVars)
                .filter((name) => {
                    return !declaredVars.has(name) &&
                           !this.#builtInGlobals.has(name) &&
                           !this.#currentContext.has(name);
                });

            undefinedVars.forEach((name) => {
                if (!this.#constants.has(name)) {
                    transformations.push([0, 0, `var ${name} = \`<< Undefined: ${name} >>\`;\n`]);
                }
            });

            // Apply transformations in reverse order to avoid index shift issues
            return transformations
                .sort((a, b) => { return b[0] - a[0]; })

                .reduce((code, [start, end, replacement]) => { return code.slice(0, start) + replacement + code.slice(end); }, code);

        // eslint-disable-next-line no-unused-vars
        } catch (err) {
            return code;
        }
    }

    /**
     * Recursively walks an AST node to extract variable declarations.
     * This helper method identifies VariableDeclarator nodes and extracts
     * the variable names and their initial values.
     *
     * @param {Object} node - AST node to walk
     * @param {Array} variables - Array to accumulate found variables
     * @private
     */
    #walkVariableDeclarations(node, variables) {
        if (!node || typeof node !== 'object') {
            return;
        }

        // Handle VariableDeclarator nodes (the actual variable assignments)
        if (node.type === 'VariableDeclarator') {
            if (node.id && node.id.type === 'Identifier') {
                const varName = node.id.name;
                let varValue = null;

                // Extract the initial value if present
                if (node.init) {
                    // Get the raw source text for the initial value
                    // This preserves the original formatting and handles complex expressions
                    if (node.init.raw !== undefined) {
                        varValue = node.init.raw;
                    } else if (node.init.type === 'Literal') {
                        varValue = JSON.stringify(node.init.value);
                    } else {
                        // For complex expressions, we'll set to null
                        // The original code didn't handle complex expressions anyway
                        varValue = null;
                    }
                }

                variables.push({
                    name: varName,
                    value: varValue
                });
            }
        }

        // Recursively walk child nodes
        for (const key in node) {
            const child = node[key];
            if (Array.isArray(child)) {
                child.forEach((childNode) => { return this.#walkVariableDeclarations(childNode, variables); });
            } else if (child && typeof child === 'object') {
                this.#walkVariableDeclarations(child, variables);
            }
        }
    }

}

export default JSHypertextPreprocessor;
