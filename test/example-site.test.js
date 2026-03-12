/**
 * Integration test: build the example site and assert output is valid.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import Fs from 'fs';
import Path from 'path';
import { fileURLToPath } from 'url';
import { buildExamples } from '../examples/build.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);

test('JHP - Example site build', async (t) => {
    let outputDir;

    await t.test('build completes and returns output dir', () => {
        const result = buildExamples();
        assert.ok(result.outputDir);
        assert.ok(Array.isArray(result.files) && result.files.length > 0);
        outputDir = result.outputDir;
    });

    await t.test('expected HTML files exist', () => {
        const result = buildExamples();
        const expected = ['index.html', 'conditionals.html', 'buffer.html'];
        for (const name of expected) {
            assert.ok(result.files.includes(name), `Expected ${name} in built files`);
            const filePath = Path.join(result.outputDir, name);
            assert.ok(Fs.existsSync(filePath), `File ${name} should exist`);
        }
    });

    await t.test('each page has doctype and no error string', () => {
        const result = buildExamples();
        for (const name of result.files) {
            const filePath = Path.join(result.outputDir, name);
            const content = Fs.readFileSync(filePath, 'utf8');
            assert.ok(
                content.includes('<!DOCTYPE') || content.includes('<!doctype'),
                `${name} should contain doctype`
            );
            assert.ok(content.includes('</html>'), `${name} should contain closing html tag`);
            assert.ok(
                !content.includes('<< Error:'),
                `${name} should not contain JHP error output`
            );
        }
    });

    await t.test('index.html contains expected content', () => {
        const result = buildExamples();
        const indexPath = Path.join(result.outputDir, 'index.html');
        const content = Fs.readFileSync(indexPath, 'utf8');
        assert.ok(content.includes('Welcome'), 'index.html should contain Welcome');
    });

    await t.test('conditionals.html contains expected content', () => {
        const result = buildExamples();
        const path = Path.join(result.outputDir, 'conditionals.html');
        const content = Fs.readFileSync(path, 'utf8');
        assert.ok(
            content.includes('Conditional Statements'),
            'conditionals.html should contain title'
        );
    });
});
