import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import { PHYSICAL_CARD_PROFILE } from '../src/models/physical-card-profile';
import {
	estimateDescriptionLoad,
	getAdaptiveBodyFontCandidates,
	getItemCardLayoutProfile,
	MINIMUM_PRINT_BODY_FONT_POINTS,
	selectItemCardLayout,
	selectPreferredBodyFontPoints,
} from '../src/renderer/item-card-layout';
import {
	chooseArtworkPriorityFit,
	createItemCardPageMeasurementKey,
	findBestAdaptiveBodyFit,
	ITEM_CARD_FIT_CAPACITY_SCALES,
	ITEM_CARD_MEASUREMENT_RENDER_REVISION,
} from '../src/renderer/item-card-fit-service';
import { PRINT_TYPOGRAPHY } from '../src/renderer/print-typography';

function createItem(overrides: Partial<ItemCardData> = {}): ItemCardData {
	return {
		filePath: '2. Mechanics/items/test-item.md',
		name: 'Test Item',
		description: 'A short rules paragraph.',
		hasImage: true,
		rawTags: [],
		...overrides,
	};
}

void test('selects image layout for artwork with a short description', () => {
	assert.equal(selectItemCardLayout(createItem()), 'image');
});

void test('selects portrait layout for tall artwork', () => {
	assert.equal(selectItemCardLayout(createItem(), 'portrait'), 'portrait');
});

void test('selects compact layout for a medium structured description', () => {
	const description = Array.from(
		{ length: 7 },
		(_, index) => `Paragraph ${index + 1} explains a distinct magical rule with enough words to wrap.`,
	).join('\n\n');
	assert.equal(selectItemCardLayout(createItem({ description })), 'compact');
});

void test('selects text layout for missing artwork or heavy rules text', () => {
	assert.equal(selectItemCardLayout(createItem({ hasImage: false })), 'text');

	const longDescription = Array.from(
		{ length: 18 },
		(_, index) => `Rule ${index + 1}. This paragraph contains extensive instructions and conditional effects.`,
	).join('\n\n');
	assert.equal(selectItemCardLayout(createItem({ description: longDescription })), 'text');
});

void test('layout load accounts for paragraphs and lists as well as text length', () => {
	const flat = 'One concise sentence with a modest amount of text.';
	const structured = '- First option\n- Second option\n- Third option';
	assert.ok(estimateDescriptionLoad(structured) > estimateDescriptionLoad(flat));
});

void test('layout profiles never shrink below the minimum print body size', () => {
	assert.equal(MINIMUM_PRINT_BODY_FONT_POINTS, 7);
	for (const layout of ['image', 'portrait', 'compact', 'text'] as const) {
		assert.ok(
			getItemCardLayoutProfile(layout).printFontPoints
				>= MINIMUM_PRINT_BODY_FONT_POINTS,
		);
	}
	assert.ok(
		getItemCardLayoutProfile('image').artworkSharePercent
			> getItemCardLayoutProfile('compact').artworkSharePercent,
	);
	assert.equal(getItemCardLayoutProfile('text', 6).printFontPoints, 7);
	assert.equal(getItemCardLayoutProfile('text', 8).printFontPoints, 8);
	assert.equal(getItemCardLayoutProfile('image', 10).artworkSharePercent, 43);
	assert.equal(getItemCardLayoutProfile('image', 10, true).artworkSharePercent, 34);
	assert.equal(getItemCardLayoutProfile('compact', 8, true, 20).artworkSharePercent, 20);
	assert.equal(getItemCardLayoutProfile('compact', 8, true, 10).artworkSharePercent, 16);
});

void test('keeps title, subtitle, stats, and source floors independent from adaptive body type', () => {
	assert.ok(PRINT_TYPOGRAPHY.title.targetPoints >= 15);
	assert.ok(PRINT_TYPOGRAPHY.title.minimumPoints >= 14);
	assert.ok(PRINT_TYPOGRAPHY.subtitle.minimumPoints >= 8);
	assert.equal(PRINT_TYPOGRAPHY.body.targetPoints, 10);
	assert.equal(PRINT_TYPOGRAPHY.body.minimumPoints, 7);
	assert.ok(PRINT_TYPOGRAPHY.stats.minimumPoints >= 8);
	assert.ok(PRINT_TYPOGRAPHY.statLabel.minimumPoints >= 7.5);
	assert.ok(PRINT_TYPOGRAPHY.source.minimumPoints >= 7.5);
	assert.ok(PRINT_TYPOGRAPHY.pageNumber.minimumPoints >= 7.5);
	assert.ok(PRINT_TYPOGRAPHY.stats.minimumPoints > PRINT_TYPOGRAPHY.body.minimumPoints);
	assert.ok(
		PRINT_TYPOGRAPHY.continuationTitle.targetPoints
			< PRINT_TYPOGRAPHY.title.targetPoints,
	);
});

void test('selects comfortable defaults while retaining every legal adaptive body step', () => {
	assert.equal(selectPreferredBodyFontPoints('A short effect.'), 10);
	assert.equal(
		selectPreferredBodyFontPoints('A'.repeat(2_000)),
		MINIMUM_PRINT_BODY_FONT_POINTS,
	);
	assert.deepEqual(getAdaptiveBodyFontCandidates(), [10, 9.5, 9, 8.5, 8, 7.5, 7]);
});

void test('adaptive fit tries every legal size and selects the largest size at the best page count', async () => {
	const attempted: number[] = [];
	const result = await findBestAdaptiveBodyFit(
		getAdaptiveBodyFontCandidates(),
		(points) => {
			attempted.push(points);
			return Promise.resolve({
				pageCount: points >= 9 ? 3 : 2,
				value: `${points} pt`,
			});
		},
		2,
	);

	assert.deepEqual(attempted, [10, 9.5, 9, 8.5]);
	assert.equal(result?.bodyFontPoints, 8.5);
	assert.equal(result?.pageCount, 2);
	const exhaustive = await findBestAdaptiveBodyFit(
		getAdaptiveBodyFontCandidates(),
		(points) => Promise.resolve({
			pageCount: points >= 9 ? 3 : 2,
			value: `${points} pt`,
		}),
	);
	assert.deepEqual(result, exhaustive);
});

void test('adaptive fit reports failure only after exhausting the 7 pt floor', async () => {
	const attempted: number[] = [];
	const result = await findBestAdaptiveBodyFit(
		getAdaptiveBodyFontCandidates(),
		(points) => {
			attempted.push(points);
			return Promise.resolve(undefined);
		},
	);

	assert.equal(result, undefined);
	assert.deepEqual(attempted, [10, 9.5, 9, 8.5, 8, 7.5, 7]);
});

void test('fit candidates include conservative table-pagination fallbacks', () => {
	assert.deepEqual(ITEM_CARD_FIT_CAPACITY_SCALES, [
		1,
		0.88,
		0.76,
		0.66,
		0.55,
		0.45,
		0.35,
		0.25,
	]);
});

void test('prefers artwork when its page penalty is reasonable', () => {
	const withArtwork = { bodyFontPoints: 8, pageCount: 5, value: 'art' };
	const withoutArtwork = { bodyFontPoints: 8.5, pageCount: 4, value: 'plain' };
	assert.deepEqual(chooseArtworkPriorityFit(withArtwork, withoutArtwork), {
		...withArtwork,
		showArtwork: true,
	});
	assert.deepEqual(chooseArtworkPriorityFit(
		{ ...withArtwork, pageCount: 6 },
		withoutArtwork,
	), {
		...withoutArtwork,
		showArtwork: false,
	});
});

void test('measurement keys reuse identical pages but distinguish render inputs', () => {
	const page = {
		item: createItem(),
		pageIndex: 0,
		pageCount: 1,
		kind: 'primary' as const,
		title: 'Test Item',
		blocks: [{ type: 'paragraph' as const, markdown: 'A short rules paragraph.' }],
		layout: 'image' as const,
		bodyFontPoints: 9,
		artworkSharePercent: 20,
		showArtwork: true,
		showStats: false,
		showSource: true,
		hasUnsplitOverflow: false,
	};
	const artworkFingerprint = 'images/test-item.webp\u00001723\u00004567';
	const key = createItemCardPageMeasurementKey(page, artworkFingerprint);
	assert.equal(
		createItemCardPageMeasurementKey(structuredClone(page), artworkFingerprint),
		key,
	);
	assert.notEqual(
		createItemCardPageMeasurementKey(page, 'images/test-item.webp\u00001724\u00004567'),
		key,
	);
	assert.notEqual(createItemCardPageMeasurementKey({ ...page, bodyFontPoints: 8.5 }, artworkFingerprint), key);
	assert.notEqual(createItemCardPageMeasurementKey({ ...page, artworkSharePercent: 16 }, artworkFingerprint), key);
	assert.notEqual(createItemCardPageMeasurementKey({
		...page,
		blocks: [{ type: 'paragraph', markdown: 'Changed rendered rules.' }],
	}, artworkFingerprint), key);

	const itemChanges: Partial<ItemCardData>[] = [
		{ name: 'Renamed Item' },
		{ detail: 'Weapon, legendary' },
		{ sourceText: 'A different source line' },
		{ rarity: 'legendary' },
		{ attunement: true },
		{ source: 'phb' },
		{ damage: '1d8 slashing' },
		{ damageTwoHanded: '1d10 slashing' },
		{ range: '20/60' },
		{ properties: ['Thrown', 'Versatile'] },
		{ mastery: 'Topple' },
		{ cost: '50 GP' },
		{ weight: 4 },
	];
	for (const change of itemChanges) {
		assert.notEqual(
			createItemCardPageMeasurementKey({
				...page,
				item: { ...page.item, ...change },
			}, artworkFingerprint),
			key,
			JSON.stringify(change),
		);
	}

	const parsed = JSON.parse(key) as {
		renderRevision: string;
		physicalProfile: typeof PHYSICAL_CARD_PROFILE;
	};
	assert.equal(parsed.renderRevision, ITEM_CARD_MEASUREMENT_RENDER_REVISION);
	assert.deepEqual(parsed.physicalProfile, PHYSICAL_CARD_PROFILE);
});
