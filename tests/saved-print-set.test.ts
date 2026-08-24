import assert from 'node:assert/strict';
import test from 'node:test';

import { SavedPrintSetService } from '../src/models/saved-print-set';
import { PrintQueueService } from '../src/models/print-queue';
import { TemporaryArtworkStore } from '../src/services/temporary-artwork-store';

function createQueue(prefix = 'queue'): PrintQueueService {
	let nextId = 1;
	return new PrintQueueService([], () => `${prefix}-${nextId++}`);
}

function createSets(times = [100, 200, 300, 400, 500]): SavedPrintSetService {
	let nextId = 1;
	let timeIndex = 0;
	return new SavedPrintSetService(
		[],
		() => `set-${nextId++}`,
		() => times[timeIndex++] ?? 1_000 + timeIndex,
	);
}

void test('saves ordered queue snapshots with quantities and deeply independent overrides', () => {
	const queue = createQueue();
	const first = queue.add('items/weapon.md', {
		title: '+1 Longsword',
		variant: { id: 'longsword' },
		rulesMarkdown: `Page one\n\n///CARD BREAK///\n\nPage two`,
		stats: { properties: ['versatile'], damage: '1d8 + 1' },
		artwork: { kind: 'vault', path: 'Card Forge Assets/sword.webp' },
	});
	queue.increment(first.id);
	queue.add('items/wand.md');
	const sets = createSets();

	assert.deepEqual(sets.save('   ', queue.getEntries()), { status: 'invalid-name' });
	assert.deepEqual(sets.save('Empty', []), { status: 'empty-queue' });
	const result = sets.save('  Drakkenheim   Test  ', queue.getEntries());
	assert.equal(result.status, 'created');
	if (result.status !== 'created') {
		return;
	}
	assert.equal(result.set.name, 'Drakkenheim Test');
	assert.deepEqual(result.set.entries.map((entry) => entry.filePath), [
		'items/weapon.md',
		'items/wand.md',
	]);
	assert.deepEqual(result.set.entries.map((entry) => entry.quantity), [2, 1]);
	assert.notStrictEqual(result.set.entries[0]?.overrides, first.overrides);
	assert.notStrictEqual(result.set.entries[0]?.overrides?.stats, first.overrides?.stats);
	queue.updateOverrides(first.id, { title: 'Mutated live queue' });
	assert.equal(result.set.entries[0]?.overrides?.title, '+1 Longsword');
});

void test('duplicate names require explicit replacement and hydration preserves snapshots', () => {
	const queue = createQueue();
	queue.add('items/one.md', {
		artwork: { kind: 'temporary', id: 'session-art', origin: 'https' },
	});
	const sets = createSets([100, 200]);
	const created = sets.save('Potion Restock', queue.getEntries());
	assert.equal(created.status, 'created');
	if (created.status !== 'created') {
		return;
	}
	const duplicate = sets.save(' potion   restock ', queue.getEntries());
	assert.equal(duplicate.status, 'duplicate-name');
	assert.equal(sets.getSets().length, 1);
	queue.add('items/two.md');
	const replaced = sets.save('POTION RESTOCK', queue.getEntries(), true);
	assert.equal(replaced.status, 'replaced');
	if (replaced.status !== 'replaced') {
		return;
	}
	assert.equal(replaced.set.id, created.set.id);
	assert.equal(replaced.set.createdAt, 100);
	assert.equal(replaced.set.updatedAt, 200);
	assert.equal(replaced.set.entries.length, 2);
	assert.equal(replaced.containsTemporaryArtwork, true);

	const serialized = JSON.parse(JSON.stringify(sets.serialize())) as unknown;
	const restored = new SavedPrintSetService(serialized, () => 'unused', () => 999);
	assert.equal(restored.hydrationRepaired, false);
	assert.deepEqual(restored.serialize(), sets.serialize());
	assert.doesNotMatch(JSON.stringify(restored.serialize()), /blob:|base64|data:image/iu);
});

void test('rename preserves identity, enforces unique names, sorts by recency, and delete is isolated', () => {
	const queue = createQueue();
	queue.add('items/one.md');
	const sets = createSets([100, 200, 300]);
	const first = sets.save('First', queue.getEntries());
	const second = sets.save('Second', queue.getEntries());
	assert.equal(first.status, 'created');
	assert.equal(second.status, 'created');
	if (first.status !== 'created' || second.status !== 'created') {
		return;
	}
	assert.deepEqual(sets.getSets().map((set) => set.name), ['Second', 'First']);
	assert.equal(sets.rename(first.set.id, ' second ').status, 'duplicate-name');
	const renamed = sets.rename(first.set.id, 'Renamed');
	assert.equal(renamed.status, 'renamed');
	if (renamed.status !== 'renamed') {
		return;
	}
	assert.equal(renamed.set.id, first.set.id);
	assert.deepEqual(sets.getSets().map((set) => set.name), ['Renamed', 'Second']);
	const queueBeforeDelete = structuredClone(queue.getEntries());
	assert.equal(sets.delete(second.set.id), true);
	assert.equal(sets.getSets().length, 1);
	assert.deepEqual(queue.getEntries(), queueBeforeDelete);
});

void test('Save updates one set in place without changing its identity or name', () => {
	const queue = createQueue();
	queue.add('items/one.md');
	const sets = createSets([100, 200]);
	const created = sets.save('Active Set', queue.getEntries());
	assert.equal(created.status, 'created');
	if (created.status !== 'created') {
		return;
	}
	queue.add('items/two.md', { title: 'Edited' });
	const updated = sets.update(created.set.id, queue.getEntries());
	assert.equal(updated.status, 'updated');
	if (updated.status !== 'updated') {
		return;
	}
	assert.equal(updated.set.id, created.set.id);
	assert.equal(updated.set.name, 'Active Set');
	assert.equal(updated.set.createdAt, 100);
	assert.equal(updated.set.updatedAt, 200);
	assert.deepEqual(updated.set.entries.map((entry) => entry.filePath), [
		'items/one.md',
		'items/two.md',
	]);
	assert.equal(sets.update('missing', queue.getEntries()).status, 'not-found');
	assert.equal(sets.update(created.set.id, []).status, 'empty-queue');
});

void test('loading replaces once with fresh IDs, preserved order/quantity, and independent overrides', () => {
	const sourceQueue = createQueue('source');
	const weapon = sourceQueue.add('items/weapon.md', {
		title: '+1 Longsword',
		stats: { properties: ['versatile'] },
	});
	sourceQueue.increment(weapon.id);
	sourceQueue.add('items/wand.md', {
		artwork: { kind: 'vault', path: 'Card Forge Assets/wand.webp' },
	});
	const sets = createSets();
	const saved = sets.save('Session', sourceQueue.getEntries());
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	const queue = createQueue('loaded');
	let notifications = 0;
	queue.subscribe(() => {
		notifications += 1;
	});
	const available = new Set(['items/weapon.md', 'items/wand.md']);
	const firstLoad = sets.loadIntoQueue(saved.set.id, queue, available);
	assert.equal(firstLoad.status, 'loaded');
	if (firstLoad.status !== 'loaded') {
		return;
	}
	assert.equal(notifications, 1);
	assert.deepEqual(firstLoad.entries.map((entry) => entry.filePath), [
		'items/weapon.md',
		'items/wand.md',
	]);
	assert.deepEqual(firstLoad.entries.map((entry) => entry.quantity), [2, 1]);
	assert.equal(firstLoad.totalCopies, 3);
	assert.deepEqual(firstLoad.entries[1]?.overrides?.artwork, {
		kind: 'vault',
		path: 'Card Forge Assets/wand.webp',
	});
	const firstIds = firstLoad.entries.map((entry) => entry.id);
	const beforeDeclinedReplacement = structuredClone(queue.getEntries());
	assert.equal(sets.loadIntoQueue(saved.set.id, queue, available).status, 'requires-confirmation');
	assert.deepEqual(queue.getEntries(), beforeDeclinedReplacement);
	const secondLoad = sets.loadIntoQueue(saved.set.id, queue, available, true);
	assert.equal(secondLoad.status, 'loaded');
	if (secondLoad.status !== 'loaded') {
		return;
	}
	assert.equal(notifications, 2);
	assert.notDeepEqual(secondLoad.entries.map((entry) => entry.id), firstIds);
	queue.updateOverrides(secondLoad.entries[0]!.id, {
		title: '+1 Warhammer',
		stats: { properties: ['heavy'] },
	});
	assert.equal(saved.set.entries[0]?.overrides?.title, '+1 Longsword');
	assert.deepEqual(saved.set.entries[0]?.overrides?.stats?.properties, ['versatile']);
});

void test('partial loads report missing sources while zero-resolvable loads preserve the current queue', () => {
	const sourceQueue = createQueue('source');
	sourceQueue.add('items/available.md');
	sourceQueue.add('items/missing.md', {
		artwork: { kind: 'temporary', id: 'missing-art', origin: 'local' },
	});
	const sets = createSets();
	const saved = sets.save('Partial', sourceQueue.getEntries());
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	const queue = createQueue('loaded');
	const partial = sets.loadIntoQueue(saved.set.id, queue, new Set(['items/available.md']));
	assert.equal(partial.status, 'loaded');
	if (partial.status !== 'loaded') {
		return;
	}
	assert.equal(partial.missingCount, 1);
	assert.equal(partial.containsTemporaryArtwork, false);
	assert.deepEqual(queue.getEntries().map((entry) => entry.filePath), ['items/available.md']);
	assert.equal(queue.getEntries()[0]?.overrides, undefined);
	const beforeFailedLoad = structuredClone(queue.getEntries());
	const failed = sets.loadIntoQueue(saved.set.id, queue, new Set(), true);
	assert.equal(failed.status, 'no-resolvable-entries');
	assert.deepEqual(queue.getEntries(), beforeFailedLoad);
});

void test('temporary artwork remains a lightweight missing reference after restart and load', () => {
	const sourceQueue = createQueue('source');
	sourceQueue.add('items/temporary.md', {
		artwork: {
			kind: 'temporary',
			id: 'session-only-art',
			name: 'choice.webp',
			origin: 'local',
		},
	});
	const originalSets = createSets();
	const saved = originalSets.save('Temporary art', sourceQueue.getEntries());
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	assert.equal(saved.containsTemporaryArtwork, true);

	const restartedSets = new SavedPrintSetService(
		JSON.parse(JSON.stringify(originalSets.serialize())) as unknown,
		() => 'unused',
		() => 999,
	);
	const restartedQueue = createQueue('loaded');
	const loaded = restartedSets.loadIntoQueue(
		saved.set.id,
		restartedQueue,
		new Set(['items/temporary.md']),
	);
	assert.equal(loaded.status, 'loaded');
	if (loaded.status !== 'loaded') {
		return;
	}
	assert.equal(loaded.containsTemporaryArtwork, true);
	assert.equal(loaded.entries[0]?.overrides?.artwork?.kind, 'temporary');
	assert.equal(new TemporaryArtworkStore().get('session-only-art'), undefined);
});
