import * as acorn from 'acorn-loose';
import Fs from 'fs';
import Path from 'path';
import { WhatIs } from './helpers.js';

const VERSION = '1.0.0';

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
            let displayValue = value;
            if (typeof value === 'string' && value.length >= 100) {
                displayValue = value.substring(0, 97) + '...';
            }
            this.#currentContext.set(key, value);
        },
        default: (key, value) => {
            if (!this.#currentContext.has(key)) {
                this.#currentContext.set(key, value);
            }
        },
        define: (key, value) => {
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
        include: (file) => {
            return this.#include(file);
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
    #initialContext = new Map();
    
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
        defaultCalls: /\$default\s*\(\s*['"](\w+)['"]\s*,\s*((?:[^)]|\n)*)\)/,
        functionDeclaration: /function\s+([a-zA-Z_$][\w$]*)/,
        jsBlock: /<script>([\s\S]*?)<\/script>/g,
        preprocess: /\$(\w+)/g,
        reassignment: /\b([a-zA-Z_$][\w$]*)\s*=\s*([^;]+);/g,
        templateLiteralEscape: /\$\{/g,
        variables: /([a-zA-Z_$][\w$]*)\s*(?:=\s*([^,;]+))?/g
    };

    /** @type {string|null} Relative path for URL resolution */
    #relPath = null;

    /** @type {string} Root directory for file resolution */
    #rootDir = '';

    /**
     * Creates a new JSHypertextPreprocessor instance.
     * @param {Map|Object|null} initialContext Initial variables and functions for template context
     */
    constructor(initialContext = null) {
        if (initialContext) {
            switch(WhatIs(initialContext)) {
                case 'map':
                    this.#initialContext = initialContext;
                    break;
                case 'object':
                    this.#initialContext = new Map(Object.entries(initialContext));
                    break;
            }
        }
    }

    /**
     * Processes code to capture variable declarations and handle context, including constant protection.
     * @param {string} code JavaScript code to process
     * @returns {string} Modified code with context handling and constant protection
     * @private
     */
    #captureDeclarations(code) {
        const currentDeclarations = new Set();
        let modifiedCode = '';
        
        // Track function processing state
        let currentlyProcessingFunction = null;
        let currentBraceDepth = 0;
        
        // First process the current code to find declarations
        const lines = code.split('\n').map(line => {
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
                // Start of multiline function - track it but don't add context yet
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
     
            // Handle $default calls
            if (line.trim().startsWith('$default')) {
                const defaultMatch = line.match(this.#regex.defaultCalls);
                if (defaultMatch) {
                    const [_, varName, defaultValue] = defaultMatch;
                    
                    // Check if attempting to default a constant
                    if (this.#constants.has(varName)) {
                        const constValue = this.#constants.get(varName);
                        const valueStr = typeof constValue === 'string' 
                            ? `\`${constValue.replace(this.#regex.backtickEscape, '\\`').replace(this.#regex.templateLiteralEscape, '\\${')}\``
                            : constValue;
                        return `$.echo(\`<< Error: Attempted to redeclare defined constant '${varName}'. >>\`);
                                ${varName} = ${valueStr};`;
                    }
                    
                    // Check if the variable exists in current context
                    if (this.#currentContext.has(varName)) {
                        const existingValue = this.#currentContext.get(varName);
                        const valueStr = typeof existingValue === 'string' 
                            ? `\`${existingValue.replace(this.#regex.backtickEscape, '\\`').replace(this.#regex.templateLiteralEscape, '\\${')}\``
                            : existingValue;
                        return `${varName} = ${valueStr};`;
                    } else {
                        currentDeclarations.add(varName);
                        return `var ${varName} = ${defaultValue};
                                $.context('${varName}', ${varName});`;
                    }
                }
                return line;
            }
     
            if (line.trim().startsWith('$')) return line;
            
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
                        const valueStr = typeof constValue === 'string' 
                            ? `\`${constValue.replace(this.#regex.backtickEscape, '\\`').replace(this.#regex.templateLiteralEscape, '\\${')}\``
                            : constValue;
                        result = `$.echo(\`<< Error: Attempt to redeclare defined constant '${varName}'. >>\`);
                                 ${varName} = ${valueStr};`;
                    } else if (!match.startsWith('var')) {  // Only track non-var declarations
                        currentDeclarations.add(varName);
                        result += `\n$.context('${varName}', ${varName});`;
                    }
                }
                
                return result;
            });
            
            if (!processedLine.includes('$')) {
                processedLine = processedLine.replace(this.#regex.reassignment, (match, varName) => {
                    // Check if attempting to reassign a constant
                    if (this.#constants.has(varName)) {
                        const constValue = this.#constants.get(varName);
                        const valueStr = typeof constValue === 'string' 
                            ? `\`${constValue.replace(this.#regex.backtickEscape, '\\`').replace(this.#regex.templateLiteralEscape, '\\${')}\``
                            : constValue;
                        return `$.echo(\`<< Error: Attempt to redeclare defined constant '${varName}'. >>\`);
                                ${varName} = ${valueStr};`;
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
        
        modifiedCode = lines.join('\n');
     
        // Then inject only non-redeclared context variables
        const injections = [];
        for (const [key, value] of this.#currentContext.entries()) {
            if (!currentDeclarations.has(key)) {
                const valueStr = typeof value === 'string' 
                    ? `\`${value.replace(this.#regex.backtickEscape, '\\`').replace(this.#regex.templateLiteralEscape, '\\${')}\``
                    : value;
                injections.push(`let ${key} = ${valueStr};`);
            }
        }
     
        // Inject constants first
        for (const [key, value] of this.#constants.entries()) {
            const valueStr = typeof value === 'string' 
                ? `\`${value.replace(this.#regex.backtickEscape, '\\`').replace(this.#regex.templateLiteralEscape, '\\${')}\``
                : value;
            injections.unshift(`let ${key} = ${valueStr};`);
        }
        
        modifiedCode = injections.join('\n') + '\n' + modifiedCode;
     
        // Find and inject any undefined variables
        this.findUndefinedVariables(modifiedCode).forEach((varName) => { 
            if (!this.#constants.has(varName)) {
                modifiedCode = `let ${varName} = \`<< ${varName}:undefined >>\`;\n${modifiedCode}`;
            }
        });
        
        return modifiedCode;
    }

    /**
     * Analyzes code to find undefined variables.
     * @param {string} code JavaScript code to analyze
     * @returns {string[]} Array of undefined variable names
     */
    findUndefinedVariables(code) {
        // Skip analysis for pure HTML content
        if (!code.includes('<script>') && 
            !code.includes('</script>') && 
            (code.includes('<') || code.includes('>'))) {
            return [];
        }
    
        const declaredVars = new Set();
        const usedVars = new Set();
    
        try {
            const ast = acorn.parse(code, { 
                ecmaVersion: 2020,
                sourceType: 'script',
                allowReserved: true,
                allowReturnOutsideFunction: true,
                allowImportExportEverywhere: true,
                allowAwaitOutsideFunction: true,
                allowHashBang: true
            });
    
            /**
             * Recursively walks the AST to collect variable usage
             * @param {Object} node Current AST node
             * @param {Object|null} parent Parent AST node
             */
            function walk(node, parent = null) {
                if (!node || typeof node !== 'object') return;
    
                switch (node.type) {
                    case 'VariableDeclarator':
                        if (node.id && node.id.type === 'Identifier') {
                            declaredVars.add(node.id.name);
                        }
                        break;
    
                    case 'FunctionDeclaration':
                    case 'FunctionExpression':
                    case 'ArrowFunctionExpression':
                        if (node.params) {
                            node.params.forEach((param) => {
                                if (param && param.type === 'Identifier') {
                                    declaredVars.add(param.name);
                                }
                            });
                        }
                        break;
    
                    case 'Identifier':
                        if (parent && 
                            node.name !== 'undefined' &&
                            !(parent.type === 'MemberExpression' && parent.property === node) &&
                            !(parent.type === 'Property' && parent.key === node) &&
                            !(parent.type === 'MethodDefinition') &&
                            !(parent.type === 'LabeledStatement') &&
                            !(parent.type === 'BreakStatement') &&
                            !(parent.type === 'ContinueStatement')) {
                            usedVars.add(node.name);
                        }
                        break;
                }
    
                // Walk child nodes
                for (const key in node) {
                    const child = node[key];
                    if (Array.isArray(child)) {
                        child.forEach((c) => walk(c, node));
                    } else if (typeof child === 'object' && child !== null) {
                        walk(child, node);
                    }
                }
            }
    
            walk(ast);
    
            // Treat $-prefixed variables as declared
            for (const varName of usedVars) {
                if (varName.startsWith('$')) {
                    declaredVars.add(varName);
                }
            }
    
            return Array.from(usedVars).filter(
                (varName) => !declaredVars.has(varName) && 
                             !this.#builtInGlobals.has(varName) &&
                             !this.#currentContext.has(varName)
            );
        } catch (err) {
            return [];
        }
    }

    /**
     * Handles file inclusion with path resolution.
     * @param {string} file Path to file to include
     * @returns {string} Processed file content or error message
     * @private
     */
    #include = (file) => {
        const resolvedPath = this.#resolvePath(file, this.#cwd);

        if (!resolvedPath) {
            return `<< Error: Unable to resolve path for include: ${file} >>`;
        }
        
        const previousCwd = this.#cwd;
        this.#cwd = Path.dirname(resolvedPath);
        
        const parsedContent = this.#processFile(resolvedPath);
        
        this.#cwd = previousCwd;
        
        return parsedContent;
    };

    /**
     * Checks if code contains potentially dangerous patterns.
     * @param {string} code Code to check
     * @returns {boolean} True if code appears safe
     */
    isSafeCode(code) {
        return !this.#regex.dangerousPatterns.some((pattern) => pattern.test(code));
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
     * Preprocesses file content by parsing HTML and script sections while handling
     * strings, comments, and tags appropriately.
     * @param {string} code Raw file content to process
     * @returns {string} Preprocessed content with resolved paths and processed scripts
     * @private
     */
    #preprocessFile(code) {
        const result = [];
        let i = 0;
        const len = code.length;
    
        // Parser state tracking variables
        let inString = false;        // Inside a JavaScript string literal
        let stringChar = '';         // Current string delimiter (' or " or `)
        let inMultiComment = false;  // Inside a /* */ comment
        let inSingleComment = false; // Inside a // comment
        let inScript = false;        // Inside a <script> tag
    
        while (i < len) {
            // Handle script tag boundaries
            if (!inString && !inMultiComment && !inSingleComment && 
                code.slice(i, i + 8).toLowerCase() === '<script>') {
                inScript = true;
                result.push(code.slice(i, i + 8));
                i += 8;
                continue;
            }
            if (inScript && code.slice(i, i + 9).toLowerCase() === '</script>') {
                inScript = false;
                result.push(code.slice(i, i + 9));
                i += 9;
                continue;
            }
    
            // Process JavaScript content inside script tags
            if (inScript) {
                // Handle string literals
                if (!inMultiComment && !inSingleComment && 
                    (code[i] === '"' || code[i] === "'" || code[i] === '`')) {
                    if (!inString) {
                        inString = true;
                        stringChar = code[i];
                    } else if (code[i] === stringChar && code[i-1] !== '\\') {
                        inString = false;
                    }
                    result.push(code[i]);
                    i++;
                    continue;
                }
    
                // Pass through string content without parsing
                if (inString) {
                    result.push(code[i]);
                    i++;
                    continue;
                }
    
                // Handle multi-line comments
                if (!inSingleComment && code[i] === '/' && code[i + 1] === '*') {
                    inMultiComment = true;
                    i += 2;
                    continue;
                }
                if (inMultiComment && code[i] === '*' && code[i + 1] === '/') {
                    inMultiComment = false;
                    i += 2;
                    continue;
                }
                if (inMultiComment) {
                    i++;
                    continue;
                }
    
                // Handle single-line comments
                if (!inMultiComment && code[i] === '/' && code[i + 1] === '/') {
                    inSingleComment = true;
                    i += 2;
                    continue;
                }
                if (inSingleComment && (code[i] === '\n' || code[i] === '\r')) {
                    inSingleComment = false;
                    result.push(code[i]);
                }
                if (inSingleComment) {
                    i++;
                    continue;
                }
    
                result.push(code[i]);
                i++;
                continue;
            }
    
            // Pass through regular HTML content
            result.push(code[i]);
            i++;
        }
    
        // Process root-relative URLs in the final output
        let processedCode = result.join('');
        if (this.#relPath !== null) {
            const urlPattern = /(href|src)\s*=\s*["'](\/[^"']*?)["']/g;
            processedCode = processedCode.replace(urlPattern, (match, attr, url) => {
                // Skip URLs that are protocol-relative or absolute
                if (url.startsWith('//') || /^(?:http|https|ftp|mailto|tel|data):/i.test(url)) {
                    return match;
                }
                const relPath = this.#relPath === '' ? './' : this.#relPath;
                return `${attr}="${relPath}${url.slice(1)}"`;
            });
        }
    
        return processedCode;
    }

    /**
     * Initiates processing of a file with the given relative path and working directory.
     * @param {string} file Path to the file to process
     * @param {string|null} relPath Relative path for URL resolution; devs should predetermine this
     *                              on the initial call, we will update it as we recurse through includes
     * @param {string} cwd Current working directory for file resolution
     * @returns {string} Processed template content
     */
    process(file, relPath = null, cwd = '') {
        // Reset state for new file processing
        this.#currentContext.clear();
        this.#currentBuffer = '';
        this.#includes.clear();
        this.#relPath = relPath;

        this.#htmlOutputBuffer.open = false;
        this.#htmlOutputBuffer.value = [];

        // Initialize context with provided global variables
        for (const [key, value] of this.#initialContext.entries()) {
            this.#currentContext.set(key, value);
        }
        
        if (!this.#rootDir) {
            this.#rootDir = cwd || Path.dirname(file);
        }
        
        this.#cwd = cwd || Path.dirname(file);
        
        this.#processFile(file);
        return this.#currentBuffer.trim();
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
            template = Fs.readFileSync(file, 'utf8');
            template = this.#preprocessFile(template);
        } catch (err) {
            return `<< Unable to read file ${file}:\n> ${err.message} >>`;
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
            const code = match[1];
            const processedCode = this.#tokenReplacement(code);

            let last = '';
            
            try {
                const codeWithContextSave = this.#captureDeclarations(processedCode);
                last = codeWithContextSave;
                const wrapper = new Function('$', `${codeWithContextSave}`);
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
}

export default JSHypertextPreprocessor;