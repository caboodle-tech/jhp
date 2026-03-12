/**
 * Tests for JHP $define, $context, and variable output.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import JHP from '../src/jhp.js';

test('JHP - Define and context', async (t) => {
    const jhp = new JHP();

    await t.test('context from options available in template', () => {
        const html = jhp.process(`
<script>$context('name', 'Alice');</script>
<script>$echo(name);</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('Alice'));
    });

    await t.test('define sets constant for later block', () => {
        const html = jhp.process(`
<script>$define('APP_NAME', 'MyApp');</script>
<script>$echo(APP_NAME);</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('MyApp'));
    });

    await t.test('options.context merges with template', () => {
        const html = jhp.process(`
<script>$echo(greeting);</script>
`, { cwd: process.cwd(), context: { greeting: 'Hello' } });
        assert.ok(html.includes('Hello'));
    });

    await t.test('redeclare constant produces error in output', () => {
        const html = jhp.process(`
<script>
$define('X', 1);
$define('X', 2);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('<< Error:'));
        assert.ok(html.includes('redeclare') || html.includes('constant'));
    });
});
