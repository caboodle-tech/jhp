/**
 * Tests for JHP $echo and basic output.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import JHP from '../src/jhp.js';

test('JHP - Echo', async (t) => {
    const jhp = new JHP();

    await t.test('echo outputs string', () => {
        const html = jhp.process('<script>$echo("Hi");</script>');
        assert.ok(html.includes('Hi'));
    });

    await t.test('echo outputs HTML snippet', () => {
        const html = jhp.process('<script>$echo("<p>Hello</p>");</script>');
        assert.ok(html.includes('<p>Hello</p>'));
    });

    await t.test('echo outputs variable', () => {
        const html = jhp.process(`
<script>
let x = 'World';
$echo(x);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('World'));
    });

    await t.test('plain HTML without script is preserved', () => {
        const html = jhp.process('<p>Plain</p>');
        assert.ok(html.includes('<p>Plain</p>'));
    });
});
