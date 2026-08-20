import assert from 'node:assert/strict';
import test from 'node:test';

import {
	deserializePrintQueue,
	PrintQueueService,
	serializePrintQueue,
} from '../src/models/print-queue';
import { applyCardOverrides } from '../src/services/card-overrides';
import type { ItemCardData } from '../src/models/item';

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
