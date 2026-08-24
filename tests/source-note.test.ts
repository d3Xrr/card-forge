import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadSourceNote } from '../src/services/source-note';
import {
	isCurrentSourceNoteRender,
	SourceNoteScrollMemory,
} from '../src/services/source-note-scroll';

void test('loads the exact current source Markdown without accepting card overrides', async () => {
	const original = '---\nname: +1 Weapon\n---\n\nOriginal source rules.';
	let requestedPath = '';
	const result = await loadSourceNote('items/weapon.md', (filePath) => {
		requestedPath = filePath;
		return Promise.resolve(original);
	});
	assert.equal(requestedPath, 'items/weapon.md');
	assert.deepEqual(result, {
		status: 'ready',
		filePath: 'items/weapon.md',
		markdown: original,
	});
	assert.doesNotMatch(JSON.stringify(result), /Sword of Khaine/u);
});

void test('re-reads the source path on every request instead of retaining a persisted copy', async () => {
	let current = 'Item A source';
	const first = await loadSourceNote('items/a.md', () => Promise.resolve(current));
	current = 'Item A updated source';
	const second = await loadSourceNote('items/a.md', () => Promise.resolve(current));
	const itemB = await loadSourceNote('items/b.md', (filePath) => Promise.resolve(`${filePath} source`));
	assert.equal(first.status === 'ready' ? first.markdown : '', 'Item A source');
	assert.equal(second.status === 'ready' ? second.markdown : '', 'Item A updated source');
	assert.equal(itemB.status === 'ready' ? itemB.markdown : '', 'items/b.md source');
});

void test('missing and unreadable source notes fail with clear read-only results', async () => {
	assert.equal((await loadSourceNote('missing.md', () => Promise.resolve(undefined))).status, 'missing');
	const originalError = console.error;
	console.error = () => undefined;
	try {
		assert.equal((await loadSourceNote('broken.md', () => Promise.reject(new Error('read failed')))).status, 'error');
	} finally {
		console.error = originalError;
	}
});

void test('Source note scroll memory is independent per source and clamps safely', () => {
	const memory = new SourceNoteScrollMemory();
	assert.equal(memory.restore('items/unseen.md', 2_000), 0);
	memory.remember('items/a.md', 1_800);
	memory.remember('items/b.md', 400);
	assert.equal(memory.restore('items/a.md', 3_000), 1_800);
	assert.equal(memory.restore('items/b.md', 3_000), 400);
	assert.equal(memory.restore('items/a.md', 900), 900);
	memory.remember('items/a.md', Number.POSITIVE_INFINITY);
	assert.equal(memory.restore('items/a.md', 900), 0);
});

void test('stale Source note renders cannot restore another source scroll position', () => {
	assert.equal(isCurrentSourceNoteRender('items/a.md', 1, 'items/a.md', 1, 'source-note'), true);
	assert.equal(isCurrentSourceNoteRender('items/a.md', 1, 'items/b.md', 2, 'source-note'), false);
	assert.equal(isCurrentSourceNoteRender('items/b.md', 1, 'items/b.md', 2, 'source-note'), false);
	assert.equal(isCurrentSourceNoteRender('items/b.md', 2, 'items/b.md', 2, 'preview'), false);
});

void test('Source note integration is native-rendered, read-only, and context-scoped', () => {
	const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
	const css = readFileSync('styles.css', 'utf8');
	const modeStart = view.indexOf('private setPreviewMode');
	const modeEnd = view.indexOf('private resetEditorSession', modeStart);
	const setModeMethod = view.slice(modeStart, modeEnd);
	const start = view.indexOf('private async renderSourceNote');
	const end = view.indexOf('private async planAndRenderPreview', start);
	const sourceNoteMethod = view.slice(start, end);
	assert.match(view, /text: 'Source note'/u);
	assert.match(view, /text: 'Open source note'/u);
	assert.equal(view.match(/text: 'Open source note'/gu)?.length, 2);
	assert.match(view, /previewActionsElement\?\.toggleAttribute\('hidden', !modeState\.showGlobalPreviewActions\)/u);
	assert.doesNotMatch(setModeMethod, /draftOverrides|appliedOverrides|printQueue|resetEditorSession/u);
	assert.match(sourceNoteMethod, /vault\.cachedRead/u);
	assert.match(sourceNoteMethod, /MarkdownRenderer\.render/u);
	assert.doesNotMatch(sourceNoteMethod, /draftOverrides|appliedOverrides|contenteditable|createEl\('textarea'/u);
	assert.match(view, /sourceNoteGeneration/u);
	assert.match(sourceNoteMethod, /isCurrentSourceNoteRender/u);
	assert.match(sourceNoteMethod, /requestAnimationFrame/u);
	assert.match(sourceNoteMethod, /scrollHeight/u);
	assert.match(view, /SourceNoteScrollMemory/u);
	assert.doesNotMatch(view, /sourceNoteScrollMemory[\s\S]{0,120}persistPluginData/u);
	assert.match(
		css,
		/\.ttrpg-card-forge__preview\.is-source-note \.ttrpg-card-forge__preview-content\s*\{\s*display: none;/u,
	);
	assert.match(css, /\.ttrpg-card-forge__source-note\s*\{[\s\S]*flex: 1 1 auto;[\s\S]*overflow: hidden;/u);
	assert.match(css, /\.ttrpg-card-forge__source-note-content\s*\{[\s\S]*overflow: auto;/u);
	assert.match(
		css,
		/\.ttrpg-card-forge__preview\.is-editing \.ttrpg-card-forge__preview-content[\s\S]*display: grid;[\s\S]*\.ttrpg-card-forge__preview\.is-editing \.ttrpg-card-forge__card-preview-region[\s\S]*grid-column: 2;/u,
	);
	assert.match(
		css,
		/\.ttrpg-card-forge__card-preview-region\s*\{[\s\S]*align-items: center;[\s\S]*justify-content: center;/u,
	);
});
