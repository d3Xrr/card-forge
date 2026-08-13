import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ArtworkBoundsCache,
	calculateVisibleAlphaBounds,
	projectAnalysisBounds,
} from '../src/renderer/artwork-bounds';

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

void test('caches artwork-bound analysis by path for the session', async () => {
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
