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

    await t.test('serialized context strings round-trip TeX escapes (JSON.stringify prelude)', () => {
        /** Substrings whose leading backslashes must survive template generation, not `\f`/`\n` escapes. */
        const texLike = '\\frac{a}{b}`and${x}\\\\quote"\\newline\\nabla';
        const revived = new Function(`var t = ${JSON.stringify(texLike)}; return t;`)();
        assert.strictEqual(revived, texLike);
    });

    await t.test('echo preserves Quarto/KaTeX-style sequences from context', () => {
        const formula = '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}';
        const html = jhp.process(
            `<script>$context('s', ${JSON.stringify(formula)});</script>\n<script>$echo(s);</script>`,
            { cwd: process.cwd() }
        );
        assert.ok(html.includes(formula), `Expected intact formula in HTML: ${html.slice(0, 500)}`);
    });

    await t.test('echo preserves backslash+n as literal \\nabla, not newline + abla', () => {
        const s = '\\nabla f';
        const html = jhp.process(
            `<script>$context('s', ${JSON.stringify(s)});</script>\n<script>$echo(s);</script>`,
            { cwd: process.cwd() }
        );
        assert.ok(html.includes(s), html.slice(0, 400));
    });

    await t.test('options.context strings preserve arbitrary backslashes in echo output', () => {
        const formula = '\\frac{a}{b}';
        const html = jhp.process('<script>$echo(formula);</script>', {
            cwd: process.cwd(),
            context: { formula }
        });
        assert.ok(html.includes(formula), html.slice(0, 400));
    });
});
