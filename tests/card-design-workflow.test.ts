import assert from 'node:assert/strict';
import test from 'node:test';

import { createRasterCacheKey } from '../src/export/card-raster-identity';
import {
	createCardDesignProfile,
	createLayoutDesignFingerprint,
	normalizeCardDesignProfile,
} from '../src/models/card-design';
import type { ItemCardPage } from '../src/models/item-card-page';
import type { ItemCardData } from '../src/models/item';
import { PrintQueueService } from '../src/models/print-queue';
import { SavedPrintSetService } from '../src/models/saved-print-set';
import { addCurrentIndexedItemToQueue } from '../src/services/current-item-workflow';
import {
	createPhysicalPlanCacheIdentity,
} from '../src/services/physical-plan-cache';
import {
	flattenPrintQueue,
	resolvePrintQueue,
} from '../src/services/print-queue-planner';
import { SavedPrintSetSession } from '../src/services/saved-print-set-session';

const item: ItemCardData = {
	filePath: 'items/example.md',
	name: 'Example',
	description: 'Rules.',
	hasImage: true,
	imagePath: 'items/example.webp',
	rawTags: [],
};

const page: ItemCardPage = {
	item,
	pageIndex: 0,
	pageCount: 1,
	kind: 'primary',
	title: item.name,
	blocks: [{ type: 'paragraph', markdown: item.description }],
	layout: 'image',
	showArtwork: true,
	showStats: false,
	showSource: false,
	hasUnsplitOverflow: false,
};

function createQueue(prefix = 'entry'): PrintQueueService {
	let id = 1;
	return new PrintQueueService([], () => `${prefix}-${id++}`);
}

void test('new queue entries snapshot design while legacy entries keep the stable fallback', () => {
	const queue = createQueue();
	const legacy = queue.add('items/legacy.md');
	const light = normalizeCardDesignProfile({
		theme: 'light', artworkSize: 'larger', density: 'compact',
		fieldVisibility: { weight: false },
	});
	const designed = queue.add(item.filePath, undefined, light);
	assert.equal(legacy.design, undefined);
	assert.deepEqual(designed.design, light);

	const restored = new PrintQueueService(JSON.parse(JSON.stringify(queue.serialize())) as unknown);
	assert.deepEqual(restored.getEntry(designed.id)?.design, light);
	assert.deepEqual(normalizeCardDesignProfile(restored.getEntry(legacy.id)?.design), {
		theme: 'dark', artworkSize: 'standard', density: 'standard',
	});
});

void test('same content with different designs remains distinct and Duplicate is isolated', () => {
	const queue = createQueue();
	const dark = queue.add(item.filePath, undefined, createCardDesignProfile());
	const light = queue.add(item.filePath, undefined, normalizeCardDesignProfile({
		theme: 'light', artworkSize: 'standard', density: 'standard',
	}));
	assert.notEqual(dark.id, light.id);
	const duplicate = queue.duplicate(light.id);
	assert.ok(duplicate);
	assert.notStrictEqual(duplicate.design, light.design);
	queue.updateDesign(duplicate.id, normalizeCardDesignProfile({
		theme: 'printer-friendly', artworkSize: 'minimal', density: 'standard',
	}));
	assert.equal(queue.getEntry(light.id)?.design?.theme, 'light');
	assert.equal(queue.getEntry(duplicate.id)?.design?.theme, 'printer-friendly');
});

void test('queue editor save persists content and design atomically', () => {
	const queue = createQueue();
	const entry = queue.add(item.filePath, { title: 'Before' }, createCardDesignProfile());
	assert.equal(queue.updateCard(entry.id, { title: 'After' }, normalizeCardDesignProfile({
		theme: 'light', artworkSize: 'larger', density: 'compact',
	})), true);
	assert.equal(queue.getEntry(entry.id)?.overrides?.title, 'After');
	assert.equal(queue.getEntry(entry.id)?.design?.theme, 'light');
});

void test('Saved Sets preserve designs and include design in dirty fingerprints', () => {
	const queue = createQueue('live');
	const entry = queue.add(item.filePath, undefined, normalizeCardDesignProfile({
		theme: 'light', artworkSize: 'larger', density: 'standard',
		fieldVisibility: { weight: false },
	}));
	const sets = new SavedPrintSetService([], () => 'set-1', () => 1);
	const saved = sets.save('Designed set', queue.getEntries());
	assert.equal(saved.status, 'created');
	if (saved.status !== 'created') {
		return;
	}
	const session = new SavedPrintSetSession();
	session.activate(saved.set.id, queue.getEntries());
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, false);
	queue.updateDesign(entry.id, normalizeCardDesignProfile({
		theme: 'printer-friendly', artworkSize: 'larger', density: 'standard',
		fieldVisibility: { weight: false },
	}));
	assert.equal(session.getState(sets.getSets(), queue.getEntries()).dirty, true);

	const loaded = createQueue('loaded');
	assert.equal(
		sets.loadIntoQueue(saved.set.id, loaded, new Set([item.filePath])).status,
		'loaded',
	);
	assert.equal(loaded.getEntries()[0]?.design?.theme, 'light');
	assert.deepEqual(loaded.getEntries()[0]?.design?.fieldVisibility, { weight: false });
});

void test('command Add snapshots the supplied global defaults without editor leakage', () => {
	const queue = createQueue('command');
	const defaults = normalizeCardDesignProfile({
		theme: 'light', artworkSize: 'minimal', density: 'compact',
	});
	const entry = addCurrentIndexedItemToQueue(queue, item, defaults);
	assert.deepEqual(entry.design, defaults);
	assert.equal(entry.overrides, undefined);
});

void test('theme reuses physical plans but rerasterizes, while layout choices replan', () => {
	const dark = createCardDesignProfile();
	const light = normalizeCardDesignProfile({ ...dark, theme: 'light' });
	const larger = normalizeCardDesignProfile({ ...dark, artworkSize: 'larger' });
	const base = {
		item,
		sourceFingerprint: 'source-v1',
		overrideFingerprint: 'none',
	};
	const darkPlan = createPhysicalPlanCacheIdentity({
		...base,
		layoutDesignFingerprint: createLayoutDesignFingerprint(dark),
	});
	const lightPlan = createPhysicalPlanCacheIdentity({
		...base,
		layoutDesignFingerprint: createLayoutDesignFingerprint(light),
	});
	const largerPlan = createPhysicalPlanCacheIdentity({
		...base,
		layoutDesignFingerprint: createLayoutDesignFingerprint(larger),
	});
	assert.equal(darkPlan.key, lightPlan.key);
	assert.notEqual(darkPlan.key, largerPlan.key);
	assert.notEqual(
		createRasterCacheKey({ page, physicalPlanKey: darkPlan.key, design: dark }),
		createRasterCacheKey({ page, physicalPlanKey: lightPlan.key, design: light }),
	);
});

void test('flattened A4/PDF inputs retain per-entry mixed designs', () => {
	const queue = createQueue();
	const dark = queue.add(item.filePath, undefined, createCardDesignProfile());
	const light = queue.add(item.filePath, { title: 'Light copy' }, normalizeCardDesignProfile({
		theme: 'light', artworkSize: 'standard', density: 'standard',
	}));
	const plans = new Map([
		[dark.id, { item, pages: [page], unfitPageIndexes: new Set<number>() }],
		[light.id, { item: { ...item, name: 'Light copy' }, pages: [page], unfitPageIndexes: new Set<number>() }],
	]);
	const cards = flattenPrintQueue(resolvePrintQueue(queue.getEntries(), [item], plans));
	assert.deepEqual(cards.map((card) => card.design.theme), ['dark', 'light']);
});
