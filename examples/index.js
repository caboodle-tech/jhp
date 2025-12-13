import Fs from 'fs';
import JHP from '../src/jhp.js';
import Path from 'path';
import { fileURLToPath } from 'url';
import { Node } from '@caboodle-tech/simple-html-parser';

// Setup important variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);

// Example of a pre-processor function
const addPreProcessorMessage = (scope) => {
    const dom = scope.dom;
    const main = dom.querySelector('main');
    
    if (main) {
        const div = dom.createNode(
            'div',
            { class: 'processor-msg' },
            'This message was added with a pre-processor function.'
        );
        main.appendChild(div);
    }
};

// Example of a post-processor function
const addPostProcessorMessage = (scope) => {
    const dom = scope.dom;
    const main = dom.querySelector('main');
    const div = dom.createNode(
        'div',
        { class: 'processor-msg' },
        'This message was added with a post-processor function.'
    );
    main.appendChild(div);
};

/**
 * NOTE: JHP now automatically loads its built-in processors so you don't need to. You can disable
 * this behavior by setting `registerJhpProcessors` to `false` in the options object when
 * instantiating JHP.
 *
 * You could also register pre and post processors for specific files adding them to the `options`
 * object of the `process` method. For example:
 *
 * jhp.process(filePath, {
 *     postProcessors: [f()],
 *     preProcessors: [f()]
 * });
 */
const jhp = new JHP({
    postProcessors: [addPostProcessorMessage],
    preProcessors: [addPreProcessorMessage]
});

// Create output directories
const outputDir = Path.join(__dirname, 'www');
if (!Fs.existsSync(outputDir)) {
    Fs.mkdirSync(outputDir, { recursive: true });
}

const cssDir = Path.join(__dirname, 'www/css');
if (!Fs.existsSync(cssDir)) {
    Fs.mkdirSync(cssDir, { recursive: true });
}

// Process the JHP files
try {
    const cssSrcPath = Path.join(__dirname, 'src/css/main.css');
    const cssDestPath = Path.join(cssDir, 'main.css');
    Fs.copyFileSync(cssSrcPath, cssDestPath);

    const srcDir = Path.join(__dirname, 'src');
    const files = Fs.readdirSync(srcDir).filter((file) => {
        return file.endsWith('.jhp');
    });

    files.forEach((file) => {
        const filePath = Path.join(srcDir, file);
        const processed = jhp.process(filePath);
        const outputFilePath = Path.join(outputDir, file.replace('.jhp', '.html'));
        Fs.writeFileSync(outputFilePath, processed);
    });
} catch (error) {
    console.error(error);
    process.exit(1);
}

console.log('Demo completed successfully. Verify the output in the `./examples/www/` directory.');
