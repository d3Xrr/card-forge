import assert from 'node:assert/strict';
import test from 'node:test';
import type { App } from 'obsidian';

import type { ItemCardData } from '../src/models/item';
import {
	ArtworkBoundsCache,
	calculateVisibleAlphaBounds,
	createArtworkBoundsCacheKey,
	projectAnalysisBounds,
} from '../src/renderer/artwork-bounds';
import {
	createArtworkRevisionFingerprint,
	resolveArtworkDescriptor,
} from '../src/services/artwork-resolver';

void test('detects artwork with no transparent padding', () => {
	const rgba = createPixels(3, 2, [
		[0, 0], [1, 0], [2, 0],
		[0, 1], [1, 1], [2, 1],
	]);
	assert.deepEqual(calculateVisibleAlphaBounds(rgba, 3, 2), {
		x: 0,
		y: 0,
		width: 3,
		height: 2,
	});
});

void test('finds visible content inside large transparent padding', () => {
	const visiblePixels: Array<[number, number]> = [[2, 1], [3, 1], [2, 3], [3, 3]];
	const bounds = calculateVisibleAlphaBounds(createPixels(6, 5, visiblePixels), 6, 5);
	assert.deepEqual(bounds, { x: 2, y: 1, width: 2, height: 3 });
	for (const [x, y] of visiblePixels) {
		assert.ok(bounds && x >= bounds.x && x < bounds.x + bounds.width);
		assert.ok(bounds && y >= bounds.y && y < bounds.y + bounds.height);
	}
});

void test('falls back for fully transparent or invalid image data', () => {
	assert.equal(calculateVisibleAlphaBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4), undefined);
	assert.equal(calculateVisibleAlphaBounds(new Uint8ClampedArray(4), 0, 1), undefined);
	assert.equal(calculateVisibleAlphaBounds(new Uint8ClampedArray(4), 2, 2), undefined);
});

void test('projects downscaled bounds outward so visible pixels are never excluded', () => {
	const projected = projectAnalysisBounds(
		{ x: 2, y: 1, width: 2, height: 3 },
		6,
		5,
		600,
		500,
	);
	assert.ok(projected.x <= 200);
	assert.ok(projected.y <= 100);
	assert.ok(projected.x + projected.width >= 400);
	assert.ok(projected.y + projected.height >= 400);
});

void test('deduplicates artwork-bound analysis and caches safe fallbacks', async () => {
	const cache = new ArtworkBoundsCache<number>();
	let calls = 0;
	const factory = async (): Promise<number> => {
		calls += 1;
		return 42;
	};
	const first = cache.getOrCreate('art.webp', factory);
	const second = cache.getOrCreate('art.webp', factory);
	assert.strictEqual(first, second);
	assert.equal(await second, 42);
	assert.equal(calls, 1);
	assert.equal(cache.size, 1);

	const fallbackCache = new ArtworkBoundsCache<undefined>();
	let fallbackCalls = 0;
	const firstFallback = fallbackCache.getOrCreate('broken.webp', async () => {
		fallbackCalls += 1;
		return undefined;
	});
	const secondFallback = fallbackCache.getOrCreate('broken.webp', async () => {
		fallbackCalls += 1;
		return undefined;
	});
	assert.strictEqual(firstFallback, secondFallback);
	assert.equal(await secondFallback, undefined);
	assert.equal(fallbackCalls, 1);
});

void test('evicts least recently used artwork bounds deterministically', async () => {
	const cache = new ArtworkBoundsCache<number>(2);
	let secondCalls = 0;
	await cache.getOrCreate('first', async () => 1);
	await cache.getOrCreate('second', async () => {
		secondCalls += 1;
		return 2;
	});
	await cache.getOrCreate('first', async () => 10);
	await cache.getOrCreate('third', async () => 3);
	assert.equal(cache.size, 2);
	assert.equal(await cache.getOrCreate('first', async () => 10), 1);
	assert.equal(await cache.getOrCreate('second', async () => {
		secondCalls += 1;
		return 20;
	}), 20);
	assert.equal(secondCalls, 2);
	assert.equal(cache.size, 2);
});

void test('artwork cache keys change with the resolved vault file revision', () => {
	const firstRevision = createArtworkRevisionFingerprint({
		filePath: 'art/items/example.webp',
		modifiedTime: 100,
		size: 200,
	});
	const repeatedRevision = createArtworkRevisionFingerprint({
		filePath: 'art/items/example.webp',
		modifiedTime: 100,
		size: 200,
	});
	const changedRevision = createArtworkRevisionFingerprint({
		filePath: 'art/items/example.webp',
		modifiedTime: 101,
		size: 200,
	});
	assert.equal(repeatedRevision, firstRevision);
	assert.equal(
		createArtworkBoundsCacheKey('app://vault/example.webp', repeatedRevision),
		createArtworkBoundsCacheKey('app://vault/example.webp', firstRevision),
	);
	assert.notEqual(
		createArtworkBoundsCacheKey('app://vault/example.webp', changedRevision),
		createArtworkBoundsCacheKey('app://vault/example.webp', firstRevision),
	);
	assert.notEqual(
		createArtworkBoundsCacheKey('app://vault/other.webp', firstRevision),
		createArtworkBoundsCacheKey('app://vault/example.webp', firstRevision),
	);
});

void test('resolves artwork resource and vault revision as one descriptor', () => {
	const artworkFile = {
		path: 'art/items/example.webp',
		extension: 'webp',
		stat: { mtime: 100, size: 200 },
	};
	const app = {
		vault: {
			getFileByPath: () => artworkFile,
			getResourcePath: () => 'app://vault/example.webp',
		},
		metadataCache: {
			getFirstLinkpathDest: () => null,
		},
	} as unknown as App;
	const item: ItemCardData = {
		filePath: 'items/example.md',
		name: 'Example Item',
		description: 'Rules.',
		imagePath: artworkFile.path,
		hasImage: true,
		rawTags: [],
	};

	assert.deepEqual(resolveArtworkDescriptor(app, item), {
		resourcePath: 'app://vault/example.webp',
		filePath: artworkFile.path,
		modifiedTime: 100,
		size: 200,
		revisionFingerprint: createArtworkRevisionFingerprint({
			filePath: artworkFile.path,
			modifiedTime: 100,
			size: 200,
		}),
	});
});

void test('rejects invalid artwork cache capacities', () => {
	assert.throws(() => new ArtworkBoundsCache(0), RangeError);
	assert.throws(() => new ArtworkBoundsCache(1.5), RangeError);
});

function createPixels(
	width: number,
	height: number,
	visiblePixels: ReadonlyArray<readonly [number, number]>,
): Uint8ClampedArray {
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (const [x, y] of visiblePixels) {
		rgba[(y * width + x) * 4 + 3] = 255;
	}
	return rgba;
}
