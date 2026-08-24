import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildExportGalleryState,
	deleteGalleryExport,
	isCardForgeExportFileName,
	openGalleryExport,
} from '../src/services/export-gallery';

void test('missing and unreadable export folders produce clean empty states', () => {
	assert.deepEqual(buildExportGalleryState({ status: 'missing' }), {
		status: 'missing',
		entries: [],
	});
	assert.deepEqual(buildExportGalleryState({ status: 'unreadable' }), {
		status: 'unreadable',
		entries: [],
	});
	assert.deepEqual(buildExportGalleryState({ status: 'ready', files: [] }), {
		status: 'ready',
		entries: [],
	});
});

void test('recognizes only canonical Card Forge PDF names and sorts newest first', () => {
	assert.equal(isCardForgeExportFileName('card-forge-2026-08-24-1415.pdf'), true);
	assert.equal(isCardForgeExportFileName('card-forge-2026-08-24-1415-2.pdf'), true);
	assert.equal(isCardForgeExportFileName('card-forge-2026-08-24-1415-10.pdf'), true);
	assert.equal(isCardForgeExportFileName('card-forge-2026-18-24-1415.pdf'), false);
	assert.equal(isCardForgeExportFileName('unrelated.pdf'), false);
	assert.equal(isCardForgeExportFileName('card-forge-not-a-date.pdf'), false);

	const state = buildExportGalleryState({
		status: 'ready',
		files: [
			{
				path: 'Exports/card-forge-2026-08-24-1300.pdf',
				name: 'card-forge-2026-08-24-1300.pdf',
				modifiedTime: 100,
				size: 10,
			},
			{
				path: 'Exports/unrelated.pdf',
				name: 'unrelated.pdf',
				modifiedTime: 300,
				size: 99,
			},
			{
				path: 'Exports/card-forge-2026-08-24-1400.pdf',
				name: 'card-forge-2026-08-24-1400.pdf',
				modifiedTime: 200,
				size: 20,
			},
		],
	});
	assert.equal(state.status, 'ready');
	assert.deepEqual(state.entries.map((entry) => [entry.name, entry.modifiedTime, entry.size]), [
		['card-forge-2026-08-24-1400.pdf', 200, 20],
		['card-forge-2026-08-24-1300.pdf', 100, 10],
	]);
});

void test('Open and confirmed Delete target only the selected recognized export', async () => {
	const exportEntry = {
		path: 'Exports/card-forge-2026-08-24-1415.pdf',
		name: 'card-forge-2026-08-24-1415.pdf',
		modifiedTime: 1,
		size: 100,
	};
	const unrelatedEntry = { ...exportEntry, path: 'Exports/notes.pdf', name: 'notes.pdf' };
	const opened: string[] = [];
	const trashed: string[] = [];
	assert.equal(await openGalleryExport(exportEntry, async (path) => {
		opened.push(path);
	}), true);
	assert.equal(await openGalleryExport(unrelatedEntry, async (path) => {
		opened.push(path);
	}), false);
	assert.equal(await deleteGalleryExport(exportEntry, false, async (path) => {
		trashed.push(path);
	}), false);
	assert.equal(await deleteGalleryExport(exportEntry, true, async (path) => {
		trashed.push(path);
	}), true);
	assert.equal(await deleteGalleryExport(unrelatedEntry, true, async (path) => {
		trashed.push(path);
	}), false);
	assert.deepEqual(opened, [exportEntry.path]);
	assert.deepEqual(trashed, [exportEntry.path]);
});

void test('folder changes are represented by a fresh lightweight snapshot with no polling metadata', () => {
	const firstFolder = buildExportGalleryState({
		status: 'ready',
		files: [{
			path: 'First/card-forge-2026-08-24-1200.pdf',
			name: 'card-forge-2026-08-24-1200.pdf',
			modifiedTime: 1,
			size: 1,
		}],
	});
	const secondFolder = buildExportGalleryState({
		status: 'ready',
		files: [{
			path: 'Second/card-forge-2026-08-24-1300.pdf',
			name: 'card-forge-2026-08-24-1300.pdf',
			modifiedTime: 2,
			size: 2,
		}],
	});
	assert.deepEqual(firstFolder.entries.map((entry) => entry.path), [
		'First/card-forge-2026-08-24-1200.pdf',
	]);
	assert.deepEqual(secondFolder.entries.map((entry) => entry.path), [
		'Second/card-forge-2026-08-24-1300.pdf',
	]);
	const refreshedSecondFolder = buildExportGalleryState({
		status: 'ready',
		files: [
			...secondFolder.entries,
			{
				path: 'Second/card-forge-2026-08-24-1400.pdf',
				name: 'card-forge-2026-08-24-1400.pdf',
				modifiedTime: 3,
				size: 3,
			},
		],
	});
	assert.deepEqual(refreshedSecondFolder.entries.map((entry) => entry.modifiedTime), [3, 2]);
	assert.equal('timer' in secondFolder, false);
	assert.equal('thumbnail' in secondFolder, false);
});
