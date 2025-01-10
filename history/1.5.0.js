/* eslint-disable */
/* eslint-disable no-param-reassign */
import * as acornLoose from 'acorn-loose';
import Fs from 'fs';
import Path from 'path';

const VERSION = '1.5.0';

/**
 * JavaScript Hypertext Preprocessor (JSHypertextPreprocessor) is a preprocessor that handles HTML
 * files with embedded JavaScript, similar to how PHP manages templates. It provides dynamic
 * preprocessing, managing context, variables, and includes while ensuring security and structure,
 * bringing PHP-like templating to JavaScript.
 */
class JSHypertextPreprocessor {

    /** @type {Set<string>} Built-in JavaScript globals that shouldn't be treated as undefined */
    #builtInGlobals = new Set([
        'Array', 'Boolean', 'console', 'Date', 'Error', 'Function', 'Infinity',
        'JSON', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'RegExp', 'String',
        'Symbol', 'undefined', 'BigInt', 'Set', 'Map', 'WeakMap', 'WeakSet',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Intl', 'eval', 'globalThis'
    ]);

    /** @type {Map<string, any>} Stores constant values that cannot be redefined */
    #constants = new Map();

    /** @type {string} Accumulates processed template content */
    #currentBuffer = '';

    /** @type {Map<string, any>} Current variable context for template processing */
    #currentContext = new Map();

    /** @type {string} Current working directory for resolving includes */
    #cwd = '';

    /** @type {Object} Built-in functions available in templates with $ prefix */
    #dollar = {
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
                    this.#currentBuffer += constantError;
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
                this.#currentBuffer += constantError;
            }
        },
        echo: (...args) => {
            const content = args.join('');
            if (this.#htmlOutputBuffer.open) {
                this.#htmlOutputBuffer.value.push(content);
            } else {
                this.#currentBuffer += content;
            }
        },
        include: (file, assignMode = false) => {
            return this.#include(file, assignMode);
        },
        obClose: () => {
            this.#htmlOutputBuffer.open = false;
            return this.#htmlOutputBuffer.value.join('').trim();
        },
        obOpen: () => {
            this.#htmlOutputBuffer.value = [];
            this.#htmlOutputBuffer.open = true;
        },
        obStatus: () => {
            return this.#htmlOutputBuffer.open;
        },
        version: () => {
            return `JHP Version ${VERSION}`;
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

    /** @type {Object} Regular expressions used for parsing and processing */
    #regex = {
        arrowFunction: /([a-zA-Z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>/,
        backtickEscape: /`/g,
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
        functionDeclaration: /function\s+([a-zA-Z_$][\w$]*)/,
        htmlComments: /<!--[\s\S]*?-->/g,
        preprocess: /\$(\w+)/g,
        preTagsAndEmptyLines: /(<pre\b[^>]*>[\s\S]*?<\/pre>)/,
        reassignment: /\b([a-zA-Z_$][\w$]*)\s*=\s*([^;]+);/g,
        templateLiteralEscape: /\$\{/g,
        urlAttributePattern: /(href|src)\s*=\s*["'](\/[^"']*?)["']/g,
        urlWithProtocol: /^(?:http|https|ftp|mailto|tel|data):/i,
        variables: /([a-zA-Z_$][\w$]*)\s*(?:=\s*([^,;]+))?/g
    };

    /** @type {string|null} Relative path for URL resolution */
    #relPath = null;

    /** @type {string} Root directory for file resolution */
    #rootDir = '';

    /**
     * Creates a new JSHypertextPreprocessor instance.
     * @param {Map|Object|null} globalConstants Initial variables and functions for template context
     */
    constructor(globalConstants = null) {
        if (globalConstants) {
            if (globalConstants instanceof Map) {
                this.#initialConstants = globalConstants;
            } else if (typeof globalConstants === 'object') {
                this.#initialConstants = new Map(Object.entries(globalConstants));
            }
        }
    }

    /**
     * Handles file inclusion with path resolution.
     * @param {string} file Path to file to include
     * @returns {string} Processed file content or error message
     * @private
     */
    #include = (file, assignMode = false) => {
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
            this.#currentBuffer = '';

            // Process in isolation
            this.#processFile(resolvedPath);

            // Capture result and restore state
            const result = this.#currentBuffer;
            this.#currentBuffer = prevBuffer;
            this.#cwd = previousCwd;
            return result;
        }

        // Normal include, output directly
        const parsedContent = this.#processFile(resolvedPath);
        this.#cwd = previousCwd;
        return parsedContent;
    };

    /**
     * Checks if code contains potentially dangerous patterns.
     * @param {string} code Code to check
     * @returns {boolean} True if code appears safe
     */
    isCodeGenerallySafe(code) {
        return !this.#regex.dangerousPatterns.some((pattern) => {
            return pattern.test(code);
        });
    }

    /**
     * Perform various preprocessing steps on raw file content.
     * @param {string} code Raw file content to process
     * @returns {string} Preprocessed content with resolved paths and processed scripts
     * @private
     */
    #preprocessFile(code) {
        // Remove all HTML comments first; removes commented out script blocks and shortens the code
        return code.replace(this.#regex.htmlComments, '');
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
        let modifiedCode = '';

        // Track function processing state
        let currentlyProcessingFunction = null;
        let currentBraceDepth = 0;

        // First process the current code to find declarations
        const lines = code.split('\n').map((line) => {
            // Check for function declarations first
            const arrowMatch = line.match(this.#regex.arrowFunction);
            const funcMatch = line.match(this.#regex.functionDeclaration);

            if (arrowMatch || funcMatch) {
                const funcName = arrowMatch ? arrowMatch[1] : funcMatch[1];
                if (!line.includes('{')) {
                    // Single line arrow function
                    return `${line}
                            $.context('${funcName}', ${funcName});`;
                }
                // Start of multiline function, track it but don't add context yet
                currentlyProcessingFunction = funcName;
                currentBraceDepth = 1;
                return line;
            }

            // If we're tracking a function body, count braces
            if (currentlyProcessingFunction) {
                currentBraceDepth += (line.match(/{/g) || []).length;
                currentBraceDepth -= (line.match(/}/g) || []).length;

                if (currentBraceDepth === 0) {
                    // End of function - add context call
                    const funcName = currentlyProcessingFunction;
                    currentlyProcessingFunction = null;
                    return `${line}
                            $.context('${funcName}', ${funcName});`;
                }
                return line;
            }

            // Skip lines that only call $ functions, we already know no declarations are happening
            if (line.trim().startsWith('$')) return line;

            // Process variable declarations and reassignments
            let processedLine = line;
            processedLine = line.replace(this.#regex.declaration, (match, declarationList) => {
                let result = match;
                let varMatch;

                this.#regex.variables.lastIndex = 0;
                while ((varMatch = this.#regex.variables.exec(declarationList)) !== null) {
                    const varName = varMatch[1].trim();

                    // Check if attempting to declare a constant
                    if (this.#constants.has(varName)) {
                        const constValue = this.#constants.get(varName);
                        const valueStr = this.#serializeValue(constValue);
                        result = `$.echo(\`<< Error: Attempt to redeclare defined constant '${varName}'. >>\`);
                                    ${varName} = ${valueStr};`;
                    } else if (!match.startsWith('var')) {
                        // Only track non-var declarations
                        currentDeclarations.add(varName);
                        result += `\n$.context('${varName}', ${varName});`;
                    }
                }

                return result;
            });

            // Add $context calls after every declaration or reassignment
            if (!processedLine.includes('$')) {
                processedLine = processedLine.replace(this.#regex.reassignment, (match, varName) => {
                    // Check if attempting to reassign a constant and if so add the original value instead
                    if (this.#constants.has(varName)) {
                        const constValue = this.#constants.get(varName);
                        const valueStr = this.#serializeValue(constValue);
                        return `$.echo(\`<< Error: Attempt to redeclare defined constant '${varName}'. >>\`);
                                \n${varName} = ${valueStr};`;
                    }

                    // Add the actual $context call
                    if (!match.includes('const ') && !match.includes('let ') && !match.includes('var ')) {
                        currentDeclarations.add(varName);
                        return `${match}\n$.context('${varName}', ${varName});`;
                    }
                    return match;
                });
            }

            return processedLine;
        });

        // Reassemble the modified code (script block)
        modifiedCode = lines.join('\n');

        // Add constants to the inject array first!
        for (const [key, value] of this.#constants.entries()) {
            const valueStr = this.#serializeValue(value);
            injections.push(`const ${key} = ${valueStr};`);
        }

        // Now add all non-redeclared variables to the inject array
        for (const [key, value] of this.#currentContext.entries()) {
            if (!currentDeclarations.has(key)) {
                const valueStr = this.#serializeValue(value);
                injections.push(`var ${key} = ${valueStr};`);
            }
        }

        // Inject the declarations and reassignments before the code first!
        modifiedCode = `${injections.join('\n')}\n${modifiedCode}`;

        // Now walk the script block and make final replacements
        return this.#walkAndReplaceScriptParts(modifiedCode);
    }

    /**
     * Initiates processing of a file with the given relative path and working directory.
     * @param {string} file Path to the file to process
     * @param {string|null} relPath Relative path for URL resolution; devs should predetermine this on the initial call
     * @param {string} cwd Current working directory for file resolution
     * @returns {string} Processed template content
     */
    process(file, relPath = null, cwd = '') {
        // Reset state for new file processing
        this.#constants.clear();
        this.#currentBuffer = '';
        this.#currentContext.clear();
        this.#htmlOutputBuffer.open = false;
        this.#htmlOutputBuffer.value = [];
        this.#includes.clear();
        this.#relPath = relPath;

        // Initialize constants with any provided global constants
        for (const [key, value] of this.#initialConstants.entries()) {
            this.#constants.set(key, value);
        }

        // Determine root directory if not already set
        if (!this.#rootDir) {
            this.#rootDir = cwd || Path.dirname(file);
        }
        this.#cwd = cwd || Path.dirname(file);

        // Process the file and return the result
        this.#processFile(file);
        return this.#postProcessFile(this.#currentBuffer.trim());
    }

    /**
     * Processes a single file by reading its content and processing the template.
     * @param {string} file Path to the file to process
     * @returns {string|undefined} Processed content or error message
     * @private
     */
    #processFile(file) {
        let template;

        try {
            template = Fs.readFileSync(file, 'utf8') || '';
            template = this.#preprocessFile(template);
         
        } catch (err) {
            return `<< Error: Unable to read file ${file} >>`;
        }

        this.#processTemplate(template);
    }

    /**
     * Processes a template string by handling script blocks and HTML content.
     * @param {string} template Template string to process
     * @private
     */
    #processTemplate(template) {
        let lastIndex = 0;
        // We must declare this here to avoid issues with the regex lastIndex property
        const regex = /<script>([\s\S]*?)<\/script>/g;
        let match;

        while ((match = regex.exec(template)) !== null) {
            // Add HTML content before script block to output
            const htmlContent = template.slice(lastIndex, match.index);
            if (this.#htmlOutputBuffer.open) {
                this.#htmlOutputBuffer.value.push(htmlContent);
            } else {
                this.#currentBuffer += htmlContent;
            }

            // Process script block
            let code = this.#tokenReplacement(match[1]);
            try {
                code = this.#preprocessScriptBlock(code);
                console.log(`EXECUTING:\n${code}`);
                const wrapper = new Function('$', `${code}`);
                wrapper(this.#dollar);
            } catch (err) {
                console.error(err);
                this.#currentBuffer += `<< Error: ${err.message}. >>`;
            }

             
            lastIndex = regex.lastIndex;
        }

        // Add remaining HTML content after last script block
        const remainingHtml = template.slice(lastIndex);
        if (this.#htmlOutputBuffer.open) {
            this.#htmlOutputBuffer.value.push(remainingHtml);
        } else {
            this.#currentBuffer += remainingHtml;
        }
    }

    /**
     * Perform various postprocessing steps on raw file content.
     * @param {string} code Final output code to process
     * @returns {string} Processed code with root-relative URLs resolved
     * @private
     */
    #postProcessFile(code) {
        // Process root-relative URLs in the final output
        if (this.#relPath !== null) {
            code = code.replace(this.#regex.urlAttributePattern, (match, attr, url) => {
                // Skip URLs that are protocol-relative or absolute
                if (url.startsWith('//') || this.#regex.urlWithProtocol.test(url)) {
                    return match;
                }
                const relPath = this.#relPath === '' ? './' : this.#relPath;
                return `${attr}="${relPath}${url.slice(1)}"`;
            });
        }

        const segments = code.split(this.#regex.preTagsAndEmptyLines);
        code = segments.map((segment, i) => {
            // Even indices are outside <pre>, odd indices are <pre> blocks
            if (i % 2 === 0) {
                // Remove empty lines from non-pre content
                return segment.split('\n')
                    .filter((line) => { return line.trim(); })
                    .join('\n');
            }
            // Keep <pre> content unchanged
            return segment;
        }).join('');

        return code;
    }

    /**
     * Resolves a file path relative to the current directory or root directory.
     * @param {string} file Path to resolve
     * @param {string} currentDir Current working directory
     * @returns {string|null} Resolved absolute path or null if not found
     * @private
     */
    #resolvePath(file, currentDir) {
        if (Path.isAbsolute(file)) {
            return file;
        }

        // Try resolving relative to current directory
        let resolvedPath = Path.resolve(currentDir, file);
        if (Fs.existsSync(resolvedPath)) {
            return resolvedPath;
        }

        // Fall back to root directory
        resolvedPath = Path.resolve(this.#rootDir, file);
        if (Fs.existsSync(resolvedPath)) {
            return resolvedPath;
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

    /**
     * Walks the AST of a script block and performs various transformations.
     * @param {string} code JavaScript code to analyze
     * @returns {string[]} Array of undefined variable names
     */
    #walkAndReplaceScriptParts(code) {
        // Skip processing if this is not a script block
        if (!code.includes('<script>') &&
            !code.includes('</script>') &&
            (code.includes('<') || code.includes('>'))) {
            return code;
        }

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

         
        } catch (err) {
            return code;
        }
    }

}

export default JSHypertextPreprocessor;
