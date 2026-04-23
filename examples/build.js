/**
 * Example site build. Run directly to build into examples/www; import { buildExamples } for tests.
 * @module examples/build
 */

import Fs from 'fs';
import JHP from '../src/jhp.js';
import Path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);

const addPreProcessorMessage = (scope) => {
    const { dom } = scope;
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

const addPostProcessorMessage = (scope) => {
    const { dom } = scope;
    const main = dom.querySelector('main');
    const div = dom.createNode(
        'div',
        { class: 'processor-msg' },
        'This message was added with a post-processor function.'
    );
    main.appendChild(div);
};

const srcDir = Path.join(__dirname, 'src');

const jhp = new JHP({
    postProcessors: [addPostProcessorMessage],
    preProcessors: [addPreProcessorMessage],
    /** So `$include('/partials/...')` is rooted at `examples/src`, not the OS root. */
    rootDir: srcDir
});

/**
 * Builds the example site into examples/www. Creates www and www/css if needed,
 * copies main.css, and processes all .jhp files from examples/src.
 * @returns {{ outputDir: string, files: string[] }} Path to www and list of written HTML filenames
 */
export const buildExamples = () => {
    const outputDir = Path.join(__dirname, 'www');
    if (!Fs.existsSync(outputDir)) {
        Fs.mkdirSync(outputDir, { recursive: true });
    }
    const cssDir = Path.join(__dirname, 'www/css');
    if (!Fs.existsSync(cssDir)) {
        Fs.mkdirSync(cssDir, { recursive: true });
    }

    const cssSrcPath = Path.join(__dirname, 'src/css/main.css');
    const cssDestPath = Path.join(cssDir, 'main.css');
    Fs.copyFileSync(cssSrcPath, cssDestPath);

    const files = Fs.readdirSync(srcDir).filter((file) => { return file.endsWith('.jhp'); });
    const written = [];

    for (const file of files) {
        const filePath = Path.join(srcDir, file);
        const processed = jhp.process(filePath);
        const outputFilePath = Path.join(outputDir, file.replace('.jhp', '.html'));
        Fs.writeFileSync(outputFilePath, processed);
        written.push(Path.basename(outputFilePath));
    }

    return { outputDir, files: written };
};

const isMain = process.argv[1] && Path.resolve(process.argv[1]) === Path.resolve(__filename);
if (isMain) {
    try {
        buildExamples();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
    console.log('Build completed successfully. Output is in `./examples/www/`.');
}
