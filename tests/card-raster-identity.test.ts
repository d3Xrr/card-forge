import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBackRasterCacheKey,
	createRasterCacheKey,
} from '../src/export/card-raster-identity';
import { createCardDesignProfile } from '../src/models/card-design';
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

void test('resolved Auto density participates in completed raster identity', () => {
	const standard = createPage({ rules: 'Auto density rules.' });
	standard.resolvedDensity = 'standard';
	const compact = { ...structuredClone(standard), resolvedDensity: 'compact' as const };
	const design = {
		...createCardDesignProfile(),
		theme: 'dark' as const,
		artworkSize: 'standard' as const,
		density: 'auto' as const,
	};
	assert.notEqual(
		createRasterCacheKey({ page: standard, design }),
		createRasterCacheKey({ page: compact, design }),
	);
});

void test('front framing and back framing invalidate only their relevant raster side', () => {
	const page = createPage({ rules: 'Framed art.' });
	const baseline = createCardDesignProfile();
	const frontFramed = {
		...baseline,
		frontArtworkFraming: { fitMode: 'fill' as const, zoom: 1.5, panX: 20, panY: 0 },
	};
	const backed = {
		...baseline,
		back: {
			style: 'artwork' as const,
			artworkFraming: { fitMode: 'fill' as const, zoom: 2, panX: -10, panY: 30 },
		},
	};
	assert.notEqual(
		createRasterCacheKey({ page, design: baseline }),
		createRasterCacheKey({ page, design: frontFramed }),
	);
	assert.equal(
		createRasterCacheKey({ page, design: baseline }),
		createRasterCacheKey({ page, design: backed }),
	);
	assert.notEqual(
		createBackRasterCacheKey({ page, design: baseline }),
		createBackRasterCacheKey({ page, design: backed }),
	);
});

void test('continuation pages of one logical card share a back raster identity', () => {
	const primary = createPage({ rules: 'Page one.' });
	primary.pageCount = 2;
	const continuation = structuredClone(primary);
	continuation.pageIndex = 1;
	continuation.kind = 'continuation';
	continuation.title = `${primary.title} (cont.)`;
	continuation.blocks = [{ type: 'paragraph', markdown: 'Page two.' }];
	const design = {
		...createCardDesignProfile(),
		back: { style: 'generic' as const, artworkFraming: { fitMode: 'fit' as const, zoom: 1, panX: 0, panY: 0 } },
	};
	assert.equal(
		createBackRasterCacheKey({ page: primary, physicalPlanKey: 'logical', design }),
		createBackRasterCacheKey({ page: continuation, physicalPlanKey: 'logical', design }),
	);
});

void test('mixed back styles cannot incorrectly share raster output', () => {
	const page = createPage({ rules: 'Mixed back styles.' });
	const styles = ['none', 'generic', 'rarity', 'item-type', 'artwork', 'custom-image'] as const;
	const keys = styles.map((style) => createBackRasterCacheKey({
		page,
		artworkResourcePath: style === 'artwork' || style === 'custom-image'
			? `app://art/${style}.png`
			: undefined,
		design: {
			...createCardDesignProfile(),
			back: {
				style,
				...(style === 'custom-image'
					? { customArtworkPath: 'Card Forge Assets/back.png' }
					: {}),
				artworkFraming: { fitMode: 'fit', zoom: 1, panX: 0, panY: 0 },
			},
		},
	}));
	assert.equal(new Set(keys).size, styles.length);
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
