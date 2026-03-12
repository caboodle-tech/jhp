/**
 * Tests for variable declaration edge cases: strings with quotes, semicolons,
 * backslashes, multiline, and cross-file declare/use.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import Path from 'path';
import { fileURLToPath } from 'url';
import JHP from '../src/jhp.js';

const __dirname = Path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = Path.join(__dirname, 'fixtures');

test('Variable declarations - string edge cases', async (t) => {
    const jhp = new JHP();

    await t.test('string with semicolon inside (single quotes)', () => {
        const html = jhp.process(`
<script>
let a = 'hi; there';
$echo(a);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('hi; there'), `Expected "hi; there" in output: ${html.slice(0, 200)}`);
    });

    await t.test('string with semicolon inside (double quotes)', () => {
        const html = jhp.process(`
<script>
let b = "bye; world";
$echo(b);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('bye; world'), `Expected "bye; world" in output: ${html.slice(0, 200)}`);
    });

    await t.test('string with single quote inside double-quoted string', () => {
        const html = jhp.process(`
<script>
let c = "say 'hello'";
$echo(c);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes("say 'hello'") || html.includes('hello'), `Expected single quote preserved, got: ${html.slice(0, 250)}`);
    });

    await t.test('string with double quote inside single-quoted string', () => {
        const html = jhp.process(`
<script>
let d = 'say "hi"';
$echo(d);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('"hi"') || html.includes('hi'), `Expected double quote preserved, got: ${html.slice(0, 250)}`);
    });

    await t.test('string with backslash', () => {
        const html = jhp.process(`
<script>
let e = 'path\\\\to\\\\file';
$echo(e);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('path') && html.includes('to') && html.includes('file'), `Expected path\to\file or path\\to\\file, got: ${html.slice(0, 250)}`);
    });

    await t.test('string with backslash-n (escape)', () => {
        const html = jhp.process(`
<script>
let f = 'line1\\nline2';
$echo(f);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('line1') && html.includes('line2'), `Expected line1 and line2, got: ${html.slice(0, 250)}`);
    });

    await t.test('template literal with variable', () => {
        const html = jhp.process(`
<script>
let who = 'World';
let g = \`Hello \${who}\`;
$echo(g);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('Hello World'), `Expected "Hello World", got: ${html.slice(0, 250)}`);
    });

    await t.test('define with string containing backtick', () => {
        const html = jhp.process(`
<script>$define('BT', 'value with \`backtick\`');</script>
<script>$echo(BT);</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('backtick') || html.includes('value'), `Expected backtick string, got: ${html.slice(0, 250)}`);
    });

    await t.test('multiline declaration (template literal across lines)', () => {
        const html = jhp.process(`
<script>
let msg = \`line one
line two
line three\`;
$echo(msg);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('line one') && html.includes('line two') && html.includes('line three'), `Expected multiline content: ${html.slice(0, 300)}`);
    });

    await t.test('multiline declaration (string concat across lines)', () => {
        const html = jhp.process(`
<script>
let x = 'hello'
  + ';'
  + ' world';
$echo(x);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('hello') && html.includes('world'), `Expected concatenated string: ${html.slice(0, 300)}`);
    });
});

test('Variable declarations - comments and unclosed string', async (t) => {
    const jhp = new JHP();

    await t.test('semicolon inside line comment is ignored', () => {
        const html = jhp.process(`
<script>
let a = 'ok'; // fake ; here
$echo(a);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('ok'), `Expected "ok" in output: ${html.slice(0, 200)}`);
    });

    await t.test('semicolon inside block comment is ignored', () => {
        const html = jhp.process(`
<script>
let b = 'yes'; /* ; */ $echo(b);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('yes'), `Expected "yes" in output: ${html.slice(0, 200)}`);
    });

    await t.test('unclosed string outputs error and sets variable to empty string', () => {
        const html = jhp.process(`
<script>
let x = 'unclosed
$echo(x);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('<< Error:') && html.includes('Unclosed'), `Expected unclosed string error: ${html.slice(0, 300)}`);
        assert.ok(html.includes('string') || html.includes('template'), 'Error should mention string or template');
    });

    await t.test('unclosed string does not break later echo of same variable', () => {
        const html = jhp.process(`
<script>
let y = 'oops
</script>
<p>Before</p>
<script>
$echo(y);
</script>
<p>After</p>
`, { cwd: process.cwd() });
        assert.ok(html.includes('Before') && html.includes('After'), 'Page should still render');
        assert.ok(!html.includes('ReferenceError') && !html.includes('is not defined'), 'Should not throw reference error');
    });
});

test('Variable declarations - cross-file (declare in one file, use in included)', async (t) => {
    const jhp = new JHP();
    const crossFileDir = Path.join(fixturesDir, 'cross-file');

    await t.test('let in main file, include partial that echoes variable', () => {
        const mainPath = Path.join(crossFileDir, 'main-with-let.jhp');
        const html = jhp.process(mainPath);
        assert.ok(html.includes('FromMain'), `Expected "FromMain" from cross-file let, got: ${html.slice(0, 300)}`);
    });

    await t.test('$define in main file, include partial that echoes constant', () => {
        const mainPath = Path.join(crossFileDir, 'main-with-define.jhp');
        const html = jhp.process(mainPath);
        assert.ok(html.includes('ConstantValue'), `Expected "ConstantValue" from cross-file define, got: ${html.slice(0, 300)}`);
    });

    await t.test('$context in main file, include partial that echoes variable', () => {
        const mainPath = Path.join(crossFileDir, 'main-with-context.jhp');
        const html = jhp.process(mainPath);
        assert.ok(html.includes('ContextValue'), `Expected "ContextValue" from cross-file context, got: ${html.slice(0, 300)}`);
    });
});
