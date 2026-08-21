import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CARD_FORGE_ASSET_FOLDER,
	normalizeArtworkAssetFolder,
	sanitizeArtworkFileName,
	storeImportedArtwork,
	validateHttpsArtworkUrl,
} from '../src/services/artwork-importer-core';

void test('imports into the managed folder with collision-safe filenames only', async () => {
	const entries = new Map<string, unknown>([
		[CARD_FORGE_ASSET_FOLDER, { children: [] }],
		[`${CARD_FORGE_ASSET_FOLDER}/blade.png`, { path: `${CARD_FORGE_ASSET_FOLDER}/blade.png` }],
	]);
	const writes: string[] = [];
	let sourceModifyCalls = 0;
	const vault = {
		getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
		createFolder: async (path: string) => { entries.set(path, { children: [] }); },
		createBinary: async (path: string) => { entries.set(path, { path }); writes.push(path); },
		modify: async () => { sourceModifyCalls += 1; },
	};
	const path = await storeImportedArtwork(vault, {
		data: new ArrayBuffer(4),
		fileName: 'Blade.png',
	});
	assert.equal(path, `${CARD_FORGE_ASSET_FOLDER}/blade-2.png`);
	assert.deepEqual(writes, [path]);
	assert.equal(sourceModifyCalls, 0);
});

void test('normalizes the default, custom, trailing-separator, and vault-root folders', () => {
	assert.equal(normalizeArtworkAssetFolder(''), CARD_FORGE_ASSET_FOLDER);
	assert.equal(normalizeArtworkAssetFolder('  Custom\\Card Forge Assets\\  '), 'Custom/Card Forge Assets');
	assert.equal(normalizeArtworkAssetFolder('Z_Attachments///TTRPG/Card Forge Assets/'), 'Z_Attachments/TTRPG/Card Forge Assets');
	assert.equal(normalizeArtworkAssetFolder('/'), '');
	assert.equal(normalizeArtworkAssetFolder('.'), '');
});

void test('creates only required custom folder segments and saves new assets there', async () => {
	const entries = new Map<string, unknown>([['Z_Attachments', { children: [] }]]);
	const folders: string[] = [];
	const writes: string[] = [];
	const vault = {
		getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
		createFolder: async (path: string) => {
			entries.set(path, { children: [] });
			folders.push(path);
		},
		createBinary: async (path: string) => { entries.set(path, { path }); writes.push(path); },
	};
	const path = await storeImportedArtwork(
		vault,
		{ data: new ArrayBuffer(4), fileName: 'Blade.png' },
		' Z_Attachments/TTRPG/Card Forge Assets/ ',
	);
	assert.deepEqual(folders, [
		'Z_Attachments/TTRPG',
		'Z_Attachments/TTRPG/Card Forge Assets',
	]);
	assert.equal(path, 'Z_Attachments/TTRPG/Card Forge Assets/blade.png');
	assert.deepEqual(writes, [path]);
});

void test('changing the configured folder affects only future imports', async () => {
	const existingArtworkPath = 'Card Forge Assets/sword.webp';
	const writes: string[] = [];
	const entries = new Map<string, unknown>([[existingArtworkPath, { path: existingArtworkPath }]]);
	const vault = {
		getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
		createFolder: async (path: string) => { entries.set(path, { children: [] }); },
		createBinary: async (path: string) => { entries.set(path, { path }); writes.push(path); },
	};
	const newPath = await storeImportedArtwork(
		vault,
		{ data: new ArrayBuffer(4), fileName: 'Sword.webp' },
		'Z_Attachments/Card Forge Assets',
	);
	assert.equal(existingArtworkPath, 'Card Forge Assets/sword.webp');
	assert.equal(newPath, 'Z_Attachments/Card Forge Assets/sword.webp');
	assert.deepEqual(writes, [newPath]);
});

void test('rejects traversal, absolute paths, invalid names, and file collisions in folder segments', async () => {
	assert.throws(() => normalizeArtworkAssetFolder('../outside'), /traversal/u);
	assert.throws(() => normalizeArtworkAssetFolder('nested/../outside'), /traversal/u);
	assert.throws(() => normalizeArtworkAssetFolder('C:\\outside'), /vault-relative/u);
	assert.throws(() => normalizeArtworkAssetFolder('assets:invalid'), /not valid/u);
	await assert.rejects(
		storeImportedArtwork({
			getAbstractFileByPath: (path) => path === 'Assets' ? { path } : null,
			createFolder: async () => undefined,
			createBinary: async () => undefined,
		}, { data: new ArrayBuffer(4), fileName: 'art.png' }, 'Assets/Nested'),
		/not a folder/u,
	);
});

void test('sanitizes local filenames and accepts HTTPS only', () => {
	assert.equal(sanitizeArtworkFileName('My Sword?.WEBP'), 'my-sword.webp');
	assert.equal(validateHttpsArtworkUrl('https://example.com/art.png').protocol, 'https:');
	assert.throws(() => validateHttpsArtworkUrl('http://example.com/art.png'), /HTTPS/u);
});
