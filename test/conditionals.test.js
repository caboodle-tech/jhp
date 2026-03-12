/**
 * Tests for JHP $if, $elseif, $else, $end.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import JHP from '../src/jhp.js';

test('JHP - Conditionals', async (t) => {
    const jhp = new JHP();

    await t.test('if true shows block', () => {
        const html = jhp.process(`
<script>
$if(true);
</script>
<p>Shown</p>
<script>$end();</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('Shown'));
    });

    await t.test('if false hides block', () => {
        const html = jhp.process(`
<script>
$if(false);
</script>
<p>Hidden</p>
<script>$end();</script>
`, { cwd: process.cwd() });
        assert.ok(!html.includes('Hidden'));
    });

    await t.test('else branch when if false', () => {
        const html = jhp.process(`
<script>$if(false);</script>
<p>Then</p>
<script>$else();</script>
<p>Else</p>
<script>$end();</script>
`, { cwd: process.cwd() });
        assert.ok(!html.includes('Then'));
        assert.ok(html.includes('Else'));
    });

    await t.test('elseif branch', () => {
        const html = jhp.process(`
<script>$if(false);</script>
<p>ThenBlock</p>
<script>$elseif(true);</script>
<p>ElseIfBlock</p>
<script>$else();</script>
<p>ElseBlock</p>
<script>$end();</script>
`, { cwd: process.cwd() });
        assert.ok(!html.includes('ThenBlock'));
        assert.ok(html.includes('ElseIfBlock'));
        assert.ok(!html.includes('ElseBlock'));
    });
});
