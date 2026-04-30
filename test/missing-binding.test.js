/**
 * Optional identifiers used in script without declaration or `process({ context })` bindings: synthesized binding behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import JHP from '../src/jhp.js';

/**
 * Mirrors optional meta pattern from RFC §6: guarded output when context omits `author`.
 * Sentinel values must not bypass `if (author)`.
 */
const OPTIONAL_META_SCRIPT = `
<script>
if (author) {
  $echo('<meta name="author" content="' + author + '">');
}
</script>
`;

/**
 * Sentinel `<< Undefined: … >>` is echoed literally; asserting it outside attribute markup avoids DOM
 * post-parse edge cases around `<…>` inside synthesized attribute values.
 */
const OPTIONAL_FRAGMENT_SCRIPT = `
<script>
if (author) {
  $echo(author);
}
</script>
`;

test('missing binding default (emptyString) keeps optional guards falsy', () => {
    const jhp = new JHP();
    const html = jhp.process(OPTIONAL_META_SCRIPT, { cwd: process.cwd() });
    assert.ok(!html.includes('meta name="author"'), `Unexpected meta in: ${html}`);
    assert.ok(!html.includes('<< Undefined:'));
});

test('missing binding sentinel restores legacy diagnostic string when echoed safely', () => {
    const jhp = new JHP({ missingBinding: 'sentinel' });
    const html = jhp.process(OPTIONAL_FRAGMENT_SCRIPT, { cwd: process.cwd() });
    assert.ok(html.includes('<< Undefined: author >>'), `Unexpected output: ${JSON.stringify(html)}`);
});

test('process() overrides constructor missingBinding for one run only', () => {
    const jhp = new JHP({ missingBinding: 'sentinel' });
    const empty = jhp.process(OPTIONAL_FRAGMENT_SCRIPT, {
        cwd: process.cwd(),
        missingBinding: 'emptyString'
    });
    assert.ok(!empty.includes('<< Undefined:'));
    const again = jhp.process(OPTIONAL_FRAGMENT_SCRIPT, { cwd: process.cwd() });
    assert.ok(again.includes('<< Undefined: author >>'));
});

test('missingBinding undefined and null modes are falsy for if (author)', async (t) => {
    await t.test('undefined', () => {
        const jhp = new JHP({ missingBinding: 'undefined' });
        const html = jhp.process(OPTIONAL_META_SCRIPT, { cwd: process.cwd() });
        assert.ok(!html.includes('meta name="author'));
    });

    await t.test('null', () => {
        const jhp = new JHP({ missingBinding: 'null' });
        const html = jhp.process(OPTIONAL_META_SCRIPT, { cwd: process.cwd() });
        assert.ok(!html.includes('meta name="author'));
    });
});

test('invalid missingBinding rejects at construction or process', async (t) => {
    await t.test('constructor', () => {
        assert.throws(() => {
            new JHP({ missingBinding: 'bogus' });
        }, TypeError);
    });

    await t.test('process', () => {
        const jhp = new JHP();
        assert.throws(() => {
            jhp.process('<script>$echo(a);</script>', {
                cwd: process.cwd(),
                missingBinding: 'bogus'
            });
        }, TypeError);
    });
});
