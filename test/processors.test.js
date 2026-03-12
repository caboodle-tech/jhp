/**
 * Tests for JHP pre and post processors.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import JHP from '../src/jhp.js';

test('JHP - Processors', async (t) => {
    await t.test('pre-processor can modify DOM before output', () => {
        const addMarker = (scope) => {
            const main = scope.dom.querySelector('main');
            if (main) {
                const div = scope.dom.createNode(
                    'div',
                    { 'data-pre': 'true' },
                    'Pre content'
                );
                main.appendChild(div);
            }
        };
        const jhp = new JHP({ preProcessors: [addMarker] });
        const html = jhp.process(`
<script></script>
<main></main>
`, { cwd: process.cwd() });
        assert.ok(html.includes('Pre content'));
        assert.ok(html.includes('data-pre="true"'));
        assert.ok(html.includes('<main>'));
    });

    await t.test('post-processor runs after template processing', () => {
        const addMarker = (scope) => {
            const body = scope.dom.querySelector('body');
            if (body) {
                const div = scope.dom.createNode(
                    'div',
                    { 'data-post': 'true' },
                    'Post content'
                );
                body.appendChild(div);
            }
        };
        const jhp = new JHP({ postProcessors: [addMarker] });
        const html = jhp.process(`
<script></script>
<body><p>Body</p></body>
`, { cwd: process.cwd() });
        assert.ok(html.includes('Post content'));
        assert.ok(html.includes('data-post="true"'));
        assert.ok(html.includes('Body'));
    });
});
