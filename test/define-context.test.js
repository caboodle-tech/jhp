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

    await t.test('const inside if block syncs to context for later script', () => {
        const html = jhp.process(`
<script>
if (true) {
    const siteTitle = 'BYU-I';
}
</script>
<script>$echo(siteTitle);</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('BYU-I'), `Expected default title in output: ${html.slice(0, 200)}`);
    });

    await t.test('course-style defaults: if (!x) const in block, defines, later echo', () => {
        const html = jhp.process(`
<script>
    if (!title) {
        const title = 'BYU-I';
    }

    if (!description) {
        const description = 'This is a BYU-I Computer Science and Engineering Department course website';
    }

    $define('CourseName', 'Course Name Here');
    $define('courseCode', 'CSE 123');
    $define('courseStartYear', 2025);
</script>
<script>
$echo(title);
$echo(description);
$echo(CourseName);
$echo(courseCode);
$echo(courseStartYear);
</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('BYU-I'), html.slice(0, 400));
        assert.ok(html.includes('Computer Science'), html.slice(0, 400));
        assert.ok(html.includes('Course Name Here'));
        assert.ok(html.includes('CSE 123'));
        assert.ok(html.includes('2025'));
    });

    await t.test('course-style defaults respect options.context (skip const branches)', () => {
        const html = jhp.process(`
<script>
    if (!title) {
        const title = 'DefaultTitle';
    }
    if (!description) {
        const description = 'DefaultDesc';
    }
</script>
<script>$echo(title); $echo(description);</script>
`, {
            cwd: process.cwd(),
            context: { title: 'ProvidedTitle', description: 'ProvidedDesc' }
        });
        assert.ok(html.includes('ProvidedTitle') && html.includes('ProvidedDesc'), html.slice(0, 300));
        assert.ok(!html.includes('DefaultTitle') && !html.includes('DefaultDesc'), 'Defaults should not appear');
    });

    await t.test('nested if blocks each sync distinct const bindings', () => {
        const html = jhp.process(`
<script>
if (true) {
    if (true) {
        const innerA = 'A';
    }
    const innerB = 'B';
}
</script>
<script>$echo(innerA); $echo(innerB);</script>
`, { cwd: process.cwd() });
        assert.ok(html.includes('A') && html.includes('B'), html.slice(0, 250));
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
