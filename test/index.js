import Fs from 'fs';
import JHP from '../src/jhp.js';
import Path from 'path';
import { fileURLToPath } from 'url';

// Setup important variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);
const jhp = new JHP();

/**
 * NOTE: JHP now automatically loads its built-in processors so you don't need to. You can disable
 * this behavior by setting `registerJhpProcessors` to `false` in the options object when
 * instantiating JHP.
 *
 * You could also register pre and post processors for specific files adding them to the `options`
 * object of the `process` method. For example:
 *
 * jhp.process(filePath, {
 *     pre: [processors.pre],
 *     post: [processors.post]
 * });
 */

// Create output directory
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
    exit(1);
}

console.log('Test completed successful. Verify the output in the `./test/www/` directory.');
