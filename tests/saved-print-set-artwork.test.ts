import assert from 'node:assert/strict';
import test from 'node:test';

import type { PrintQueueEntrySnapshot } from '../src/models/print-queue';
import { PrintQueueService } from '../src/models/print-queue';
import { SavedPrintSetService } from '../src/models/saved-print-set';
import type { ArtworkImportPayload } from '../src/services/artwork-importer-core';
import { prepareSavedPrintSetEntries } from '../src/services/saved-print-set-artwork';

function createVault(failWrite = false): {
	vault: {
		getAbstractFileByPath(path: string): unknown;
		createFolder(path: string): Promise<unknown>;
		createBinary(path: string, data: ArrayBuffer): Promise<unknown>;
	};
	entries: Map<string, unknown>;
	writes: Array<{ path: string; size: number }>;
} {
	const entries = new Map<string, unknown>();
	const writes: Array<{ path: string; size: number }> = [];
	return {
		vault: {
			getAbstractFileByPath: (path) => entries.get(path) ?? null,
			createFolder: async (path) => { entries.set(path, { path, children: [] }); },
			createBinary: async (path, data) => {
				if (failWrite) {
					throw new Error('simulated artwork write failure');
				}
				entries.set(path, { path });
				writes.push({ path, size: data.byteLength });
				return entries.get(path);
			},
		},
		entries,
		writes,
	};
}

function payload(fileName: string, size: number): ArtworkImportPayload {
	return { fileName, data: new Uint8Array(size).buffer };
}

void test('local and HTTPS temporary artwork persist in the configured Assets folder', async () => {
	const entries: PrintQueueEntrySnapshot[] = [
		{
			filePath: 'items/local.md',
			quantity: 1,
			overrides: {
				artwork: { kind: 'temporary', id: 'local-art', name: 'Local Sword.PNG', origin: 'local' },
			},
		},
		{
			filePath: 'items/https.md',
			quantity: 1,
			overrides: {
				artwork: { kind: 'temporary', id: 'https-art', name: 'Remote Wand.webp', origin: 'https' },
			},
		},
	];
	const available = new Map([
		['local-art', payload('Local Sword.PNG', 3)],
		['https-art', payload('Remote Wand.webp', 4)],
	]);
	const { vault, writes } = createVault();
	const prepared = await prepareSavedPrintSetEntries(
		entries,
		vault,
		{ getPayload: (id) => available.get(id) },
		'Z_Attachments/TTRPG/Card Forge Assets',
	);
	assert.equal(prepared.status, 'ready');
	if (prepared.status !== 'ready') {
		return;
	}
	assert.equal(prepared.persistedArtworkCount, 2);
	assert.deepEqual(writes.map((write) => write.path), [
		'Z_Attachments/TTRPG/Card Forge Assets/local-sword.png',
		'Z_Attachments/TTRPG/Card Forge Assets/remote-wand.webp',
	]);
	assert.deepEqual(prepared.entries.map((entry) => entry.overrides?.artwork), [
		{ kind: 'vault', path: writes[0]!.path },
		{ kind: 'vault', path: writes[1]!.path },
	]);

	const sets = new SavedPrintSetService([], () => 'art-set', () => 1);
	const saved = sets.save('Artwork Test', prepared.entries);
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	const restarted = new SavedPrintSetService(
		JSON.parse(JSON.stringify(sets.serialize())) as unknown,
		() => 'unused',
		() => 2,
	);
	const queue = new PrintQueueService([], () => 'loaded');
	const loaded = restarted.loadIntoQueue(
		saved.set.id,
		queue,
		new Set(['items/local.md', 'items/https.md']),
	);
	assert.equal(loaded.status, 'loaded');
	assert.deepEqual(queue.getEntries().map((entry) => entry.overrides?.artwork?.kind), [
		'vault',
		'vault',
	]);
});

void test('source, vault, and none artwork are not duplicated', async () => {
	const entries: PrintQueueEntrySnapshot[] = [
		{ filePath: 'items/source.md', quantity: 1 },
		{
			filePath: 'items/vault.md',
			quantity: 1,
			overrides: { artwork: { kind: 'vault', path: 'Existing/art.webp' } },
		},
		{
			filePath: 'items/none.md',
			quantity: 1,
			overrides: { artwork: { kind: 'none' } },
		},
	];
	const { vault, writes } = createVault();
	const prepared = await prepareSavedPrintSetEntries(
		entries,
		vault,
		{ getPayload: () => undefined },
		'Assets',
	);
	assert.equal(prepared.status, 'ready');
	if (prepared.status !== 'ready') {
		return;
	}
	assert.equal(prepared.persistedArtworkCount, 0);
	assert.deepEqual(prepared.entries, entries);
	assert.deepEqual(writes, []);
});

void test('one save writes a shared temporary resource once and reuses its Vault path', async () => {
	const entries: PrintQueueEntrySnapshot[] = ['a', 'b'].map((name) => ({
		filePath: `items/${name}.md`,
		quantity: 1,
		overrides: {
			artwork: { kind: 'temporary' as const, id: 'shared', name: 'Shared.png', origin: 'local' as const },
		},
	}));
	const { vault, writes } = createVault();
	const prepared = await prepareSavedPrintSetEntries(
		entries,
		vault,
		{ getPayload: (id) => id === 'shared' ? payload('Shared.png', 5) : undefined },
		'Assets',
	);
	assert.equal(prepared.status, 'ready');
	if (prepared.status !== 'ready') {
		return;
	}
	assert.equal(writes.length, 1);
	assert.deepEqual(prepared.entries.map((entry) => entry.overrides?.artwork), [
		{ kind: 'vault', path: 'Assets/shared.png' },
		{ kind: 'vault', path: 'Assets/shared.png' },
	]);
});

void test('missing temporary artwork blocks preparation before any Vault write', async () => {
	const { vault, writes } = createVault();
	const prepared = await prepareSavedPrintSetEntries([{
		filePath: 'items/missing.md',
		quantity: 1,
		overrides: { artwork: { kind: 'temporary', id: 'missing', origin: 'local' } },
	}], vault, { getPayload: () => undefined }, 'Assets');
	assert.deepEqual(prepared, {
		status: 'missing-artwork',
		temporaryArtworkId: 'missing',
	});
	assert.deepEqual(writes, []);
});

void test('artwork persistence failure leaves existing and new Saved Set records untouched', async () => {
	const queueEntry: PrintQueueEntrySnapshot = {
		filePath: 'items/a.md',
		quantity: 1,
		overrides: { artwork: { kind: 'temporary', id: 'failing', origin: 'https' } },
	};
	const sets = new SavedPrintSetService([], () => 'existing', () => 1);
	const existing = sets.save('Existing', [{ filePath: 'items/original.md', quantity: 1 }]);
	assert.equal(existing.status, 'created');
	const before = sets.serialize();
	const { vault } = createVault(true);
	await assert.rejects(
		prepareSavedPrintSetEntries(
			[queueEntry],
			vault,
			{ getPayload: () => payload('Failure.png', 2) },
			'Assets',
		),
		/simulated artwork write failure/u,
	);
	assert.deepEqual(sets.serialize(), before);
	assert.equal(sets.getSetByName('Save As Failure'), undefined);
});

void test('deleting a Saved Set never removes its persisted artwork', async () => {
	const { vault, entries } = createVault();
	const prepared = await prepareSavedPrintSetEntries([{
		filePath: 'items/a.md',
		quantity: 1,
		overrides: { artwork: { kind: 'temporary', id: 'art', origin: 'local' } },
	}], vault, { getPayload: () => payload('Keep.png', 2) }, 'Assets');
	assert.equal(prepared.status, 'ready');
	if (prepared.status !== 'ready') {
		return;
	}
	const sets = new SavedPrintSetService([], () => 'set', () => 1);
	const saved = sets.save('Keep asset', prepared.entries);
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	assert.equal(sets.delete(saved.set.id), true);
	assert.ok(entries.has('Assets/keep.png'));
});
