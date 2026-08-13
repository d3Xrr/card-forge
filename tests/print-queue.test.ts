import assert from 'node:assert/strict';
import test from 'node:test';

import {
	deserializePrintQueue,
	PrintQueueService,
	serializePrintQueue,
} from '../src/models/print-queue';

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
