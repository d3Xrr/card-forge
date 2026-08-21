import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadSourceNote } from '../src/services/source-note';

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

void test('Source note integration is native-rendered, read-only, and context-scoped', () => {
	const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
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
	assert.match(view, /this\.selectedFilePath !== selectedFilePath/u);
});
