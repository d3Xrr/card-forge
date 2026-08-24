import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import { PrintQueueService } from '../src/models/print-queue';
import { SavedPrintSetService } from '../src/models/saved-print-set';
import {
	addCurrentIndexedItemToQueue,
	resolveCurrentIndexedItem,
} from '../src/services/current-item-workflow';
import { SavedPrintSetSession } from '../src/services/saved-print-set-session';

const items: ItemCardData[] = [
	{
		filePath: 'items/longsword.md',
		name: 'Longsword',
		description: 'Rules',
		hasImage: false,
		rawTags: [],
	},
];

void test('resolves only the exact active indexed Markdown item', () => {
	assert.equal(resolveCurrentIndexedItem(items, {
		path: 'items/longsword.md',
		extension: 'md',
	})?.name, 'Longsword');
	assert.equal(resolveCurrentIndexedItem(items, {
		path: 'items/missing.md',
		extension: 'md',
	}), undefined);
	assert.equal(resolveCurrentIndexedItem(items, {
		path: 'items/longsword.pdf',
		extension: 'pdf',
	}), undefined);
	assert.equal(resolveCurrentIndexedItem(items, null), undefined);
});

void test('add-current-item uses canonical defaults, emits once, and never accepts editor overrides', () => {
	let nextId = 1;
	const queue = new PrintQueueService([], () => `command-${nextId++}`);
	let notifications = 0;
	queue.subscribe(() => {
		notifications += 1;
	});
	const activeEditorDraft = {
		title: 'Unrelated editor title',
		stats: { damage: '99d99' },
	};

	const first = addCurrentIndexedItemToQueue(queue, items[0]!);
	assert.equal(first.id, 'command-1');
	assert.equal(first.quantity, 1);
	assert.equal(first.overrides, undefined);
	assert.equal(notifications, 1);
	assert.deepEqual(activeEditorDraft, {
		title: 'Unrelated editor title',
		stats: { damage: '99d99' },
	});

	const second = addCurrentIndexedItemToQueue(queue, items[0]!);
	assert.equal(second.id, first.id);
	assert.equal(second.quantity, 2);
	assert.equal(second.overrides, undefined);
	assert.equal(queue.getEntries().length, 1);
	assert.equal(notifications, 2);
});

void test('add-current-item marks a loaded active Saved Set dirty through queue state', () => {
	const queue = new PrintQueueService([], () => 'command-id');
	queue.add('items/existing.md');
	const sets = new SavedPrintSetService([], () => 'set-id', () => 1);
	const saved = sets.save('Active', queue.getEntries());
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	const session = new SavedPrintSetSession();
	session.activate(saved.set.id, queue.getEntries());
	addCurrentIndexedItemToQueue(queue, items[0]!);
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, true);
});
