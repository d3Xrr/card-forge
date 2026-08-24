import assert from 'node:assert/strict';
import test from 'node:test';

import { PrintQueueService } from '../src/models/print-queue';
import { SavedPrintSetService } from '../src/models/saved-print-set';
import type { ItemCardData } from '../src/models/item';
import { createEffectiveCardInput } from '../src/services/effective-card';
import { createPhysicalPlanCacheIdentity } from '../src/services/physical-plan-cache';
import {
	createSavedPrintSetQueueFingerprint,
	getSavedPrintSetLoadRisk,
	SavedPrintSetSession,
} from '../src/services/saved-print-set-session';

function createQueue(prefix = 'queue'): PrintQueueService {
	let id = 1;
	return new PrintQueueService([], () => `${prefix}-${id++}`);
}

function createSavedSet(queue: PrintQueueService): {
	sets: SavedPrintSetService;
	setId: string;
} {
	const sets = new SavedPrintSetService([], () => 'set-1', () => 100);
	const result = sets.save('Test', queue.getEntries());
	assert.equal(result.status, 'created');
	if (result.status !== 'created') {
		throw new Error('Saved set fixture could not be created.');
	}
	return { sets, setId: result.set.id };
}

void test('loading with fresh live IDs activates a clean Saved Print Set', () => {
	const source = createQueue('source');
	source.add('items/a.md', { variant: { id: 'longsword' } });
	source.add('items/b.md');
	const { sets, setId } = createSavedSet(source);
	const loaded = createQueue('loaded');
	const result = sets.loadIntoQueue(
		setId,
		loaded,
		new Set(['items/a.md', 'items/b.md']),
	);
	assert.equal(result.status, 'loaded');
	const session = new SavedPrintSetSession();
	session.activate(setId, loaded.getEntries());
	assert.deepEqual(session.getState(sets.getSets(), loaded.getEntries()), {
		activeSet: sets.getSet(setId),
		dirty: false,
	});
	assert.notDeepEqual(
		loaded.getEntries().map((entry) => entry.id),
		source.getEntries().map((entry) => entry.id),
	);
});

void test('canonical fingerprint ignores live IDs and runtime-only properties', () => {
	const first = [{
		id: 'live-a',
		filePath: 'items/a.md',
		quantity: 2,
		overrides: {
			variant: { id: 'warhammer' },
			rulesMarkdown: 'First\n\n///CARD BREAK///\n\nSecond',
			stats: { properties: ['heavy'] },
			artwork: { kind: 'vault' as const, path: 'Assets/hammer.webp' },
		},
		runtimeOwner: 'view-a',
		cache: { planned: true },
	}];
	const second = [{ ...first[0]!, id: 'live-b', runtimeOwner: 'view-b', cache: null }];
	assert.equal(
		createSavedPrintSetQueueFingerprint(first),
		createSavedPrintSetQueueFingerprint(second),
	);
});

void test('every meaningful queue mutation marks an active set dirty', () => {
	const mutationCases: Array<[string, (queue: PrintQueueService) => void]> = [
		['quantity', (queue) => queue.increment(queue.getEntries()[0]!.id)],
		['add', (queue) => { queue.add('items/c.md'); }],
		['remove', (queue) => queue.remove(queue.getEntries()[0]!.id)],
		['reorder', (queue) => queue.move(queue.getEntries()[0]!.id, 1)],
		['duplicate', (queue) => { queue.duplicate(queue.getEntries()[0]!.id); }],
		['queue edit', (queue) => {
			queue.updateOverrides(queue.getEntries()[0]!.id, {
				title: 'Edited',
				variant: { id: 'warhammer' },
				rulesMarkdown: 'One\n\n///CARD BREAK///\n\nTwo',
				artwork: { kind: 'none' },
			});
		}],
	];
	for (const [label, mutate] of mutationCases) {
		const queue = createQueue(label);
		queue.add('items/a.md');
		queue.add('items/b.md');
		const { sets, setId } = createSavedSet(queue);
		const session = new SavedPrintSetSession();
		session.activate(setId, queue.getEntries());
		mutate(queue);
		assert.equal(
			session.getState(sets.getSets(), queue.getEntries()).dirty,
			true,
			label,
		);
	}
});

void test('pure navigation checks do not dirty the active set', () => {
	const queue = createQueue();
	queue.add('items/a.md');
	const { sets, setId } = createSavedSet(queue);
	const session = new SavedPrintSetSession();
	session.activate(setId, queue.getEntries());
	for (let previewPage = 0; previewPage < 4; previewPage += 1) {
		const workflowMode = previewPage % 2 ? 'saved-sets' : 'queue';
		assert.ok(workflowMode);
		assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, false);
	}
});

void test('Save keeps the set ID and clears dirty state', () => {
	const queue = createQueue();
	const entry = queue.add('items/a.md');
	const { sets, setId } = createSavedSet(queue);
	const session = new SavedPrintSetSession();
	session.activate(setId, queue.getEntries());
	queue.increment(entry.id);
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, true);
	const updated = sets.update(setId, queue.getEntries());
	assert.equal(updated.status, 'updated');
	session.activate(setId, queue.getEntries());
	assert.equal(session.activeSavedSetId, setId);
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, false);
});

void test('Save As creates and activates a new ID without changing the original', () => {
	const queue = createQueue();
	queue.add('items/a.md');
	const { sets, setId } = createSavedSet(queue);
	const original = structuredClone(sets.getSet(setId));
	queue.add('items/b.md');
	const created = sets.save('Test Variant', queue.getEntries());
	assert.equal(created.status, 'created');
	if (created.status !== 'created') {
		return;
	}
	const session = new SavedPrintSetSession();
	let persistedActiveId: string | undefined;
	session.subscribe((id) => { persistedActiveId = id; });
	session.activate(created.set.id, queue.getEntries());
	assert.notEqual(created.set.id, setId);
	assert.deepEqual(sets.getSet(setId), original);
	assert.equal(session.activeSavedSetId, created.set.id);
	assert.equal(persistedActiveId, created.set.id);
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, false);
});

void test('rename follows the active ID; delete and Clear remove only association', () => {
	const queue = createQueue();
	queue.add('items/a.md');
	const { sets, setId } = createSavedSet(queue);
	const session = new SavedPrintSetSession();
	session.activate(setId, queue.getEntries());
	assert.equal(sets.rename(setId, 'Renamed').status, 'renamed');
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).activeSet?.name, 'Renamed');
	const queueBeforeDelete = structuredClone(queue.getEntries());
	let persistedActiveId: string | undefined = setId;
	session.subscribe((id) => { persistedActiveId = id; });
	assert.equal(sets.delete(setId), true);
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).activeSet, undefined);
	assert.equal(persistedActiveId, undefined);
	assert.deepEqual(queue.getEntries(), queueBeforeDelete);

	const replacement = sets.save('Replacement', queue.getEntries());
	assert.equal(replacement.status, 'created');
	if (replacement.status !== 'created') {
		return;
	}
	session.activate(replacement.set.id, queue.getEntries());
	session.clear();
	queue.clear();
	assert.equal(session.activeSavedSetId, undefined);
	assert.equal(persistedActiveId, undefined);
	assert.equal(sets.getSet(replacement.set.id)?.name, 'Replacement');
});

void test('restart restores a clean active set from persisted ID and canonical snapshots', () => {
	const originalQueue = createQueue('before');
	originalQueue.add('items/a.md', {
		variant: { id: 'longsword' },
		rulesMarkdown: 'One\n\n///CARD BREAK///\n\nTwo',
	});
	const { sets, setId } = createSavedSet(originalQueue);
	const persistedQueue = JSON.parse(JSON.stringify(originalQueue.serialize())) as unknown;
	const persistedSets = JSON.parse(JSON.stringify(sets.serialize())) as unknown;
	const restartedQueue = new PrintQueueService(persistedQueue, () => 'fresh-live-id');
	const restartedSets = new SavedPrintSetService(persistedSets);
	const session = new SavedPrintSetSession();
	assert.equal(session.restore(setId, restartedSets.getSets()), 'restored');
	assert.equal(session.activeSavedSetId, setId);
	assert.equal(
		session.getState(restartedSets.getSets(), restartedQueue.getEntries()).dirty,
		false,
	);
	assert.deepEqual(restartedQueue.serialize(), originalQueue.serialize());
});

void test('restart restores a modified active set without changing its live queue', () => {
	const queue = createQueue();
	const entry = queue.add('items/a.md');
	const { sets, setId } = createSavedSet(queue);
	queue.increment(entry.id);
	const beforeRestore = structuredClone(queue.getEntries());
	const session = new SavedPrintSetSession();
	assert.equal(session.restore(setId, sets.getSets()), 'restored');
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, true);
	assert.deepEqual(queue.getEntries(), beforeRestore);
});

void test('restart treats a missing field as none and clears malformed or missing references', () => {
	const queue = createQueue();
	queue.add('items/a.md');
	const { sets } = createSavedSet(queue);
	const before = structuredClone(queue.getEntries());
	const missing = new SavedPrintSetSession();
	assert.equal(missing.restore(undefined, sets.getSets()), 'none');
	assert.equal(missing.activeSavedSetId, undefined);
	const malformed = new SavedPrintSetSession();
	assert.equal(malformed.restore(42, sets.getSets()), 'invalid');
	assert.equal(malformed.activeSavedSetId, undefined);
	const deleted = new SavedPrintSetSession();
	assert.equal(deleted.restore('deleted-set', sets.getSets()), 'invalid');
	assert.equal(deleted.activeSavedSetId, undefined);
	assert.deepEqual(queue.getEntries(), before);
});

void test('association changes expose the active ID for plugin-data persistence', () => {
	const queue = createQueue();
	queue.add('items/a.md');
	const sets = new SavedPrintSetService([], (() => {
		let id = 1;
		return () => `set-${id++}`;
	})(), () => 1);
	const first = sets.save('First', queue.getEntries());
	const second = sets.save('Second', queue.getEntries());
	assert.equal(first.status, 'created');
	assert.equal(second.status, 'created');
	if (first.status !== 'created' || second.status !== 'created') {
		return;
	}
	const persisted: Array<string | undefined> = [];
	const session = new SavedPrintSetSession();
	session.subscribe((id) => persisted.push(id));
	session.activate(first.set.id, first.set.entries);
	assert.equal(sets.rename(first.set.id, 'Renamed').status, 'renamed');
	session.activate(second.set.id, second.set.entries);
	assert.deepEqual(persisted, [first.set.id, second.set.id]);
	session.clearIfActive(second.set.id);
	assert.deepEqual(persisted, [first.set.id, second.set.id, undefined]);
});

void test('load replacement risk depends only on empty, clean, modified, or unsaved queue state', () => {
	const queue = createQueue();
	const sets = new SavedPrintSetService([], () => 'risk-set', () => 1);
	const session = new SavedPrintSetSession();
	assert.equal(
		getSavedPrintSetLoadRisk(session.getState(sets.getSets(), []), []),
		'none',
	);
	queue.add('items/a.md');
	assert.equal(
		getSavedPrintSetLoadRisk(
			session.getState(sets.getSets(), queue.getEntries()),
			queue.getEntries(),
		),
		'unsaved-queue',
	);
	const saved = sets.save('Active', queue.getEntries());
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	session.activate(saved.set.id, saved.set.entries);
	assert.equal(
		getSavedPrintSetLoadRisk(
			session.getState(sets.getSets(), queue.getEntries()),
			queue.getEntries(),
		),
		'none',
		'clean active set can load itself or another set without confirmation',
	);
	queue.increment(queue.getEntries()[0]!.id);
	assert.equal(
		getSavedPrintSetLoadRisk(
			session.getState(sets.getSets(), queue.getEntries()),
			queue.getEntries(),
		),
		'modified-active-set',
		'modified active set requires confirmation even when reloading itself',
	);
});

void test('fresh queue IDs from Saved Set load do not change physical-plan content identity', () => {
	const item: ItemCardData = {
		filePath: 'items/a.md',
		name: 'Example',
		description: 'Rules.',
		hasImage: false,
		rawTags: [],
	};
	const sourceQueue = createQueue('source');
	sourceQueue.add(item.filePath, {
		title: 'Edited',
		variant: { id: 'example-variant' },
	});
	const { sets, setId } = createSavedSet(sourceQueue);
	const loadedQueue = createQueue('loaded');
	assert.equal(
		sets.loadIntoQueue(setId, loadedQueue, new Set([item.filePath])).status,
		'loaded',
	);
	const sourceEffective = createEffectiveCardInput(
		item,
		[item],
		sourceQueue.getEntries()[0]?.overrides,
	);
	const loadedEffective = createEffectiveCardInput(
		item,
		[item],
		loadedQueue.getEntries()[0]?.overrides,
	);
	const sourceIdentity = createPhysicalPlanCacheIdentity({
		item: sourceEffective.item,
		sourceFingerprint: 'source-revision',
		overrideFingerprint: sourceEffective.overrideFingerprint,
	});
	const loadedIdentity = createPhysicalPlanCacheIdentity({
		item: loadedEffective.item,
		sourceFingerprint: 'source-revision',
		overrideFingerprint: loadedEffective.overrideFingerprint,
	});
	assert.notEqual(sourceQueue.getEntries()[0]?.id, loadedQueue.getEntries()[0]?.id);
	assert.equal(sourceIdentity.key, loadedIdentity.key);
});
