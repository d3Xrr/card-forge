import assert from 'node:assert/strict';
import test from 'node:test';

import { selectArtworkStorage } from '../src/services/artwork-selection';
import { TemporaryArtworkStore } from '../src/services/temporary-artwork-store';

void test('temporary local and HTTPS selections do not write to the vault by default', async () => {
	const writes: string[] = [];
	const revoked: string[] = [];
	let nextUrl = 1;
	let nextId = 1;
	const store = new TemporaryArtworkStore({
		create: () => `blob:test-${nextUrl++}`,
		revoke: (url) => revoked.push(url),
	}, () => `asset-${nextId++}`);
	const vault = createVault(writes);

	const local = await selectArtworkStorage(vault, store, payload('local.png'), {
		persist: false,
		origin: 'local',
	});
	const https = await selectArtworkStorage(vault, store, payload('remote.webp'), {
		persist: false,
		origin: 'https',
		folder: 'Never Created/Artwork',
	});
	assert.deepEqual(writes, []);
	assert.equal(local.override.kind, 'temporary');
	assert.equal(https.override.kind, 'temporary');
	assert.equal(store.size, 2);
	assert.deepEqual(revoked, []);
});

void test('explicit persistence writes exactly one collision-safe vault asset', async () => {
	const writes: string[] = [];
	const store = createStore();
	const selected = await selectArtworkStorage(
		createVault(writes),
		store,
		payload('Blade.png'),
		{ persist: true, origin: 'local' },
	);
	assert.deepEqual(writes, ['Card Forge Assets/blade.png']);
	assert.deepEqual(selected.override, {
		kind: 'vault',
		path: 'Card Forge Assets/blade.png',
	});
	assert.equal(store.size, 0);
});

void test('owner references revoke replaced, discarded, and removed temporary assets', () => {
	const revoked: string[] = [];
	let next = 1;
	const store = new TemporaryArtworkStore({
		create: () => `blob:asset-${next}`,
		revoke: (url) => revoked.push(url),
	}, () => `asset-${next++}`);
	const first = store.create(payload('first.png'));
	store.setOwnerReferences('draft', [first.id]);
	const second = store.create(payload('second.png'));
	store.setOwnerReferences('draft', [second.id]);
	assert.equal(store.get(first.id), undefined);
	assert.deepEqual(revoked, [first.resourcePath]);
	store.setOwnerReferences('queue', [second.id]);
	store.releaseOwner('draft');
	assert.ok(store.get(second.id));
	store.releaseOwner('queue');
	assert.equal(store.get(second.id), undefined);
	assert.deepEqual(revoked, [first.resourcePath, second.resourcePath]);
});

void test('missing session artwork after reload is detectable and cleanup revokes all URLs', () => {
	const revoked: string[] = [];
	const original = new TemporaryArtworkStore({
		create: () => 'blob:original',
		revoke: (url) => revoked.push(url),
	}, () => 'temporary-id');
	const asset = original.create(payload('session.png'));
	original.setOwnerReferences('queue', [asset.id]);
	const reloaded = createStore();
	assert.equal(reloaded.get(asset.id), undefined);
	original.clear();
	assert.deepEqual(revoked, ['blob:original']);
});

function payload(fileName: string): { data: ArrayBuffer; fileName: string; mimeType: string } {
	return { data: new ArrayBuffer(8), fileName, mimeType: 'image/png' };
}

function createStore(): TemporaryArtworkStore {
	return new TemporaryArtworkStore({
		create: () => 'blob:test',
		revoke: () => undefined,
	}, () => 'asset');
}

function createVault(writes: string[]): {
	getAbstractFileByPath(path: string): unknown;
	createFolder(path: string): Promise<void>;
	createBinary(path: string): Promise<void>;
} {
	const paths = new Set<string>();
	return {
		getAbstractFileByPath: (path) => paths.has(path) ? { children: [] } : null,
		createFolder: async (path) => { paths.add(path); },
		createBinary: async (path) => { paths.add(path); writes.push(path); },
	};
}
