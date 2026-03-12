import { buildExamples } from './build.js';

try {
    buildExamples();
} catch (error) {
    console.error(error);
    process.exit(1);
}

console.log('Demo completed successfully. Verify the output in the `./examples/www/` directory.');
