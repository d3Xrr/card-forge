import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	createPhysicalPlanCacheIdentity,
	createPhysicalPlanCacheKey,
	createSourceContentFingerprint,
	PhysicalPlanCache,
	type PhysicalPlanCacheKeyInput,
} from '../src/services/physical-plan-cache';

void test('builds a canonical key from every physical planning input slot', () => {
	const input = createKeyInput();
	const key = createPhysicalPlanCacheKey(input);
	const parsed = JSON.parse(key) as Record<string, unknown>;
	assert.deepEqual(Object.keys(parsed), [
		'schemaRevision',
		'filePath',
		'sourceFingerprint',
		'item',
		'artwork',
		'physicalProfile',
		'plannerRevision',
		'rendererRevision',
		'renderSettingsFingerprint',
		'overrideFingerprint',
		'layoutDesignFingerprint',
	]);
	assert.deepEqual(Object.keys(parsed.item as object), [
		'filePath',
		'name',
		'description',
		'detail',
		'imagePath',
		'sourceText',
		'sourceDisplayOverride',
		'hasImage',
		'rarity',
		'attunement',
		'source',
		'damage',
		'damageTwoHanded',
		'range',
		'properties',
		'mastery',
		'cost',
		'weight',
		'rawTags',
		'typeText',
		'rarityText',
		'attunementText',
		'structuredFieldOrigins',
		'manualRuleSegments',
	]);
	assert.equal(createPhysicalPlanCacheKey(structuredClone(input)), key);
	assert.equal(
		createPhysicalPlanCacheIdentity(input).artworkFilePath,
		'art/example.webp',
	);

	const variants: PhysicalPlanCacheKeyInput[] = [
		{ ...input, sourceFingerprint: 'source-2' },
		{ ...input, item: { ...input.item, mastery: 'graze' } },
		{ ...input, item: { ...input.item, typeText: 'Edited weapon' } },
		{ ...input, item: { ...input.item, sourceDisplayOverride: 'Literal' } },
		{ ...input, item: { ...input.item, manualRuleSegments: ['A', 'B'] } },
		{
			...input,
			item: {
				...input.item,
				structuredFieldOrigins: { cost: 'base' },
			},
		},
		{
			...input,
			artworkFingerprint: { ...input.artworkFingerprint!, modifiedTime: 124 },
		},
		{
			...input,
			physicalProfile: { ...input.physicalProfile!, widthPx: 751 },
		},
		{ ...input, plannerRevision: 'planner-2' },
		{ ...input, rendererRevision: 'renderer-2' },
		{ ...input, renderSettingsFingerprint: 'settings-2' },
		{ ...input, overrideFingerprint: 'override-2' },
		{ ...input, layoutDesignFingerprint: 'design-layout-2' },
	];
	for (const variant of variants) {
		assert.notEqual(createPhysicalPlanCacheKey(variant), key);
	}
});

void test('equal Cost text with inherited and explicit provenance cannot share a plan', () => {
	const input = createKeyInput();
	const inherited = createPhysicalPlanCacheKey({
		...input,
		item: { ...input.item, structuredFieldOrigins: { cost: 'base' } },
	});
	const explicit = createPhysicalPlanCacheKey({
		...input,
		item: { ...input.item, structuredFieldOrigins: { cost: 'override' } },
	});
	assert.notEqual(inherited, explicit);
});

void test('deduplicates concurrent work and exposes the completed plan', async () => {
	const cache = new PhysicalPlanCache<string>(4);
	const identity = createIdentity('items/one.md', 'source-1');
	const deferred = createDeferred<string>();
	let calls = 0;
	const factory = (): Promise<string> => {
		calls += 1;
		return deferred.promise;
	};

	const first = cache.getOrCreate(identity, factory);
	const second = cache.getOrCreate(identity, factory);
	assert.strictEqual(first, second);
	assert.equal(cache.getStatus(identity), 'pending');
	assert.equal(cache.inFlightSize, 1);
	deferred.resolve('physical-plan');
	assert.equal(await first, 'physical-plan');
	assert.equal(calls, 1);
	assert.equal(cache.inFlightSize, 0);
	assert.equal(cache.completedSize, 1);
	assert.equal(cache.peek(identity), 'physical-plan');
	assert.equal(cache.getStatus(identity), 'hit');
	assert.equal(await cache.getOrCreate(identity, () => 'unexpected'), 'physical-plan');
	assert.equal(calls, 1);
});

void test('same source with distinct effective overrides cannot share a physical plan', async () => {
	const cache = new PhysicalPlanCache<string>();
	const baseline = createKeyInput('items/shared.md', 'source-shared');
	const first = createPhysicalPlanCacheIdentity({
		...baseline,
		item: { ...baseline.item, description: 'Rules AAA' },
		overrideFingerprint: 'override-aaa',
	});
	const second = createPhysicalPlanCacheIdentity({
		...baseline,
		item: { ...baseline.item, description: 'Rules BBB' },
		overrideFingerprint: 'override-bbb',
	});
	let calls = 0;
	assert.notEqual(first.key, second.key);
	assert.equal(await cache.getOrCreate(first, () => {
		calls += 1;
		return 'plan-aaa';
	}), 'plan-aaa');
	assert.equal(await cache.getOrCreate(second, () => {
		calls += 1;
		return 'plan-bbb';
	}), 'plan-bbb');
	assert.equal(await cache.getOrCreate(first, () => 'wrong'), 'plan-aaa');
	assert.equal(calls, 2);
});

void test('fingerprints raw source revisions without retaining source text', () => {
	const first = createSourceContentFingerprint('Private source rules.', 100, 21);
	assert.equal(
		createSourceContentFingerprint('Private source rules.', 100, 21),
		first,
	);
	assert.notEqual(
		createSourceContentFingerprint('Changed private source rules.', 101, 29),
		first,
	);
	assert.equal(first.includes('Private source rules.'), false);
});

void test('removes rejected work so a later request can retry', async () => {
	const cache = new PhysicalPlanCache<string>();
	const identity = createIdentity('items/retry.md', 'source-1');
	let calls = 0;

	await assert.rejects(cache.getOrCreate(identity, () => {
		calls += 1;
		throw new Error('temporary failure');
	}), /temporary failure/u);
	assert.equal(cache.inFlightSize, 0);
	assert.equal(cache.completedSize, 0);
	assert.equal(await cache.getOrCreate(identity, () => {
		calls += 1;
		return 'recovered';
	}), 'recovered');
	assert.equal(calls, 2);
});

void test('evicts the least recently used completed plan predictably', async () => {
	const cache = new PhysicalPlanCache<string>(2);
	const first = createIdentity('items/first.md', 'source-1');
	const second = createIdentity('items/second.md', 'source-1');
	const third = createIdentity('items/third.md', 'source-1');

	await cache.getOrCreate(first, () => 'first');
	await cache.getOrCreate(second, () => 'second');
	assert.equal(cache.peek(first), 'first');
	await cache.getOrCreate(third, () => 'third');

	assert.equal(cache.peek(first), 'first');
	assert.equal(cache.peek(second), undefined);
	assert.equal(cache.peek(third), 'third');
	assert.equal(cache.completedSize, 2);
});

void test('reconciles only changed item keys and preserves unrelated plans', async () => {
	const cache = new PhysicalPlanCache<string>();
	const oldItem = createIdentity('items/changed.md', 'source-1');
	const currentItem = createIdentity('items/changed.md', 'source-2');
	const unrelated = createIdentity('items/unrelated.md', 'source-1');
	await cache.getOrCreate(oldItem, () => 'old');
	await cache.getOrCreate(unrelated, () => 'unrelated');

	assert.equal(cache.reconcile([currentItem]), 1);
	assert.equal(cache.peek(oldItem), undefined);
	assert.equal(cache.peek(unrelated), 'unrelated');
	await cache.getOrCreate(currentItem, () => 'current');
	assert.equal(cache.invalidateFile('items/unrelated.md'), 1);
	assert.equal(cache.peek(unrelated), undefined);
	assert.equal(cache.peek(currentItem), 'current');
});

void test('does not promote invalidated in-flight work into the completed cache', async () => {
	const cache = new PhysicalPlanCache<string>();
	const identity = createIdentity('items/changing.md', 'source-1');
	const deferred = createDeferred<string>();
	const pending = cache.getOrCreate(identity, () => deferred.promise);

	assert.equal(cache.invalidateFile(identity.filePath), 1);
	deferred.resolve('stale');
	assert.equal(await pending, 'stale');
	assert.equal(cache.peek(identity), undefined);
	assert.equal(cache.completedSize, 0);
});

void test('invalidates only plans using changed artwork', async () => {
	const cache = new PhysicalPlanCache<string>();
	const first = createIdentity('items/first.md', 'source-1');
	const second = createPhysicalPlanCacheIdentity({
		...createKeyInput('items/second.md', 'source-1'),
		artworkFingerprint: {
			filePath: 'art/other.webp',
			modifiedTime: 123,
			size: 456,
		},
	});
	await cache.getOrCreate(first, () => 'first');
	await cache.getOrCreate(second, () => 'second');

	assert.equal(cache.invalidateArtwork('art/example.webp'), 1);
	assert.equal(cache.getStatus(first), 'miss');
	assert.equal(cache.peek(second), 'second');
});

void test('rejects invalid cache capacities', () => {
	assert.throws(() => new PhysicalPlanCache(0), RangeError);
	assert.throws(() => new PhysicalPlanCache(1.5), RangeError);
});

function createIdentity(filePath: string, sourceFingerprint: string) {
	return createPhysicalPlanCacheIdentity(createKeyInput(filePath, sourceFingerprint));
}

function createKeyInput(
	filePath = 'items/example.md',
	sourceFingerprint = 'source-1',
): PhysicalPlanCacheKeyInput {
	return {
		item: createItem(filePath),
		sourceFingerprint,
		artworkFingerprint: {
			filePath: 'art/example.webp',
			modifiedTime: 123,
			size: 456,
			contentFingerprint: 'art-1',
		},
		physicalProfile: {
			widthMm: 63.5,
			heightMm: 88.9,
			widthPx: 750,
			heightPx: 1050,
			dpi: 300,
		},
		plannerRevision: 'planner-1',
		rendererRevision: 'renderer-1',
		renderSettingsFingerprint: 'settings-1',
		overrideFingerprint: 'override-1',
	};
}

function createItem(filePath: string): ItemCardData {
	return {
		filePath,
		name: 'Example Item',
		description: 'Rules text.',
		detail: 'Weapon, rare',
		imagePath: 'art/example.webp',
		sourceText: 'Example source',
		hasImage: true,
		rarity: 'rare',
		attunement: true,
		source: 'TEST',
		damage: '1d8',
		damageTwoHanded: '1d10',
		range: '20/60',
		properties: ['thrown', 'versatile'],
		mastery: 'topple',
		cost: '25 gp',
		weight: 4,
		rawTags: ['item', 'weapon'],
	};
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
