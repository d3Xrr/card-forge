import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CARD_FORGE_ASSET_FOLDER,
	sanitizeArtworkFileName,
	storeImportedArtwork,
	validateHttpsArtworkUrl,
} from '../src/services/artwork-importer-core';

void test('imports into the managed folder with collision-safe filenames only', async () => {
	const files = new Set<string>([CARD_FORGE_ASSET_FOLDER, `${CARD_FORGE_ASSET_FOLDER}/blade.png`]);
	const writes: string[] = [];
	let sourceModifyCalls = 0;
	const vault = {
		getAbstractFileByPath: (path: string) => files.has(path) ? {} : null,
		createFolder: async (path: string) => { files.add(path); },
		createBinary: async (path: string) => { files.add(path); writes.push(path); },
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

void test('sanitizes local filenames and accepts HTTPS only', () => {
	assert.equal(sanitizeArtworkFileName('My Sword?.WEBP'), 'my-sword.webp');
	assert.equal(validateHttpsArtworkUrl('https://example.com/art.png').protocol, 'https:');
	assert.throws(() => validateHttpsArtworkUrl('http://example.com/art.png'), /HTTPS/u);
});
