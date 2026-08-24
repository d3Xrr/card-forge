import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectTemporaryArtworkIds,
	TemporaryArtworkStore,
} from '../src/services/temporary-artwork-store';
import {
	deserializePrintQueue,
	getUniqueQueueEntryById,
	PrintQueueService,
	serializePrintQueue,
} from '../src/models/print-queue';
import { applyCardOverrides } from '../src/services/card-overrides';
import { createEffectiveCardInput } from '../src/services/effective-card';
import { createQueueProvenanceLabel } from '../src/services/live-edit-ui';
import type { ItemCardData } from '../src/models/item';
import type { CardOverrides } from '../src/models/card-overrides';

function createQueue(): PrintQueueService {
	let nextId = 1;
	return new PrintQueueService([], () => `entry-${nextId++}`);
}

void test('adds a new item and increments an existing item instead of duplicating it', () => {
	const queue = createQueue();
	queue.add('items/scimitar.md');
	queue.add('items/scimitar.md');
	assert.deepEqual(queue.getEntries(), [{
		id: 'entry-1',
		filePath: 'items/scimitar.md',
		quantity: 2,
	}]);
});

void test('batch add preserves index order, creates stable IDs, and emits once', () => {
	const queue = createQueue();
	const existing = queue.add('items/existing.md');
	let notifications = 0;
	queue.subscribe(() => {
		notifications += 1;
	});
	const result = queue.addMany([
		{ filePath: 'items/armor.md' },
		{ filePath: 'items/wand.md' },
		{ filePath: 'items/sword.md' },
	]);

	assert.equal(result.rejected, 0);
	assert.equal(notifications, 1);
	assert.deepEqual(queue.getEntries().map((entry) => entry.filePath), [
		'items/existing.md',
		'items/armor.md',
		'items/wand.md',
		'items/sword.md',
	]);
	assert.deepEqual(result.entries.map((entry) => entry.quantity), [1, 1, 1]);
	assert.equal(new Set(queue.getEntries().map((entry) => entry.id)).size, 4);
	assert.equal(queue.getEntry(existing.id)?.filePath, 'items/existing.md');
});

void test('batch add keeps same-source override snapshots independent', () => {
	const queue = createQueue();
	const result = queue.addMany([
		{ filePath: 'items/generic.md', overrides: { variant: { id: 'dagger' } } },
		{ filePath: 'items/generic.md', overrides: { variant: { id: 'warhammer' } } },
	]);
	const [dagger, warhammer] = result.entries;
	assert.notEqual(dagger?.id, warhammer?.id);
	assert.deepEqual(dagger?.overrides, { variant: { id: 'dagger' } });
	assert.deepEqual(warhammer?.overrides, { variant: { id: 'warhammer' } });
	queue.updateOverrides(dagger.id, { title: 'Edited dagger' });
	assert.deepEqual(queue.getEntry(warhammer.id)?.overrides, { variant: { id: 'warhammer' } });
});

void test('batch defaults never inherit the active editor draft after queue reload', () => {
	const activeSwordDraft: CardOverrides = {
		title: 'Sword of Khaine',
		stats: { cost: '15000 gp' },
		sourceText: 'Homebrew',
		artwork: { kind: 'temporary', id: 'sword-art', origin: 'local' },
	};
	const queue = new PrintQueueService([
		{
			id: 'edited-sword',
			filePath: 'items/sword.md',
			quantity: 1,
			overrides: activeSwordDraft,
		},
	], (() => {
		let id = 1;
		return () => `batch-${id++}`;
	})());
	queue.addMany([
		{ filePath: 'items/armor.md' },
		{ filePath: 'items/wand.md' },
	]);
	const restored = new PrintQueueService(JSON.parse(JSON.stringify(queue.serialize())) as unknown);
	assert.equal(restored.getEntry('batch-1')?.overrides, undefined);
	assert.equal(restored.getEntry('batch-2')?.overrides, undefined);
	assert.deepEqual(restored.getEntry('edited-sword')?.overrides, activeSwordDraft);
});

void test('batch add reports invalid paths without losing valid additions', () => {
	const queue = createQueue();
	const result = queue.addMany([
		{ filePath: 'items/valid.md' },
		{ filePath: '   ' },
	]);
	assert.equal(result.entries.length, 1);
	assert.equal(result.rejected, 1);
	assert.equal(queue.getEntries()[0]?.filePath, 'items/valid.md');
});

void test('increments and decrements quantity without dropping below one', () => {
	const queue = createQueue();
	const entry = queue.add('items/scimitar.md');
	queue.increment(entry.id);
	queue.decrement(entry.id);
	queue.decrement(entry.id);
	assert.equal(queue.getEntries()[0]?.quantity, 1);
});

void test('duplicates a complete logical entry immediately after its source with independent state', () => {
	const queue = createQueue();
	const source = queue.add('items/weapon.md', {
		title: '+1 Longsword',
		variant: { id: 'longsword' },
		rulesMarkdown: `First card\n\n///CARD BREAK///\n\nSecond card`,
		stats: { properties: ['versatile'], damage: '1d8 + 1' },
		artwork: { kind: 'temporary', id: 'shared-art', origin: 'local' },
	});
	queue.increment(source.id);
	queue.increment(source.id);
	const tail = queue.add('items/tail.md');
	let notifications = 0;
	queue.subscribe(() => {
		notifications += 1;
	});

	const duplicate = queue.duplicate(source.id);
	assert.ok(duplicate);
	assert.equal(notifications, 1);
	assert.notEqual(duplicate.id, source.id);
	assert.equal(duplicate.quantity, 3);
	assert.equal(duplicate.filePath, source.filePath);
	assert.equal(duplicate.separate, true);
	assert.deepEqual(duplicate.overrides, source.overrides);
	assert.notStrictEqual(duplicate.overrides, source.overrides);
	assert.notStrictEqual(duplicate.overrides?.stats, source.overrides?.stats);
	assert.notStrictEqual(
		duplicate.overrides?.stats?.properties,
		source.overrides?.stats?.properties,
	);
	assert.deepEqual(queue.getEntries().map((entry) => entry.id), [source.id, duplicate.id, tail.id]);
	const baseItem: ItemCardData = {
		filePath: source.filePath,
		name: '+1 Weapon',
		description: 'Source rules',
		hasImage: false,
		rawTags: [],
	};
	assert.deepEqual(
		applyCardOverrides(baseItem, duplicate.overrides).item,
		applyCardOverrides(baseItem, source.overrides).item,
	);
	assert.equal(
		createQueueProvenanceLabel(
			baseItem,
			applyCardOverrides(baseItem, duplicate.overrides).item,
			duplicate.overrides,
		),
		'from +1 Weapon',
	);

	queue.updateOverrides(source.id, {
		...source.overrides,
		title: '+1 Warhammer',
		stats: { ...source.overrides?.stats, properties: ['versatile', 'heavy'] },
	});
	assert.equal(duplicate.overrides?.title, '+1 Longsword');
	assert.deepEqual(duplicate.overrides?.stats?.properties, ['versatile']);

	const restored = new PrintQueueService(queue.serialize(), () => 'unused');
	assert.equal(restored.getEntries().length, 3);
	assert.equal(restored.getEntry(duplicate.id)?.quantity, 3);
	assert.equal(restored.getEntry(duplicate.id)?.overrides?.title, '+1 Longsword');
	assert.match(
		restored.getEntry(duplicate.id)?.overrides?.rulesMarkdown ?? '',
		/\/\/\/CARD BREAK\/\/\//u,
	);
});

void test('duplicate temporary artwork stays alive until both logical entries release it', () => {
	const revoked: string[] = [];
	const store = new TemporaryArtworkStore({
		create: () => 'blob:shared-art',
		revoke: (path) => revoked.push(path),
	}, () => 'shared-art');
	store.create({ fileName: 'shared.png', data: new Uint8Array([1]).buffer });
	const queue = createQueue();
	const source = queue.add('items/source.md', {
		artwork: { kind: 'temporary', id: 'shared-art', origin: 'local' },
	});
	const duplicate = queue.duplicate(source.id);
	assert.ok(duplicate);
	store.setOwnerReferences(
		'queue',
		collectTemporaryArtworkIds(queue.getEntries().map((entry) => entry.overrides)),
	);
	queue.remove(source.id);
	store.setOwnerReferences(
		'queue',
		collectTemporaryArtworkIds(queue.getEntries().map((entry) => entry.overrides)),
	);
	assert.ok(store.get('shared-art'));
	assert.deepEqual(revoked, []);
	queue.remove(duplicate.id);
	store.setOwnerReferences('queue', []);
	assert.equal(store.get('shared-art'), undefined);
	assert.deepEqual(revoked, ['blob:shared-art']);
});

void test('duplicating a default entry never inherits unrelated editor overrides', () => {
	const queue = createQueue();
	const source = queue.add('items/default.md');
	const unrelatedEditorDraft = { title: 'Do not leak', stats: { damage: '99d99' } };
	const duplicate = queue.duplicate(source.id);
	assert.ok(duplicate);
	assert.equal(source.overrides, undefined);
	assert.equal(duplicate.overrides, undefined);
	assert.deepEqual(unrelatedEditorDraft, {
		title: 'Do not leak',
		stats: { damage: '99d99' },
	});
});

void test('removes, clears, and reorders queue entries', () => {
	const queue = createQueue();
	const scimitar = queue.add('items/scimitar.md');
	const jug = queue.add('items/jug.md');
	const rod = queue.add('items/rod.md');
	queue.move(rod.id, -1);
	assert.deepEqual(queue.getEntries().map((entry) => entry.filePath), [
		'items/scimitar.md',
		'items/rod.md',
		'items/jug.md',
	]);
	queue.remove(scimitar.id);
	assert.equal(queue.getEntries().length, 2);
	queue.clear();
	assert.equal(queue.getEntries().length, 0);
	assert.equal(jug.quantity, 1);
});

void test('serializes defensively and deserializes only valid entries', () => {
	const original = [{ id: 'one', filePath: 'items/one.md', quantity: 2 }];
	const serialized = serializePrintQueue(original);
	serialized[0]!.quantity = 4;
	assert.equal(original[0]?.quantity, 2);
	let nextId = 1;
	assert.deepEqual(deserializePrintQueue([
		...original,
		{ id: 'two', filePath: 'items/one.md', quantity: 3 },
		{ id: '', filePath: 'items/missing-id.md', quantity: 1 },
		{ id: 'bad', filePath: 'items/bad.md', quantity: 0 },
	], () => `migrated-${nextId++}`), [
		{ id: 'one', filePath: 'items/one.md', quantity: 5 },
		{ id: 'migrated-1', filePath: 'items/missing-id.md', quantity: 1 },
	]);
});

void test('persists overrides and keeps distinct edited versions of one source item', () => {
	const queue = createQueue();
	const source = queue.add('items/sword.md');
	const edited = queue.add('items/sword.md', { title: 'Named Sword' });
	queue.add('items/sword.md', { title: ' Named Sword ' });
	assert.equal(source.quantity, 1);
	assert.equal(edited.quantity, 2);
	assert.equal(queue.getEntries().length, 2);

	queue.updateOverrides(source.id, { artwork: { kind: 'none' } });
	const restored = deserializePrintQueue(serializePrintQueue(queue.getEntries()));
	assert.deepEqual(restored, queue.getEntries());
});

void test('resetting queue-entry overrides restores source behavior', () => {
	const queue = createQueue();
	const entry = queue.add('items/sword.md', { title: 'Edited' });
	queue.updateOverrides(entry.id, undefined);
	assert.equal(queue.getEntries()[0]?.overrides, undefined);
});

void test('reload reconstructs the same effective data without duplicating the source item', () => {
	const source: ItemCardData = {
		filePath: 'items/source.md',
		name: 'Source',
		description: 'Rules',
		hasImage: false,
		rawTags: [],
	};
	const queue = createQueue();
	queue.add(source.filePath, { title: 'Edited', stats: { damage: '2d6' } });
	const restored = deserializePrintQueue(queue.serialize());
	assert.equal(
		Object.prototype.hasOwnProperty.call(restored[0] ?? {}, 'description'),
		false,
	);
	assert.deepEqual(
		applyCardOverrides(source, restored[0]?.overrides).item,
		applyCardOverrides(source, queue.getEntries()[0]?.overrides).item,
	);
});

void test('temporary artwork persists only a lightweight session reference', () => {
	const queue = createQueue();
	queue.add('items/source.md', {
		artwork: {
			kind: 'temporary',
			id: 'session-art-1',
			name: 'choice.png',
			origin: 'local',
		},
	});
	const serialized = JSON.stringify(queue.serialize());
	assert.match(serialized, /session-art-1/u);
	assert.doesNotMatch(serialized, /blob:|base64|data:image/iu);
});

void test('promotes matching temporary artwork to Vault paths in one queue mutation', () => {
	const queue = createQueue();
	const first = queue.add('items/first.md', {
		title: 'First',
		artwork: { kind: 'temporary', id: 'shared-art', origin: 'local' },
	});
	const second = queue.add('items/second.md', {
		artwork: { kind: 'temporary', id: 'other-art', origin: 'https' },
	});
	let notifications = 0;
	queue.subscribe(() => { notifications += 1; });
	assert.equal(queue.promoteTemporaryArtworkReferences(new Map([
		['shared-art', 'Card Forge Assets/shared.png'],
	])), 1);
	assert.equal(notifications, 1);
	assert.equal(queue.getEntry(first.id)?.overrides?.title, 'First');
	assert.deepEqual(queue.getEntry(first.id)?.overrides?.artwork, {
		kind: 'vault',
		path: 'Card Forge Assets/shared.png',
	});
	assert.deepEqual(queue.getEntry(second.id)?.overrides?.artwork, {
		kind: 'temporary',
		id: 'other-art',
		origin: 'https',
	});
	assert.equal(queue.promoteTemporaryArtworkReferences(new Map()), 0);
	assert.equal(notifications, 1);
});

void test('queue reset remains a working draft until Save and other entries stay isolated', () => {
	const queue = createQueue();
	const first = queue.add('items/source.md', { title: 'First edit' });
	const second = queue.add('items/source.md', { title: 'Second edit' });
	const storedBeforeReset = structuredClone(first.overrides);
	const resetWorkingDraft = undefined;
	assert.deepEqual(queue.getEntries()[0]?.overrides, storedBeforeReset);
	queue.updateOverrides(first.id, resetWorkingDraft);
	assert.equal(queue.getEntries().find((entry) => entry.id === first.id)?.overrides, undefined);
	assert.deepEqual(
		queue.getEntries().find((entry) => entry.id === second.id)?.overrides,
		{ title: 'Second edit' },
	);
});

void test('same source keeps every semantically distinct printable override independent', () => {
	const queue = createQueue();
	const filePath = 'items/synthetic-source.md';
	const rulesA = queue.add(filePath, { rulesMarkdown: 'VERSION A' });
	queue.add(filePath, { rulesMarkdown: ' VERSION A ' });
	queue.add(filePath, { rulesMarkdown: 'VERSION B' });
	queue.add(filePath, { artwork: { kind: 'vault', path: 'art/a.webp' } });
	queue.add(filePath, { artwork: { kind: 'vault', path: 'art/b.webp' } });
	queue.add(filePath, { variant: { id: 'dagger' } });
	queue.add(filePath, { variant: { id: 'warhammer' } });
	queue.add(filePath, { sourceText: 'Literal source A' });
	queue.add(filePath, { sourceText: 'Literal source B' });

	assert.equal(rulesA.quantity, 2);
	assert.equal(queue.getEntries().length, 8);
	assert.equal(new Set(queue.getEntries().map((entry) => entry.id)).size, 8);
});

void test('draft mutation, saving, resetting, and removing entry A never changes B', () => {
	const queue = createQueue();
	const originalDraft: CardOverrides = {
		rulesMarkdown: 'VERSION A',
		stats: { properties: ['versatile'] },
		artwork: { kind: 'vault', path: 'art/a.webp' },
	};
	const first = queue.add('items/synthetic-source.md', originalDraft);
	const second = queue.add('items/synthetic-source.md', {
		rulesMarkdown: 'VERSION B',
		stats: { properties: ['heavy'] },
		artwork: { kind: 'vault', path: 'art/b.webp' },
	});
	const secondSnapshot = structuredClone(second.overrides);

	originalDraft.rulesMarkdown = 'MUTATED OUTSIDE QUEUE';
	originalDraft.stats?.properties?.push('outside');
	if (originalDraft.artwork?.kind === 'vault') {
		originalDraft.artwork.path = 'art/outside.webp';
	}
	assert.equal(queue.getEntries().find((entry) => entry.id === first.id)?.overrides?.rulesMarkdown, 'VERSION A');

	const workingDraft = structuredClone(first.overrides);
	if (workingDraft) {
		workingDraft.rulesMarkdown = 'VERSION C';
	}
	assert.equal(queue.getEntries().find((entry) => entry.id === first.id)?.overrides?.rulesMarkdown, 'VERSION A');
	queue.updateOverrides(first.id, workingDraft);
	assert.equal(queue.getEntries().find((entry) => entry.id === first.id)?.overrides?.rulesMarkdown, 'VERSION C');
	assert.deepEqual(queue.getEntries().find((entry) => entry.id === second.id)?.overrides, secondSnapshot);

	queue.updateOverrides(first.id, undefined);
	assert.equal(queue.getEntries().find((entry) => entry.id === first.id)?.overrides, undefined);
	assert.deepEqual(queue.getEntries().find((entry) => entry.id === second.id)?.overrides, secondSnapshot);
	queue.remove(first.id);
	assert.deepEqual(queue.getEntries(), [{
		id: second.id,
		filePath: second.filePath,
		quantity: 1,
		overrides: secondSnapshot,
	}]);
});

void test('persistence retains same-source entry ids and distinct override snapshots', () => {
	const queue = createQueue();
	const first = queue.add('items/synthetic-source.md', {
		rulesMarkdown: 'VERSION A',
		variant: { id: 'quarterstaff' },
		artwork: { kind: 'temporary', id: 'session-a', origin: 'https' },
	});
	const second = queue.add('items/synthetic-source.md', {
		rulesMarkdown: 'VERSION B',
		variant: { id: 'quarterstaff' },
		artwork: { kind: 'vault', path: 'art/b.webp' },
		sourceText: 'Literal source B',
	});
	const restoredQueue = new PrintQueueService(
		JSON.parse(JSON.stringify(queue.serialize())) as unknown,
		() => 'unused-migration-id',
	);
	const restored = restoredQueue.getEntries();

	assert.deepEqual(restored.map((entry) => entry.id), [first.id, second.id]);
	assert.deepEqual(restored, queue.getEntries());
	assert.notStrictEqual(restored[0]?.overrides, restored[1]?.overrides);
	restoredQueue.updateOverrides(first.id, {
		...restored[0]?.overrides,
		rulesMarkdown: 'VERSION C',
	});
	assert.equal(restoredQueue.getEntry(first.id)?.overrides?.rulesMarkdown, 'VERSION C');
	assert.equal(restoredQueue.getEntry(second.id)?.overrides?.rulesMarkdown, 'VERSION B');
});

void test('missing legacy queue ids are migrated, serialized, and remain stable', () => {
	let nextId = 1;
	const queue = new PrintQueueService([
		{
			filePath: 'sword-source.md',
			overrides: { title: 'Sword of Khaine', stats: { cost: '15000 gp' } },
		},
		{ filePath: 'armor-source.md' },
		{ filePath: 'wand-source.md', quantity: 2 },
	], () => `migrated-${nextId++}`);

	assert.equal(queue.hydrationRepaired, true);
	assert.deepEqual(queue.getEntries().map((entry) => entry.id), [
		'migrated-1',
		'migrated-2',
		'migrated-3',
	]);
	assert.deepEqual(queue.getEntries().map((entry) => entry.quantity), [1, 1, 2]);
	assert.equal(new Set(queue.getEntries().map((entry) => entry.id)).size, 3);

	const serialized = queue.serialize();
	const restored = new PrintQueueService(serialized, () => 'must-not-be-used');
	assert.equal(restored.hydrationRepaired, false);
	assert.deepEqual(restored.getEntries().map((entry) => entry.id), [
		'migrated-1',
		'migrated-2',
		'migrated-3',
	]);
	assert.equal(restored.updateOverrides('migrated-1', { title: 'Edited Sword' }), true);
	assert.equal(restored.getEntry('migrated-2')?.overrides, undefined);
	assert.equal(restored.getEntry('migrated-3')?.overrides, undefined);
});

void test('duplicate persisted queue ids are repaired without mixing snapshots', () => {
	const queue = new PrintQueueService([
		{
			id: 'same',
			filePath: 'sword-source.md',
			quantity: 1,
			overrides: { title: 'Sword of Khaine', stats: { cost: '15000 gp' } },
		},
		{
			id: 'same',
			filePath: 'armor-source.md',
			quantity: 1,
			overrides: { sourceText: 'Armor source' },
		},
		{
			id: 'same',
			filePath: 'wand-source.md',
			quantity: 1,
			overrides: { rulesMarkdown: 'Wand custom rules' },
		},
	], () => 'repair');
	const [sword, armor, wand] = queue.getEntries();

	assert.equal(queue.hydrationRepaired, true);
	assert.deepEqual(queue.getEntries().map((entry) => entry.id), ['same', 'repair', 'repair-2']);
	assert.notStrictEqual(sword, armor);
	assert.notStrictEqual(sword, wand);
	assert.notStrictEqual(armor, wand);
	assert.notStrictEqual(sword?.overrides, armor?.overrides);
	assert.notStrictEqual(sword?.overrides, wand?.overrides);
	assert.notStrictEqual(armor?.overrides, wand?.overrides);
	assert.equal(queue.updateOverrides('same', { title: 'Edited Sword' }), true);
	assert.deepEqual(queue.getEntry('repair')?.overrides, { sourceText: 'Armor source' });
	assert.deepEqual(queue.getEntry('repair-2')?.overrides, { rulesMarkdown: 'Wand custom rules' });
});

void test('legacy id repair preserves valid ids that appear later in persisted order', () => {
	const queue = new PrintQueueService([
		{ filePath: 'missing-id.md', quantity: 1 },
		{ id: 'reserved', filePath: 'valid-id.md', quantity: 1 },
	], () => 'reserved');

	assert.deepEqual(queue.getEntries().map((entry) => entry.id), ['reserved-2', 'reserved']);
});

void test('ambiguous runtime ids fail safely instead of updating any entry', () => {
	const queue = createQueue();
	const sword = queue.add('sword-source.md', { title: 'Sword' });
	const armor = queue.add('armor-source.md', { title: 'Armor' });
	const before = structuredClone(queue.getEntries());
	armor.id = sword.id;
	before[1]!.id = sword.id;

	assert.equal(getUniqueQueueEntryById(queue.getEntries(), sword.id), undefined);
	assert.equal(queue.updateOverrides(sword.id, { title: 'Contaminated' }), false);
	assert.deepEqual(queue.getEntries(), before);
});

void test('different-source queue cards stay isolated after reload with missing temporary artwork', () => {
	assertDifferentSourceQueueIsolation({
		kind: 'temporary',
		id: 'missing-session-sword-art',
		name: 'sword.png',
		origin: 'local',
	});
});

void test('different-source queue cards stay isolated after reload with persistent artwork', () => {
	assertDifferentSourceQueueIsolation({ kind: 'vault', path: 'Card Forge Assets/sword.webp' });
});

function assertDifferentSourceQueueIsolation(
	artwork: NonNullable<CardOverrides['artwork']>,
): void {
	const items: ItemCardData[] = [
		{
			filePath: 'sword-source.md',
			name: 'Longsword',
			description: 'Sword rules',
			weight: 3,
			hasImage: false,
			rawTags: [],
		},
		{
			filePath: 'armor-source.md',
			name: 'Armor of Invulnerability',
			description: 'Armor rules',
			weight: 65,
			imagePath: 'armor.webp',
			hasImage: true,
			rawTags: [],
		},
		{
			filePath: 'wand-source.md',
			name: 'Wand of the Precocious Apprentice',
			description: 'Wand rules',
			imagePath: 'wand.webp',
			hasImage: true,
			rawTags: [],
		},
	];
	const queue = new PrintQueueService([
		{
			id: 'sword-id',
			filePath: 'sword-source.md',
			quantity: 1,
			overrides: {
				title: 'Sword of Khaine',
				stats: { cost: '15000 gp' },
				sourceText: 'Homebrew',
				artwork,
			},
		},
		{ id: 'armor-id', filePath: 'armor-source.md', quantity: 1 },
		{ id: 'wand-id', filePath: 'wand-source.md', quantity: 1 },
	]);
	assert.deepEqual(queue.getEntries().map((entry) => entry.id), [
		'sword-id',
		'armor-id',
		'wand-id',
	]);
	if (artwork.kind === 'temporary') {
		const restartedArtworkStore = new TemporaryArtworkStore();
		assert.equal(restartedArtworkStore.get(artwork.id), undefined);
	}
	const restored = new PrintQueueService(
		JSON.parse(JSON.stringify(queue.serialize())) as unknown,
		() => 'must-not-be-used',
	);
	const ids = restored.getEntries().map((entry) => entry.id);
	assert.deepEqual(ids, ['sword-id', 'armor-id', 'wand-id']);
	assert.equal(new Set(ids).size, 3);

	const swordDraft = structuredClone(restored.getEntry('sword-id')?.overrides);
	assert.ok(swordDraft);
	swordDraft.stats = { ...swordDraft.stats, cost: '15001 gp' };
	assert.equal(restored.updateOverrides('sword-id', swordDraft), true);

	const armor = restored.getEntry('armor-id');
	const wand = restored.getEntry('wand-id');
	assert.equal(armor?.overrides?.title, undefined);
	assert.equal(armor?.overrides?.stats?.cost, undefined);
	assert.equal(armor?.overrides?.sourceText, undefined);
	assert.notDeepEqual(armor?.overrides?.artwork, artwork);
	assert.equal(wand?.overrides?.title, undefined);
	assert.equal(wand?.overrides?.stats?.cost, undefined);
	assert.equal(wand?.overrides?.sourceText, undefined);
	assert.notDeepEqual(wand?.overrides?.artwork, artwork);

	const effective = new Map(restored.getEntries().map((entry) => {
		const source = items.find((item) => item.filePath === entry.filePath);
		assert.ok(source);
		return [entry.id, createEffectiveCardInput(source, items, entry.overrides).item];
	}));
	assert.equal(effective.get('sword-id')?.name, 'Sword of Khaine');
	assert.equal(effective.get('sword-id')?.weight, 3);
	assert.equal(effective.get('sword-id')?.cost, '15001 gp');
	assert.equal(effective.get('armor-id')?.name, 'Armor of Invulnerability');
	assert.equal(effective.get('armor-id')?.weight, 65);
	assert.equal(effective.get('armor-id')?.description, 'Armor rules');
	assert.equal(effective.get('armor-id')?.imagePath, 'armor.webp');
	assert.equal(effective.get('wand-id')?.name, 'Wand of the Precocious Apprentice');
	assert.equal(effective.get('wand-id')?.description, 'Wand rules');
	assert.equal(effective.get('wand-id')?.imagePath, 'wand.webp');
}
