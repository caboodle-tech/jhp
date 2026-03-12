/**
 * Tests for JHP $include with file resolution.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import Path from 'path';
import { fileURLToPath } from 'url';
import JHP from '../src/jhp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);
const fixturesDir = Path.join(__dirname, 'fixtures');

test('JHP - Include', async (t) => {
    const jhp = new JHP();

    await t.test('include resolves and injects partial content', () => {
        const filePath = Path.join(fixturesDir, 'simple.jhp');
        const html = jhp.process(filePath);
        assert.ok(html.includes('Before'));
        assert.ok(html.includes('After'));
        assert.ok(html.includes('Included content'));
        assert.ok(html.includes('class="included"'));
    });

    await t.test('include with cwd when processing code string', () => {
        const html = jhp.process(`
<p>Start</p>
<script>$include('./partial.html');</script>
<p>End</p>
`, { cwd: fixturesDir });
        assert.ok(html.includes('Included content'));
        assert.ok(html.includes('Start'));
        assert.ok(html.includes('End'));
    });
});
