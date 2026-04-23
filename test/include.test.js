/**
 * Tests for JHP $include: default resolution, includeSearchRoots, includePathResolver, and error messages.
 * Run: npm test  (or node --test test/include.test.js)
 * Diagnostics: set NODE_DEBUG=test or use node --test --test-reporter=spec for verbose names.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import Path from 'path';
import { fileURLToPath } from 'url';
import JHP from '../src/jhp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);
const fixturesDir = Path.join(__dirname, 'fixtures');
const includeResolverFixtures = Path.join(fixturesDir, 'include-resolver');
const includeChainFixtures = Path.join(fixturesDir, 'include-chain');
const includeChainDeepResolver = Path.join(includeChainFixtures, 'deep-resolver');
const simpleFixture = Path.join(fixturesDir, 'simple.jhp');

/** Exact line JHP outputs when `$include` cannot be resolved (`#include` in `src/jhp.js`). */
const expectedUnableToResolveInclude = (includeArgument) => {
    return `<< Error: Unable to resolve include path '${includeArgument}' >>`;
};

/**
 * Asserts the full JHP include error is present (not just a substring). Logs a short HTML snip for failures.
 * @param {string} html - Processed output
 * @param {string} includeArgument - The path/token passed to `$include(...)` in the template
 * @param {import('node:test').TestContext} [t] - When given, a diagnostic is printed (verbose runs)
 */
const assertIncludeUnresolved = (html, includeArgument, t) => {
    const expected = expectedUnableToResolveInclude(includeArgument);
    if (t) {
        t.diagnostic(`expect output to contain: ${expected}`);
    }
    assert.ok(
        html.includes(expected),
        `Expected exact JHP line for unresolved include. Want substring:\n${expected}\n--- HTML (first 800 chars) ---\n${html.slice(0, 800)}`
    );
};

/**
 * Resolver for include-resolver fixtures: maps tags to files and supports nested ./ resolution.
 * @param {string} root - Absolute path to the include-resolver fixture root
 * @param {import('node:test').TestContext} t - Test context for diagnostics
 * @returns {(file: string, currentDir: string) => (string | null)} Resolver
 */
const createTaggedResolver = (root, t) => {
    return (file, currentDir) => {
        t.diagnostic(`[resolver] file="${file}"  currentDir="${currentDir}"`);
        if (file === 'RESOLVE:inner') {
            return Path.join(root, 'sub', 'inner.jhp');
        }
        if (file === 'REL:leaf') {
            return 'leaf.html';
        }
        if (file === './sibling.html') {
            return Path.join(currentDir, 'sibling.html');
        }
        return null;
    };
};

/**
 * Resolver for deep-resolver fixtures: RCH: steps plus root-anchored `/also-root.html` in the same run.
 * @param {import('node:test').TestContext} t - Test context for diagnostics
 * @returns {(file: string, currentDir: string) => (string | null)} Resolver
 */
const createDeepResolverChain = (t) => {
    return (file, currentDir) => {
        t.diagnostic(`[deep-resolver chain] file="${file}"  currentDir="${currentDir}"`);
        if (file === 'RCH:2') {
            return Path.join(includeChainDeepResolver, 'step-2.jhp');
        }
        if (file === 'RCH:3') {
            return Path.join(includeChainDeepResolver, 'sub', 'step-3.jhp');
        }
        if (file === 'RCH:4') {
            return Path.join(includeChainDeepResolver, 'step-4.jhp');
        }
        if (file === 'RCH:5') {
            return Path.join(includeChainDeepResolver, 'step-5.html');
        }
        if (file === '/also-root.html') {
            return Path.join(includeChainDeepResolver, 'also-root.html');
        }
        return null;
    };
};

test('JHP - Include', async (t) => {
    await t.test('include resolves and injects partial content', () => {
        const jhp = new JHP();
        const filePath = Path.join(fixturesDir, 'simple.jhp');
        const html = jhp.process(filePath);
        assert.ok(html.includes('Before'));
        assert.ok(html.includes('After'));
        assert.ok(html.includes('Included content'));
        assert.ok(html.includes('class="included"'));
    });

    await t.test('include with cwd when processing code string', () => {
        const jhp = new JHP();
        const html = jhp.process(`
<p>Start</p>
<script>$include('./partial.html');</script>
<p>End</p>
`, { cwd: fixturesDir });
        assert.ok(html.includes('Included content'));
        assert.ok(html.includes('Start'));
        assert.ok(html.includes('End'));
    });

    await t.test('built-in: missing relative file uses exact unresolved-include error line', (t) => {
        t.diagnostic('JHP has no separate warning channel for includes; failure is this << Error: ... >> line.');
        const missing = './no-such-partial-for-path-test-99999.html';
        const jhp = new JHP();
        const html = jhp.process(`
<script>$include('${missing}');</script>
`, { cwd: fixturesDir });
        assertIncludeUnresolved(html, missing, t);
    });

    await t.test('built-in: missing root-anchored path (/...) uses exact error; root is cwd for code input', (t) => {
        const missing = '/no-such-root-file-path-test-99999.html';
        const jhp = new JHP();
        const html = jhp.process(`
<script>$include('${missing}');</script>
`, { cwd: fixturesDir });
        assertIncludeUnresolved(html, missing, t);
    });

    await t.test('built-in: include string from double-quoted $include appears in error unchanged', (t) => {
        const token = 'DOUBLE_QUOTED_MISSING_TOKEN_99999';
        const jhp = new JHP();
        const html = jhp.process(`
<script>$include("${token}");</script>
`, { cwd: fixturesDir });
        assertIncludeUnresolved(html, token, t);
    });
});

test('JHP - includePathResolver and pathing (verbose)', async (t) => {
    await t.test('built-in: path starting with / resolves from JHP root (not the OS root)', () => {
        t.diagnostic('Expected: /file resolves under #rootDir for that process.');
        const jhp = new JHP();
        const mainPath = Path.join(includeResolverFixtures, 'root-style.jhp');
        const html = jhp.process(mainPath);
        assert.ok(html.includes('ROOT_RELATIVE_OK'), 'root-relative / include should read leaf-under-root.html');
    });

    await t.test('includePathResolver: host maps custom include string to a file path', () => {
        t.diagnostic('Resolver returns an absolute path; file content is inlined.');
        const jhp = new JHP();
        const mainPath = Path.join(includeResolverFixtures, 'main.jhp');
        const html = jhp.process(mainPath, {
            includePathResolver: createTaggedResolver(includeResolverFixtures, t)
        });
        assert.ok(html.includes('INNER_START'), 'nested.jhp should run');
        assert.ok(html.includes('NESTED_SIBLING'), 'nested $include in inner.jhp should resolve');
    });

    await t.test('includePathResolver: nested $include uses correct currentDir (sub/ for ./sibling)', () => {
        t.diagnostic('Second include: currentDir must be the directory of inner.jhp (sub/).');
        const jhp = new JHP();
        const mainPath = Path.join(includeResolverFixtures, 'main.jhp');
        const seen = /** @type {{ dirs: string[] }} */ ({ dirs: [] });
        const html = jhp.process(mainPath, {
            includePathResolver: (file, currentDir) => {
                seen.dirs.push(currentDir);
                return createTaggedResolver(includeResolverFixtures, t)(file, currentDir);
            }
        });
        assert.ok(html.includes('NESTED_SIBLING'));
        const subDir = Path.join(includeResolverFixtures, 'sub');
        assert.ok(
            seen.dirs.some((d) => { return Path.resolve(d) === Path.resolve(subDir); }),
            `expected currentDir to include sub folder; got: ${JSON.stringify(seen.dirs)}`
        );
    });

    await t.test('built-in: deep chain with mixed path shapes (./, /, ./, ../, /) across five files', (st) => {
        st.diagnostic('Chain: entry(./) -> l1(/) -> l2(./) -> l3(../) -> l4(/) -> final. No custom resolver.');
        const jhp = new JHP();
        const entryPath = Path.join(includeChainFixtures, 'entry.jhp');
        const html = jhp.process(entryPath);
        assert.ok(html.includes('DEEP_MIXED_BUILT_IN_CHAIN'), 'final file in chain should render');
        assert.ok(html.includes('ENTRY'), 'entry.jhp should run');
        assert.ok(html.includes('L1'), 'a/l1.jhp');
        assert.ok(html.includes('L2'), 'a/l2.jhp (via /a/l2.jhp from root)');
        assert.ok(html.includes('L3'), 'a/b/l3.jhp');
        assert.ok(html.includes('L4'), 'a/c/l4.jhp (via ../c from a/b)');
    });

    await t.test('includePathResolver: deep chain; RCH: tokens, root-anchored /, and subdir file', (st) => {
        st.diagnostic('Every include goes through the resolver. Mix of RCH:n and /also-root.html on step-4.');
        const jhp = new JHP();
        const entryPath = Path.join(includeChainDeepResolver, 'entry.jhp');
        const seen = /** @type {{ file: string, currentDir: string }[]} */ ({ list: [] });
        const resolve = createDeepResolverChain(st);
        const html = jhp.process(entryPath, {
            includePathResolver: (file, currentDir) => {
                seen.list.push({ file, currentDir });
                return resolve(file, currentDir);
            }
        });
        assert.ok(html.includes('RCH5_DONE'), 'RCH:5 at bottom of stack');
        assert.ok(html.includes('ALSO_ROOT_IN_DEEP'), 'second include on step-4, root-style, still via resolver');
        const sub3 = Path.join(includeChainDeepResolver, 'sub');
        assert.ok(
            seen.list.some((row) => {
                return row.file === 'RCH:4' && Path.resolve(row.currentDir) === Path.resolve(sub3);
            }),
            'RCH:4 should be resolved with currentDir = deep-resolver/sub (where step-3.jhp lives)'
        );
    });

    await t.test('includePathResolver: null does not fall back to built-in resolution', () => {
        t.diagnostic('With resolver set, null means not found, even if a file exists for built-in rules.');
        const jhp = new JHP();
        const relPath = './resolvable-by-builtin.html';
        const code = `<script>$include('${relPath}');</script>`;
        const html = jhp.process(code, {
            cwd: includeResolverFixtures,
            includePathResolver: () => {
                t.diagnostic('[resolver] returning null (host declines every path)');
                return null;
            }
        });
        assertIncludeUnresolved(html, relPath, t);
        assert.ok(!html.includes('WOULD_RESOLVE_WITHOUT_RESOLVER'), 'must not inline file when resolver returns null');
    });

    await t.test('includePathResolver: non-absolute return is resolved with currentDir', () => {
        t.diagnostic('Host may return a relative string; JHP joins with currentDir.');
        const jhp = new JHP();
        const code = `<script>$include('REL:leaf');</script>`;
        const html = jhp.process(code, {
            cwd: includeResolverFixtures,
            includePathResolver: createTaggedResolver(includeResolverFixtures, t)
        });
        assert.ok(html.includes('RESOLVER_LEAF_OK'));
    });

    await t.test('includePathResolver: path that does not exist on disk is unresolved (same user-facing line)', (st) => {
        const jhp = new JHP();
        const code = '<script>$include("x");</script>';
        const html = jhp.process(code, {
            cwd: includeResolverFixtures,
            includePathResolver: () => {
                return Path.join(includeResolverFixtures, 'file-that-does-not-exist-xyz.html');
            }
        });
        assertIncludeUnresolved(html, 'x', st);
    });

    await t.test('includePathResolver: invalid option throws before processing', () => {
        const jhp = new JHP();
        assert.throws(
            () => {
                jhp.process('<p>a</p>', { includePathResolver: 'not a function' });
            },
            (err) => {
                return err instanceof TypeError && err.message === 'includePathResolver must be a function';
            }
        );
    });

    await t.test('includePathResolver is cleared after process; next process uses built-in', () => {
        t.diagnostic('Same JHP instance: first call uses resolver; second has no resolver.');
        const jhp = new JHP();
        jhp.process('<p>x</p>', {
            cwd: fixturesDir,
            includePathResolver: () => {
                return null;
            }
        });
        const html = jhp.process(simpleFixture);
        assert.ok(html.includes('Included content'), 'second process must use built-in $include for simple.jhp');
    });

    await t.test('without includePathResolver, unknown include names use built-in rules only (regression)', (t) => {
        const jhp = new JHP();
        const mainPath = Path.join(includeResolverFixtures, 'main.jhp');
        const html = jhp.process(mainPath);
        assertIncludeUnresolved(html, 'RESOLVE:inner', t);
    });

    await t.test('one page with two bad includes: each failure echoes the same error format for its path', (t) => {
        t.diagnostic('No warning vs error distinction; each miss is a full << Error: Unable to resolve... >> line.');
        const jhp = new JHP();
        const a = './multi-miss-a-99999.html';
        const b = '/multi-miss-b-99999.html';
        const html = jhp.process(`
<div class="p">
    <script>$include('${a}');</script>
    <script>$include('${b}');</script>
</div>
`, { cwd: includeResolverFixtures });
        assertIncludeUnresolved(html, a, t);
        assertIncludeUnresolved(html, b, t);
        const first = expectedUnableToResolveInclude(a);
        const second = expectedUnableToResolveInclude(b);
        const countA = (html.split(first)).length - 1;
        const countB = (html.split(second)).length - 1;
        assert.strictEqual(countA, 1, 'first missing include should appear exactly once in output');
        assert.strictEqual(countB, 1, 'second missing include should appear exactly once in output');
    });
});

test('JHP - includeSearchRoots', async (t) => {
    const isr = Path.join(fixturesDir, 'include-search-roots');
    const primary = Path.join(isr, 'primary');
    const secondary = Path.join(isr, 'secondary');
    const roots = [primary, secondary];

    await t.test('relative include: later search root supplies the file', () => {
        const jhp = new JHP();
        const entryPath = Path.join(primary, 'entry.jhp');
        const html = jhp.process(entryPath, { includeSearchRoots: roots });
        assert.ok(html.includes('ONLY_IN_SECONDARY_ROOT'));
    });

    await t.test('leading /: each root is tried in order', () => {
        const jhp = new JHP();
        const leadPath = Path.join(primary, 'lead.jhp');
        const html = jhp.process(leadPath, { includeSearchRoots: roots });
        assert.ok(html.includes('LEADING_SLASH_VIA_ROOT_ORDER'));
    });

    await t.test('includePathResolver set: includeSearchRoots is not used (resolver wins)', () => {
        const jhp = new JHP();
        const entryPath = Path.join(primary, 'entry.jhp');
        const swapIn = Path.join(primary, 'swap-via-resolver.html');
        const html = jhp.process(entryPath, {
            includeSearchRoots: roots,
            includePathResolver: (file) => {
                if (file === 'only-in-secondary.html') {
                    return swapIn;
                }
                return null;
            }
        });
        assert.ok(
            html.includes('RESOLVER_OVERRIDE_WINS'),
            'must load swap file via resolver, not the partial under secondary that search roots would use'
        );
        assert.ok(
            !html.includes('ONLY_IN_SECONDARY_ROOT'),
            'search roots must be bypassed when a resolver is set'
        );
    });

    await t.test('invalid includeSearchRoots throws TypeError', () => {
        const jhp = new JHP();
        assert.throws(
            () => {
                jhp.process('<p>x</p>', { includeSearchRoots: 'not-an-array' });
            },
            (e) => {
                return e instanceof TypeError && e.message.includes('includeSearchRoots');
            }
        );
        assert.throws(
            () => {
                jhp.process('<p>x</p>', { includeSearchRoots: ['relative/only'] });
            },
            (e) => {
                return e instanceof TypeError && e.message.includes('absolute');
            }
        );
    });

    await t.test('`../` at start: resolve only from the including file’s directory, not from search roots', () => {
        const jhp = new JHP();
        const subInner = Path.join(primary, 'sub', 'inner.jhp');
        const html = jhp.process(subInner, { includeSearchRoots: [secondary] });
        assert.ok(html.includes('PARENT_VIA_DDOT_ONLY'), '../ must find primary/… even when roots skip primary');
    });
});

