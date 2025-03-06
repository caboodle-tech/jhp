/* eslint-disable func-names */
/* eslint-disable no-continue */

const VERSION = '1.0.0';

/**
 * Represents a DOM node in the parsed HTML tree.
 */
class Node {

    /**
     * @type {Object.<string, string>} Attributes of this node
     */
    attributes = {};

    /**
     * @type {Node[]} Child nodes
     */
    children = [];

    /**
     * @type {string} Text content for text nodes
     */
    content = '';

    /**
     * @type {string} Tag name or type identifier
     */
    name = '';

    /**
     * @type {Node|null} Parent node reference
     */
    parent = null;

    /**
     * @type {string} Node type: 'comment', 'text', 'root', 'tag-close', 'tag-open'
     */
    type = '';

    /**
     * Creates a new Node instance.
     * @param {string} type - The type of node ('comment', 'text', 'root', 'tag-close', 'tag-open')
     * @param {string} [name=''] - The tag name for element nodes
     * @param {Object.<string, string>} [attributes={}] - Node attributes
     * @param {Node|null} [parent=null] - Parent node
     */
    constructor(type, name = '', attributes = {}, parent = null) {
        this.type = type;
        this.name = name;
        this.attributes = attributes;
        this.parent = parent;
    }

    /**
     * Makes Node objects directly iterable with for...of loops. Provides a robust
     * depth-first traversal that correctly handles:
     * - Nodes being removed during iteration
     * - Skipping a node's children using node.skipChildren()
     * - DOM tree modifications during traversal
     *
     * Uses a stateful approach that determines the next node dynamically based
     * on the current state of the DOM tree.
     *
     * @returns {Iterator} A DOM traversal iterator
     */
    [Symbol.iterator]() {
        // Start with this node (or for root nodes, start with first child)
        let currentNode = this.type === 'root' && this.children.length > 0 ?
            this.children[0] :
            this;

        // Track if we've started the traversal yet
        let started = false;

        // Flag to skip children for a node
        let skipChildrenForCurrentNode = false;

        // Flag to track if the current node was removed
        let wasRemoved = false;

        // Define helper functions using arrow functions
        const getNextNodeInAncestry = (node) => {
        // If we've reached the root or a null node, traversal is complete
            if (!node || (node.type === 'root' && node.parent === null)) {
                return null;
            }

            // If this node has a next sibling, go to it
            if (node.parent) {
                const siblings = node.parent.children;
                const currentIndex = siblings.indexOf(node);

                // If there's a next sibling, go to it
                if (currentIndex < siblings.length - 1) {
                    return siblings[currentIndex + 1];
                }
            }

            // Otherwise, go up to parent and continue looking
            return getNextNodeInAncestry(node.parent);
        };

        const getNextNode = (node) => {
            // If the node was removed, we need special handling
            if (wasRemoved) {
                /**
                 * If the node was removed, its siblings have shifted We should
                 * get what would have been the next sibling.
                 */
                if (node.parent) {
                    /**
                     * Look at where the node was in its parent. If there are more
                     * siblings after where it was, get the next one. If not, go up
                     * to the parent's next sibling.
                     */
                    return getNextNodeInAncestry(node.parent);
                }
                return null;
            }

            /**
             * Skip to the "has siblings?" check if we're skipping children or if
             * the node has no children.
             */
            if (!skipChildrenForCurrentNode && node.children.length > 0) {
                // Go to first child
                return node.children[0];
            }

            // If we're at the root node with no children, we're done
            if (node.type === 'root' && node.parent === null) {
                return null;
            }

            // Try to go to next sibling
            if (node.parent) {
                const siblings = node.parent.children;
                const currentIndex = siblings.indexOf(node);

                // Node was removed from parent during traversal
                if (currentIndex === -1) {
                /**
                 * This is a special case - the node we were examining is no longer
                 * in the tree. In this case, we need to find what would have been
                 * the next node.
                 */
                    return getNextNodeInAncestry(node.parent);
                }

                // If there's a next sibling, go to it
                if (currentIndex < siblings.length - 1) {
                    return siblings[currentIndex + 1];
                }
            }

            // No more siblings, go up to parent and continue from there
            return getNextNodeInAncestry(node.parent);
        };

        // Before we begin, patch the remove method to detect when nodes are removed
        const originalRemove = Node.prototype.remove;

        /**
         * Override the remove method to detect removals during iteration
         * eslint-disable-next-line func-names.
         */
        Node.prototype.remove = function() {
            // If this is the current node being traversed, mark it as removed
            if (this === currentNode) {
                wasRemoved = true;
            }
            return originalRemove.call(this);
        };

        return {
            next() {
                // Make sure to restore the original remove method when done
                if (!currentNode) {
                    Node.prototype.remove = originalRemove;
                    return { value: undefined, done: true };
                }

                // If we haven't started yet, return the initial node
                if (!started) {
                    started = true;

                    // Define the skipChildren method for the current node
                    currentNode.skipChildren = function() {
                        skipChildrenForCurrentNode = true;
                    };

                    return { value: currentNode, done: false };
                }

                // Reset removal and skip flags
                wasRemoved = false;
                skipChildrenForCurrentNode = false;

                // We've already processed currentNode, now get the next one
                const nextNode = getNextNode(currentNode);

                // Keep a reference to the current node before updating
                const nodeToReturn = currentNode;

                // Update currentNode for the next iteration
                currentNode = nextNode;

                // Define the skipChildren method for the new node if it exists
                if (currentNode) {

                    currentNode.skipChildren = function() {
                        skipChildrenForCurrentNode = true;
                    };
                } else {
                    // We're done with traversal, restore the original remove method
                    Node.prototype.remove = originalRemove;
                }

                return { value: nodeToReturn, done: false };
            }
        };
    }

    /**
     * Adds one or more child nodes to this node.
     * @param {...Node} nodes - The nodes to append
     * @returns {Node[]} The appended nodes
     */
    appendChild(...nodes) {
        for (const node of nodes) {
            node.parent = this;
            this.children.push(node);
        }
        return nodes;
    }

    /**
     * Executes a basic CSS selector and returns matching nodes.
     * @param {string} selector - CSS selector to execute
     * @returns {Node[]} Matching nodes
     * @private
     */
    #executeBasicSelector(selector) {
        const results = [];

        // Parse basic selectors
        const selectorParts = selector.match(/([a-zA-Z0-9\-_]+)?(\#[a-zA-Z0-9\-_]+)?(\.[a-zA-Z0-9\-_]+)*(\[[^\]]+\])*/g)
            ?.filter(Boolean)
            ?.join('') || '';

        const tagMatch = selectorParts.match(/^[a-zA-Z0-9\-_]+/);
        const idMatch = selectorParts.match(/#([a-zA-Z0-9\-_]+)/);
        const classMatches = selectorParts.match(/\.([a-zA-Z0-9\-_]+)/g);
        const attrMatches = selectorParts.match(/\[([^\]]+)\]/g);

        const tagName = tagMatch ? tagMatch[0] : null;
        const id = idMatch ? idMatch[1] : null;
        const classes = classMatches ? classMatches.map((c) => { return c.substring(1); }) : [];

        // Parse attribute selectors
        const attributes = [];
        if (attrMatches) {
            for (const attrMatch of attrMatches) {
                const attrContent = attrMatch.slice(1, -1); // Remove [ and ]

                // Check for value comparison
                if (attrContent.includes('=')) {
                    const [name, rawValue] = attrContent.split('=');
                    // Remove quotes from value if present
                    const value = rawValue.replace(/^["'](.*)["']$/, '$1');
                    attributes.push({ name, value, hasValue: true });
                } else {
                    // Just check for attribute existence
                    attributes.push({ name: attrContent, hasValue: false });
                }
            }
        }

        // For "pre div" or other descendant selectors
        const isDescendantSelector = selector.includes(' ');
        if (isDescendantSelector) {
            const selectorParts = selector.split(/\s+/);

            // Start by finding ancestors
            const ancestors = this.#executeBasicSelector(selectorParts[0]);

            // For each ancestor, find matching descendants
            for (const ancestor of ancestors) {
                // Get descendants matching the rest of the selector
                const descendantSelector = selectorParts.slice(1).join(' ');
                const descendants = ancestor.#executeBasicSelector(descendantSelector);

                // Add them to results
                for (const descendant of descendants) {
                    if (!results.includes(descendant)) {
                        results.push(descendant);
                    }
                }
            }

            return results;
        }

        // Traverse the tree
        const queue = [this];

        while (queue.length > 0) {
            const node = queue.shift();

            // Check if the node matches the selector
            if (node.type === 'tag-open') {
                let matches = true;

                // Check tag name
                if (tagName && node.name !== tagName) {
                    matches = false;
                }

                // Check ID
                if (id && node.getAttribute('id') !== id) {
                    matches = false;
                }

                // Check classes
                if (classes.length > 0) {
                    const nodeClasses = (node.getAttribute('class') || '').split(/\s+/);
                    for (const cls of classes) {
                        if (!nodeClasses.includes(cls)) {
                            matches = false;
                            break;
                        }
                    }
                }

                // Check attributes
                if (attributes.length > 0) {
                    for (const attr of attributes) {
                        const nodeAttrValue = node.getAttribute(attr.name);

                        if (attr.hasValue) {
                            // Check attribute has specific value
                            if (nodeAttrValue !== attr.value) {
                                matches = false;
                                break;
                            }
                        } else if (nodeAttrValue === undefined) {
                            matches = false;
                            break;
                        }
                    }
                }

                if (matches) {
                    results.push(node);
                }
            }

            // Add children to queue
            queue.push(...node.children);
        }

        return results;
    }

    /**
     * Finds all nodes with a specific attribute.
     * @param {string} attrName - Name of the attribute to search for
     * @returns {Node[]} Nodes with the specified attribute
     */
    findAllByAttr(attrName) {
        const results = [];
        const queue = [this];

        while (queue.length > 0) {
            const node = queue.shift();
            if (node.type === 'tag-open' && Object.prototype.hasOwnProperty.call(node.attributes, attrName)) {
                results.push(node);
            }
            queue.push(...node.children);
        }

        return results;
    }

    /**
     * Finds all nodes with a specific tag name.
     * @param {string} tagName - Tag name to search for
     * @returns {Node[]} Nodes with the specified tag name
     */
    findAllByTag(tagName) {
        const results = [];
        const queue = [this];

        while (queue.length > 0) {
            const node = queue.shift();
            if (node.type === 'tag-open' && node.name === tagName) {
                results.push(node);
            }
            queue.push(...node.children);
        }

        return results;
    }

    /**
     * Finds all nodes of a specific type.
     * @param {string} nodeType - Type to search for ('tag-open', 'text', 'comment', etc.)
     * @returns {Node[]} Nodes matching the specified type
     */
    findAllByType(nodeType) {
        const results = [];
        const queue = [this];

        while (queue.length > 0) {
            const node = queue.shift();
            if (node.type === nodeType ||
                (nodeType === 'script-block' && node.type === 'tag-open' && node.scriptBlock)
            ) {
                results.push(node);
            }
            queue.push(...node.children);
        }

        return results;
    }

    /**
     * Finds matching nodes based on a selector, including :not() support.
     * @param {string} selector - CSS selector
     * @returns {Node[]} Matching nodes
     * @private
     */
    #findMatchingNodes(selector) {
        const results = [];

        // Extract :not() selectors
        const notSelectors = [];
        const mainSelector = selector.replace(/:not\(([^)]+)\)/g, (match, notSelector) => {
            notSelectors.push(notSelector.trim());
            return ''; // Remove :not() from the main selector
        }).trim();

        // If we only have :not() selectors with no main selector, start with all nodes
        let candidateNodes = [];
        if (mainSelector === '') {
            // Get all tag nodes if no main selector (equivalent to *)
            const queue = [this];
            while (queue.length > 0) {
                const node = queue.shift();
                if (node.type === 'tag-open') {
                    candidateNodes.push(node);
                }
                queue.push(...node.children);
            }
        } else {
            // Find nodes matching the main selector
            candidateNodes = this.#executeBasicSelector(mainSelector);
        }

        // Filter out nodes that match any :not() selector
        for (const node of candidateNodes) {
            let includeNode = true;

            for (const notSelector of notSelectors) {
                /**
                 * We need to find if this specific node is matched by the not selector.
                 * Start from the root to find all nodes matching the not selector.
                 */
                const root = this.#findRoot();
                const notMatches = root.#executeBasicSelector(notSelector);

                // If the current node is in the not matches, exclude it
                if (notMatches.includes(node)) {
                    includeNode = false;
                    break;
                }
            }

            if (includeNode) {
                results.push(node);
            }
        }

        return results;
    }

    /**
     * Finds the root node of the tree.
     * @returns {Node} Root node
     * @private
     */
    #findRoot() {
        let node = this;
        while (node.parent !== null) {
            node = node.parent;
        }
        return node;
    }

    /**
     * Gets the value of an attribute.
     * @param {string} name - Attribute name
     * @returns {string|undefined} Attribute value or undefined if not found
     */
    getAttribute(name) {
        return this.attributes[name];
    }

    /**
     * Gets the attribute string for a node.
     * @param {Node} node - Node to get attributes for
     * @returns {string} Attribute string
     * @private
     */
    #getNodeAttributesString(node) {
        let attrs = '';
        for (const [key, value] of Object.entries(node.attributes)) {
            if (value === '__EMPVAL__') {
                attrs += ` ${key}`;
                continue;
            }
            attrs += ` ${key}="${value}"`;
        }
        return attrs;
    }

    /**
     * Gets the HTML tag for this node without its children; e.g., "<div id='main'>"
     * @returns {string} HTML tag
     */
    getTag() {
        if (this.type === 'text') {
            return this.content;
        }

        if (this.type === 'comment') {
            const commentType = this.commentType || 'html-comment';

            if (commentType === 'js-single-line') {
                return `//${this.content}`;
            } if (commentType === 'js-multi-line') {
                return `/*${this.content}*/`;
            }
            return `<!--${this.content}-->`;
        }

        if (this.type === 'tag-open' || this.type === 'tag-close') {
            const attrs = this.#getNodeAttributesString(this);
            return `<${this.name}${attrs}>`;
        }

        return '';
    }

    /**
     * Gets the HTML content of this node's children without the node's own tags.
     * @param {boolean} [showComments=false] - Whether to include comments in the output
     * @returns {string} HTML representation of the node's children
     */
    innerHtml(showComments = false) {
        // Simply concatenate all children's HTML
        let result = '';
        for (const child of this.children) {
            result += child.toHtml(showComments);
        }
        return result;
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    /**
     * Returns the first node matching the given CSS selector.
     * @param {string} selector - CSS selector
     * @returns {Node|null} The first matching node or null if none found
     */
    querySelector(selector) {
        const results = this.querySelectorAll(selector);
        return results.length > 0 ? results[0] : null;
    }

    /**
     * Returns all nodes matching the given CSS selector.
     * @param {string} selector - CSS selector
     * @returns {Node[]} Array of matching nodes
     */
    querySelectorAll(selector) {
        // Handle multiple selectors (comma-separated)
        if (selector.includes(',')) {
            const selectors = selector.split(',').map((s) => { return s.trim(); });
            const results = [];

            for (const singleSelector of selectors) {
                const singleResults = this.#findMatchingNodes(singleSelector);
                // Merge results, avoiding duplicates
                for (const result of singleResults) {
                    if (!results.includes(result)) {
                        results.push(result);
                    }
                }
            }

            return results;
        }

        return this.#findMatchingNodes(selector);
    }

    /**
     * Removes this node from the tree.
     * @returns {Node} The removed node
     */
    remove() {
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index !== -1) {
                // If this is an opening tag, check if the NEXT node is its closing tag
                if (this.type === 'tag-open' && index + 1 < this.parent.children.length) {
                    const nextSibling = this.parent.children[index + 1];
                    if (nextSibling.type === 'tag-close' && nextSibling.name === this.name) {
                        // Remove both tags in one operation
                        this.parent.children.splice(index, 2);
                        this.parent = null;
                        return this;
                    }
                }

                // If this is a closing tag, check if the PREVIOUS node is its opening tag
                if (this.type === 'tag-close' && index > 0) {
                    const prevSibling = this.parent.children[index - 1];
                    if (prevSibling.type === 'tag-open' && prevSibling.name === this.name) {
                        // Remove both tags in one operation
                        this.parent.children.splice(index - 1, 2);
                        this.parent = null;
                        return this;
                    }
                }

                // If no adjacent matching tag, just remove this node
                this.parent.children.splice(index, 1);
                this.parent = null;
            }
        }
        return this;
    }

    /**
     * Replaces this node with one or more other nodes.
     * @param {...Node} nodes - The nodes to replace this node with
     */
    replaceWith(...nodes) {
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index !== -1) {
                this.parent.children.splice(index, 1, ...nodes);
                for (const node of nodes) {
                    node.parent = this.parent;
                }
            }
        }
    }

    /**
     * Sets an attribute on the node.
     * @param {string} name - Attribute name
     * @param {string} value - Attribute value
     */
    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    /**
     * Converts the node and its children to an HTML string.
     * @param {boolean} [showComments=false] - Whether to include comments in the output
     * @returns {string} HTML representation of the node
     */
    toHtml(showComments = false) {
        if (this.type === 'text') {
            // Keep all original text exactly as parsed, no trimming
            return this.content;
        }

        if (this.type === 'comment') {
            if (!showComments) {
                return '';
            }

            const commentType = this.commentType || 'html-comment';

            if (commentType === 'js-single-line') {
                return `//${this.content}`;
            } if (commentType === 'js-multi-line') {
                return `/*${this.content}*/`;
            }
            return `<!--${this.content}-->`;

        }

        if (this.type === 'tag-open') {
            const attrs = this.#getNodeAttributesString(this);
            let result = `<${this.name}${attrs}>`;
            for (const child of this.children) {
                result += child.toHtml(showComments);
            }
            return result;
        }

        if (this.type === 'tag-close') {
            return `</${this.name}>`;
        }

        // Root node - just return children
        let result = '';
        for (const child of this.children) {
            result += child.toHtml(showComments);
        }
        return result;
    }

    toString() {
        return this.toHtml(true);
    }

    /**
     * Generates a visual representation of the DOM tree starting from this node.
     * @param {Object} [options] - Visualization options
     * @param {number} [options.contentPreviewLength=20] - Maximum length for content previews
     * @param {boolean} [options.returnString=false] - If true, returns the visualization as a string instead of logging
     * @param {boolean} [options.showAttributes=true] - Whether to show node attributes
     * @param {boolean} [options.showContent=true] - Whether to show text/comment content previews
     * @param {boolean} [options.showNodeNumber=false] - Whether to show node numbers
     * @param {boolean} [options.showNodeType=false] - Whether to show node types
     * @returns {string|undefined} String representation if returnString is true, otherwise undefined
     */
    visualize(options = {}) {
        // Define default options
        const defaultOptions = {
            contentPreviewLength: 20,
            returnString: false,
            showAttributes: true,
            showContent: true,
            showNodeNumber: false,
            showNodeType: false
        };

        // Merge defaults with provided options
        const mergedOptions = { ...defaultOptions, ...options };

        // Extract specific options
        const {
            contentPreviewLength,
            returnString,
            showAttributes,
            showContent,
            showNodeNumber,
            showNodeType
        } = mergedOptions;

        // Initialize output and counter
        let output = '';
        let globalCounter = 0;

        // Helper function to get a preview of content
        const getPreview = (content) => {
            if (!content || !showContent) return '';
            const trimmed = content.trim();
            if (!trimmed.length) return '';

            return trimmed.length > contentPreviewLength ?
                `: "${trimmed.substring(0, contentPreviewLength - 3)}..."` :
                `: "${trimmed}"`;
        };

        // Helper function to format attributes
        const formatAttributes = (attrs) => {
            if (!showAttributes || Object.keys(attrs).length === 0) return '';

            return ` ${Object.entries(attrs)
                // eslint-disable-next-line arrow-body-style, no-extra-parens
                .map(([k, v]) => (v === '__EMPVAL__' ? k : `${k}="${v}"`))
                .join(' ')}`;
        };

        // Format the current node (which may or may not be the root)
        let nodeLabel = '';
        if (this.type === 'root') {
            nodeLabel = 'ROOT';
        } else if (this.type === 'text') {
            nodeLabel = `TEXT${getPreview(this.content)}`;
        } else if (this.type === 'comment') {
            const commentType = this.commentType ? ` (${this.commentType})` : '';
            nodeLabel = `COMMENT${commentType}${getPreview(this.content)}`;
        } else if (this.type === 'tag-open') {
            const attrs = formatAttributes(this.attributes);
            nodeLabel = `<${this.name}${attrs}>`;
        } else if (this.type === 'tag-close') {
            nodeLabel = `</${this.name}>`;
        }

        if (showNodeType) {
            nodeLabel += ` (${this.type}`;
            if (this.scriptBlock) {
                nodeLabel += ', script-block';
            }
            nodeLabel += ')';
        }
        if (showNodeNumber) {
            nodeLabel += ` [${globalCounter}]`;
            globalCounter += 1;
        }
        output += `${nodeLabel}\n`;

        // Process children of the root with proper indentation
        const { children } = this;
        for (let i = 0; i < children.length; i++) {
            const isLastChild = i === children.length - 1;
            const prefix = isLastChild ? '└── ' : '├── ';

            // Process each child with proper indentation
            buildChildTree(children[i], prefix, isLastChild, []);
        }

        // Function to build the tree for child nodes
        function buildChildTree(node, prefix, isLast, parentPrefixes) {
            // Create current line
            let nodeLabel = '';

            if (node.type === 'text') {
                nodeLabel = `TEXT${getPreview(node.content)}`;
            } else if (node.type === 'comment') {
                const commentType = node.commentType ? ` (${node.commentType})` : '';
                nodeLabel = `COMMENT${commentType}${getPreview(node.content)}`;
            } else if (node.type === 'tag-open') {
                const attrs = formatAttributes(node.attributes);
                nodeLabel = `<${node.name}${attrs}>`;
            } else if (node.type === 'tag-close') {
                nodeLabel = `</${node.name}>`;
            }

            // Add the current node to output
            output += `${parentPrefixes.join('')}${prefix}${nodeLabel}`;
            if (showNodeType) {
                output += ` (${node.type}`;
                if (node.scriptBlock) {
                    output += ', script-block';
                }
                output += ')';
            }
            if (showNodeNumber) {
                output += ` [${globalCounter}]`;
                globalCounter += 1;
            }
            output += '\n';

            // Process children
            if (node.children.length > 0) {
                // Next level indentation
                const nextIndent = isLast ? '    ' : '│   ';
                const newParentPrefixes = [...parentPrefixes, nextIndent];

                for (let i = 0; i < node.children.length; i++) {
                    const isLastChild = i === node.children.length - 1;
                    const childPrefix = isLastChild ? '└── ' : '├── ';

                    buildChildTree(node.children[i], childPrefix, isLastChild, newParentPrefixes);
                }
            }
        }

        if (returnString) {
            return output;
        }
        console.log(output);
    }

}

/**
 * A module for parsing and manipulating HTML using a DOM-like interface.
 * @module SimpleHtmlParser
 */
class SimpleHtmlParser {

    /**
     * @type {string[]} Tags that are handled specially (content parsed as text)
     */
    #specialTags = [];

    /**
      * Creates a new parser instance.
      * @param {string[]} [specialTags=['jhp', 's_']] - Tags where content is treated as text
      */
    constructor(specialTags = ['jhp', 's_']) {
        this.#specialTags = specialTags;
    }

    getSpecialTags() {
        return [...this.#specialTags];
    }

    /**
     * Parses an HTML string into a tree of nodes.
     * @param {string} html - HTML string to parse
     * @returns {Node} Root node of the parsed tree
     */
    parse(html) {
        const root = new Node('root');
        let currentNode = root;
        let pos = 0;

        while (pos < html.length) {
            if (html.substring(pos, pos + 4) === '<!--') { // Comments
                const commentEnd = html.indexOf('-->', pos);
                if (commentEnd === -1) {
                    pos += 1;
                    continue;
                }

                const commentContent = html.substring(pos + 4, commentEnd);
                const commentNode = new Node('comment', '', {}, currentNode);
                commentNode.content = commentContent;
                commentNode.commentType = 'html-comment';
                currentNode.appendChild(commentNode);

                pos = commentEnd + 3;
                continue;
            } else if (html[pos] === '<' && html[pos + 1] !== '/') { // Opening tag
                const tagEnd = html.indexOf('>', pos);
                if (tagEnd === -1) {
                    pos += 1;
                    continue;
                }

                const tagContent = html.substring(pos + 1, tagEnd);
                const parts = tagContent.split(/\s+/);
                const tagName = parts[0];

                // Parse attributes
                const attributes = {};
                const attrPattern = /(\w+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
                let match;

                const attrStr = tagContent.substring(tagName.length);
                while ((match = attrPattern.exec(attrStr)) !== null) {
                    const name = match[1];
                    const value = match[2] || match[3] || match[4] || '__EMPVAL__';
                    attributes[name] = value;
                }

                const node = new Node('tag-open', tagName, attributes, currentNode);
                currentNode.appendChild(node);

                // Handle special tags (script, custom tags)
                if (this.#specialTags.includes(tagName)) {
                    // Mark this node as a script block
                    node.scriptBlock = true;
                    const closeTag = `</${tagName}>`;
                    const closeTagPos = html.indexOf(closeTag, tagEnd);

                    if (closeTagPos !== -1) {
                        // Process content as a mix of comments and text
                        const scriptContent = html.substring(tagEnd + 1, closeTagPos);

                        // Parse JS comments
                        let position = 0;
                        while (position < scriptContent.length) {
                            // Find next comment
                            const singleCommentPos = scriptContent.indexOf('//', position);
                            const multiCommentPos = scriptContent.indexOf('/*', position);

                            let nextCommentPos = -1;
                            let isMultiLine = false;

                            if (singleCommentPos !== -1 && multiCommentPos !== -1) {
                                if (singleCommentPos < multiCommentPos) {
                                    nextCommentPos = singleCommentPos;
                                    isMultiLine = false;
                                } else {
                                    nextCommentPos = multiCommentPos;
                                    isMultiLine = true;
                                }
                            } else if (singleCommentPos !== -1) {
                                nextCommentPos = singleCommentPos;
                                isMultiLine = false;
                            } else if (multiCommentPos !== -1) {
                                nextCommentPos = multiCommentPos;
                                isMultiLine = true;
                            }

                            // Add text before comment if any
                            if (nextCommentPos === -1) {
                                // No more comments, add remaining text
                                if (position < scriptContent.length) {
                                    const textNode = new Node('text');
                                    textNode.content = scriptContent.substring(position);
                                    node.appendChild(textNode);
                                }
                                break;
                            } else if (nextCommentPos > position) {
                                const textNode = new Node('text');
                                textNode.content = scriptContent.substring(position, nextCommentPos);
                                node.appendChild(textNode);
                            }

                            // Process comment
                            if (isMultiLine) {
                                const commentEnd = scriptContent.indexOf('*/', nextCommentPos + 2);
                                if (commentEnd === -1) {
                                    // Unclosed comment
                                    const commentNode = new Node('comment', '', {}, node);
                                    commentNode.content = scriptContent.substring(nextCommentPos + 2);
                                    commentNode.commentType = 'js-multi-line';
                                    node.appendChild(commentNode);
                                    break;
                                } else {
                                    const commentNode = new Node('comment', '', {}, node);
                                    commentNode.content = scriptContent.substring(nextCommentPos + 2, commentEnd);
                                    commentNode.commentType = 'js-multi-line';
                                    node.appendChild(commentNode);
                                    position = commentEnd + 2;
                                }
                            } else {
                                // Single-line comment
                                const lineEnd = scriptContent.indexOf('\n', nextCommentPos);
                                if (lineEnd === -1) {
                                    const commentNode = new Node('comment', '', {}, node);
                                    commentNode.content = scriptContent.substring(nextCommentPos + 2);
                                    commentNode.commentType = 'js-single-line';
                                    node.appendChild(commentNode);
                                    break;
                                } else {
                                    const commentNode = new Node('comment', '', {}, node);
                                    commentNode.content = scriptContent.substring(nextCommentPos + 2, lineEnd);
                                    commentNode.commentType = 'js-single-line';
                                    node.appendChild(commentNode);
                                    position = lineEnd + 1;
                                }
                            }
                        }

                        // Create and add the closing tag node
                        const closeNode = new Node('tag-close', tagName, {}, currentNode);
                        closeNode.scriptBlock = true;

                        // This is the key fix: add the closing tag at the same level as the opening tag
                        currentNode.appendChild(closeNode);

                        pos = closeTagPos + closeTag.length;
                        continue;
                    }
                }

                currentNode = node;
                pos = tagEnd + 1;
            } else if (html[pos] === '<' && html[pos + 1] === '/') { // Closing tag
                const tagEnd = html.indexOf('>', pos);
                if (tagEnd === -1) {
                    pos += 1;
                    continue;
                }

                const tagName = html.substring(pos + 2, tagEnd);

                // Create closing tag node
                const closeNode = new Node('tag-close', tagName);

                // Find the matching opening tag in the parent chain
                let parent = currentNode;
                let foundMatch = false;

                while (parent && parent.type !== 'root') {
                    if (parent.type === 'tag-open' && parent.name === tagName) {
                        // Add closing tag as a sibling to the matching opening tag
                        // (i.e., as a child of the opening tag's parent)
                        parent.parent.appendChild(closeNode);

                        // Move current node up to the parent
                        currentNode = parent.parent;
                        foundMatch = true;
                        break;
                    }
                    // eslint-disable-next-line prefer-destructuring
                    parent = parent.parent;
                }

                // If no matching opening tag found, just add to current node
                if (!foundMatch) {
                    currentNode.appendChild(closeNode);
                }

                pos = tagEnd + 1;
            } else { // Text content
                const nextTagPos = html.indexOf('<', pos);
                const textEnd = nextTagPos === -1 ? html.length : nextTagPos;

                if (textEnd > pos) {
                    const content = html.substring(pos, textEnd);
                    // Remove the trim() to keep whitespace
                    const textNode = new Node('text');
                    textNode.content = content;
                    currentNode.appendChild(textNode);
                }

                pos = textEnd;
            }
        }

        return root;
    }

    version() {
        return `Simple Html Parser v${VERSION}`;
    }

}

export { Node, SimpleHtmlParser };
export default SimpleHtmlParser;
