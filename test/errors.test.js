/**
 * Tests for JHP error paths and error message output.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import JHP from '../src/jhp.js';

test('JHP - Errors', async (t) => {
    const jhp = new JHP();

    await t.test('output contains error marker for invalid include', () => {
        const html = jhp.process(`
<script>$include('./nonexistent-file-404.html');</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('<< Error:'));
        assert.ok(html.includes('include') || html.includes('resolve'));
    });

    await t.test('redeclare constant shows error', () => {
        const html = jhp.process(`
<script>
$define('C', 1);
$define('C', 2);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('<< Error:'));
    });
});
