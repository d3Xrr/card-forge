import assert from 'node:assert/strict';
import test from 'node:test';

import {
	deserializePrintQueue,
	PrintQueueService,
	serializePrintQueue,
} from '../src/models/print-queue';
import { applyCardOverrides } from '../src/services/card-overrides';
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

void test('increments and decrements quantity without dropping below one', () => {
	const queue = createQueue();
	const entry = queue.add('items/scimitar.md');
	queue.increment(entry.id);
	queue.decrement(entry.id);
	queue.decrement(entry.id);
	assert.equal(queue.getEntries()[0]?.quantity, 1);
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
	assert.deepEqual(deserializePrintQueue([
		...original,
		{ id: 'two', filePath: 'items/one.md', quantity: 3 },
		{ id: '', filePath: 'items/missing-id.md', quantity: 1 },
		{ id: 'bad', filePath: 'items/bad.md', quantity: 0 },
	]), [{ id: 'one', filePath: 'items/one.md', quantity: 5 }]);
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
	const restored = deserializePrintQueue(queue.serialize());

	assert.deepEqual(restored.map((entry) => entry.id), [first.id, second.id]);
	assert.deepEqual(restored, queue.getEntries());
	assert.notStrictEqual(restored[0]?.overrides, restored[1]?.overrides);
});
