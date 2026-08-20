import assert from 'node:assert/strict';
import test from 'node:test';

import { createRasterCacheKey } from '../src/export/card-raster-identity';
import type { ItemCardData } from '../src/models/item';
import type { ItemCardPage } from '../src/models/item-card-page';

void test('source path and page index cannot collapse distinct printable rules', () => {
	const first = createPage({ rules: 'Synthetic rules AAA.' });
	const second = createPage({ rules: 'Synthetic rules BBB.' });
	assert.equal(first.item.filePath, second.item.filePath);
	assert.equal(first.pageIndex, second.pageIndex);
	assert.notEqual(
		createRasterCacheKey({ page: first }),
		createRasterCacheKey({ page: second }),
	);
});

void test('artwork resource and revision participate in raster identity', () => {
	const page = createPage({ rules: 'Shared rules.' });
	const sourceArtwork = createRasterCacheKey({
		page,
		artworkResourcePath: 'app://vault/source.webp',
		artworkRevisionFingerprint: 'source-art-v1',
	});
	const vaultArtwork = createRasterCacheKey({
		page,
		artworkResourcePath: 'app://vault/alternate.webp',
		artworkRevisionFingerprint: 'alternate-art-v1',
	});
	const changedArtwork = createRasterCacheKey({
		page,
		artworkResourcePath: 'app://vault/source.webp',
		artworkRevisionFingerprint: 'source-art-v2',
	});
	assert.notEqual(vaultArtwork, sourceArtwork);
	assert.notEqual(changedArtwork, sourceArtwork);
});

void test('variant, statistics, and literal source changes produce distinct rasters', () => {
	const baseline = createPage({ name: 'Synthetic Dagger' });
	const variant = createPage({ name: 'Synthetic Warhammer' });
	const statistics = createPage({ name: 'Synthetic Dagger', damage: '1d8' });
	const source = createPage({
		name: 'Synthetic Dagger',
		sourceDisplayOverride: 'Literal source override',
	});
	const baselineKey = createRasterCacheKey({ page: baseline });
	for (const changed of [variant, statistics, source]) {
		assert.notEqual(createRasterCacheKey({ page: changed }), baselineKey);
	}
});

void test('equivalent physical pages still reuse one raster identity', () => {
	const page = createPage({ rules: 'Identical printable rules.' });
	const input = {
		page,
		physicalPlanKey: 'exact-plan-key',
		artworkResourcePath: 'blob:temporary-artwork',
		artworkRevisionFingerprint: 'temporary-session-art-v1',
	};
	assert.equal(
		createRasterCacheKey(input),
		createRasterCacheKey({ ...input, page: structuredClone(page) }),
	);
	assert.notEqual(
		createRasterCacheKey(input),
		createRasterCacheKey({ ...input, physicalPlanKey: 'different-plan-key' }),
	);
});

function createPage(input: {
	name?: string;
	rules?: string;
	damage?: string;
	sourceDisplayOverride?: string;
}): ItemCardPage {
	const rules = input.rules ?? 'Synthetic rules.';
	const item: ItemCardData = {
		filePath: 'items/synthetic-source.md',
		name: input.name ?? 'Synthetic Quarterstaff',
		description: rules,
		hasImage: true,
		imagePath: 'items/img/source.webp',
		damage: input.damage ?? '1d6',
		...(input.sourceDisplayOverride
			? { sourceDisplayOverride: input.sourceDisplayOverride }
			: {}),
		rawTags: [],
	};
	return {
		item,
		pageIndex: 0,
		pageCount: 1,
		kind: 'primary',
		title: item.name,
		blocks: [{ type: 'paragraph', markdown: rules }],
		layout: 'image',
		bodyFontPoints: 9,
		artworkSharePercent: 20,
		showArtwork: true,
		showStats: true,
		statsPresentation: 'full',
		showSource: true,
		artworkOrientation: 'landscape',
		hasUnsplitOverflow: false,
	};
}
