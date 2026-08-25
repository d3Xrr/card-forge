import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
	areCardDesignProfilesEqual,
	CARD_ARTWORK_SIZES,
	CARD_DENSITIES,
	CARD_DESIGN_FIELDS,
	CARD_THEMES,
	cloneCardDesignProfile,
	createLayoutDesignFingerprint,
	createVisualDesignFingerprint,
	LEGACY_CARD_DESIGN_PROFILE,
	normalizeCardDesignProfile,
	type CardDesignField,
	type CardDesignProfile,
	type CardFieldVisibility,
} from '../src/models/card-design';
import type { ItemCardData } from '../src/models/item';
import { PHYSICAL_CARD_PROFILE } from '../src/models/physical-card-profile';
import { getItemCardLayoutProfile } from '../src/renderer/item-card-layout';
import {
	flattenPageContent,
	planItemCardPages,
	resolveArtworkSharePercent,
} from '../src/renderer/item-card-planner';
import { serializeItemCardPlanSignature } from '../src/renderer/item-card-plan-signature';
import { parseSemanticMarkdown, serializeSemanticMarkdown } from '../src/renderer/semantic-markdown';
import { buildItemStatRows } from '../src/renderer/structured-item-stats';
import { createSavedPrintSetQueueFingerprint } from '../src/services/saved-print-set-session';

const FIELD_STATE_COUNT = 3 ** CARD_DESIGN_FIELDS.length;
const PURE_PROFILE_COUNT = CARD_THEMES.length
	* CARD_ARTWORK_SIZES.length
	* CARD_DENSITIES.length
	* FIELD_STATE_COUNT;
const PLANNER_FIELD_MASK_COUNT = 18;
const PLANNER_PROFILE_COUNT = CARD_THEMES.length
	* CARD_ARTWORK_SIZES.length
	* CARD_DENSITIES.length
	* PLANNER_FIELD_MASK_COUNT;
const MATRIX_SEED = 0x5eed_0700;

void test('exhaustively normalizes, serializes, fingerprints, and snapshots bounded profiles', () => {
	const startedAt = performance.now();
	let profilesTested = 0;
	for (const theme of CARD_THEMES) {
		for (const artworkSize of CARD_ARTWORK_SIZES) {
			for (const density of CARD_DENSITIES) {
				for (let fieldState = 0; fieldState < FIELD_STATE_COUNT; fieldState += 1) {
					const profile = normalizeCardDesignProfile({
						theme,
						artworkSize,
						density,
						fieldVisibility: createTernaryFieldVisibility(fieldState),
					});
					const serialized = JSON.parse(JSON.stringify(profile)) as unknown;
					const roundTripped = normalizeCardDesignProfile(serialized);
					if (!areCardDesignProfilesEqual(profile, roundTripped)) {
						throw new Error(`Design serialization changed profile ${profilesTested}.`);
					}
					if (!areCardDesignProfilesEqual(profile, cloneCardDesignProfile(profile))) {
						throw new Error(`Design clone changed profile ${profilesTested}.`);
					}
					const layoutFingerprint = createLayoutDesignFingerprint(profile);
					const visualFingerprint = createVisualDesignFingerprint(profile);
					if (!layoutFingerprint || !visualFingerprint) {
						throw new Error(`Design fingerprint was empty for profile ${profilesTested}.`);
					}
					const snapshot = [{
						filePath: 'fixtures/matrix.md',
						quantity: 1,
						design: profile,
					}];
					if (createSavedPrintSetQueueFingerprint(snapshot)
						!== createSavedPrintSetQueueFingerprint(structuredClone(snapshot))) {
						throw new Error(`Saved Set snapshot changed profile ${profilesTested}.`);
					}
					profilesTested += 1;
				}
			}
		}
	}
	assert.equal(profilesTested, PURE_PROFILE_COUNT);
	assert.equal(
		createSavedPrintSetQueueFingerprint([{
			filePath: 'fixtures/legacy.md', quantity: 1,
		}]),
		createSavedPrintSetQueueFingerprint([{
			filePath: 'fixtures/legacy.md',
			quantity: 1,
			design: LEGACY_CARD_DESIGN_PROFILE,
		}]),
	);
	process.stdout.write(`${JSON.stringify({
		matrix: 'pure-design',
		profilesTested,
		runtimeMs: Math.round(performance.now() - startedAt),
	})}\n`);
});

void test('runs a deterministic planner matrix across ten fixture classes', () => {
	const startedAt = performance.now();
	const fixtures = createPlannerFixtures();
	const fieldMasks = createPlannerFieldMasks();
	let profilesTested = 0;
	let plansGenerated = 0;
	let maximumPages = 0;
	let largerArtworkOmissions = 0;
	for (const artworkSize of CARD_ARTWORK_SIZES) {
		for (const density of CARD_DENSITIES) {
			for (const fieldVisibility of fieldMasks) {
				const designs = CARD_THEMES.map((theme) => normalizeCardDesignProfile({
					theme,
					artworkSize,
					density,
					fieldVisibility,
				}));
				assert.equal(
					new Set(designs.map(createLayoutDesignFingerprint)).size,
					1,
				);
				assert.equal(
					new Set(designs.map(createVisualDesignFingerprint)).size,
					CARD_THEMES.length,
				);
				profilesTested += designs.length;

				for (const fixture of fixtures) {
					const plans = designs.map((design) => planItemCardPages(fixture.item, {
						design,
						...(fixture.artworkOrientation
							? { artworkOrientation: fixture.artworkOrientation }
							: {}),
					}));
					plansGenerated += plans.length;
					const signatures = plans.map(serializeItemCardPlanSignature);
					assert.equal(new Set(signatures).size, 1, fixture.kind);
					for (const [index, plan] of plans.entries()) {
						const design = designs[index]!;
						assertPlanInvariants(fixture, plan, design);
						maximumPages = Math.max(maximumPages, plan.length);
						if (
							design.artworkSize === 'larger'
							&& fixture.item.hasImage
							&& !plan.some((page) => page.showArtwork)
						) {
							largerArtworkOmissions += 1;
						}
					}
				}
			}
		}
	}
	assert.equal(fieldMasks.length, PLANNER_FIELD_MASK_COUNT);
	assert.equal(profilesTested, PLANNER_PROFILE_COUNT);
	assert.equal(plansGenerated, PLANNER_PROFILE_COUNT * fixtures.length);
	assert.equal(largerArtworkOmissions, 0);
	process.stdout.write(`${JSON.stringify({
		matrix: 'planner-design',
		seed: `0x${MATRIX_SEED.toString(16)}`,
		profilesTested,
		fixtureClasses: fixtures.length,
		plansGenerated,
		maximumPages,
		largerArtworkOmissions,
		runtimeMs: Math.round(performance.now() - startedAt),
	})}\n`);
});

interface PlannerFixture {
	kind: string;
	item: ItemCardData;
	artworkOrientation?: 'portrait' | 'landscape' | 'square';
	minimumManualPages?: number;
	expectsCrafting?: boolean;
}

function createPlannerFixtures(): PlannerFixture[] {
	const item = (
		kind: string,
		overrides: Partial<ItemCardData>,
		extra: Omit<PlannerFixture, 'kind' | 'item'> = {},
	): PlannerFixture => ({
		kind,
		item: {
			filePath: `fixtures/${kind}.md`,
			name: kind,
			description: 'A bounded fixture rule.',
			hasImage: false,
			rawTags: [],
			source: 'TEST',
			...overrides,
		},
		...extra,
	});
	const paragraphs = (count: number, prefix = 'Rule'): string => Array.from(
		{ length: count },
		(_, index) => `${prefix} ${index + 1} describes a deterministic bounded effect with a clear condition.`,
	).join('\n\n');
	return [
		item('short-no-art', {}),
		item('short-portrait-art', { hasImage: true, imagePath: 'fixtures/portrait.png' }, {
			artworkOrientation: 'portrait',
		}),
		item('landscape-art', {
			hasImage: true,
			imagePath: 'fixtures/landscape.png',
			description: paragraphs(6),
		}, { artworkOrientation: 'landscape' }),
		item('long-rules', { description: paragraphs(24) }),
		item('multi-page', { description: paragraphs(42) }),
		item('structured-weapon', {
			hasImage: true,
			imagePath: 'fixtures/weapon.png',
			damage: '1d8 slashing',
			damageTwoHanded: '1d10 slashing',
			properties: ['Versatile'],
			mastery: 'Topple',
			range: '20/60',
			weight: 4,
			cost: '10 gp',
		}, { artworkOrientation: 'landscape' }),
		item('long-structured-weapon', {
			hasImage: true,
			imagePath: 'fixtures/long-weapon.png',
			description: paragraphs(22),
			damage: '1d6 piercing',
			properties: ['Finesse', 'Light'],
			mastery: 'Nick',
			range: '20/60',
			weight: 3,
			cost: '25 gp',
		}, { artworkOrientation: 'portrait' }),
		item('crafting-item', {
			hasImage: true,
			imagePath: 'fixtures/crafting.png',
			description: `${paragraphs(12)}\n\n## Crafting\n\n${paragraphs(20, 'Component')}`,
		}, { artworkOrientation: 'portrait', expectsCrafting: true }),
		item('table-heavy', {
			description: [
				'| Result | Effect |',
				'| --- | --- |',
				...Array.from(
					{ length: 18 },
					(_, index) => `| ${index + 1} | Deterministic effect ${index + 1}. |`,
				),
			].join('\n'),
		}),
		item('manual-break', {
			description: 'First rule.\n\nSecond rule.\n\nThird rule.',
			manualRuleSegments: ['First rule.', 'Second rule.', 'Third rule.'],
		}, { minimumManualPages: 3 }),
	];
}

function createTernaryFieldVisibility(value: number): CardFieldVisibility | undefined {
	const visibility: CardFieldVisibility = {};
	let remaining = value;
	for (const field of CARD_DESIGN_FIELDS) {
		const state = remaining % 3;
		remaining = Math.floor(remaining / 3);
		if (state === 1) {
			visibility[field] = false;
		} else if (state === 2) {
			visibility[field] = true;
		}
	}
	return Object.keys(visibility).length > 0 ? visibility : undefined;
}

function createPlannerFieldMasks(): CardFieldVisibility[] {
	const masks: CardFieldVisibility[] = [
		{},
		Object.fromEntries(CARD_DESIGN_FIELDS.map((field) => [field, true])),
		Object.fromEntries(CARD_DESIGN_FIELDS.map((field) => [field, false])),
		{ damage: true },
		{ damage: true, properties: true },
		{ damage: true, weight: true },
		{ properties: true, mastery: true },
		{ range: true, weight: true },
		{ cost: true },
		{ source: false },
		Object.fromEntries(CARD_DESIGN_FIELDS.map((field, index) => [field, index % 2 === 0])),
		Object.fromEntries(CARD_DESIGN_FIELDS.map((field, index) => [field, index % 2 !== 0])),
	];
	let state = MATRIX_SEED;
	while (masks.length < PLANNER_FIELD_MASK_COUNT) {
		state = xorshift32(state);
		const mask: CardFieldVisibility = {};
		for (const [index, field] of CARD_DESIGN_FIELDS.entries()) {
			mask[field] = ((state >>> index) & 1) === 1;
		}
		if (!masks.some((existing) => JSON.stringify(existing) === JSON.stringify(mask))) {
			masks.push(mask);
		}
	}
	return masks;
}

function assertPlanInvariants(
	fixture: PlannerFixture,
	plan: ReturnType<typeof planItemCardPages>,
	design: CardDesignProfile,
): void {
	assert.ok(plan.length >= 1, fixture.kind);
	assert.equal(PHYSICAL_CARD_PROFILE.widthPx, 750);
	assert.equal(PHYSICAL_CARD_PROFILE.heightPx, 1050);
	assert.ok(plan.every((page) => page.item.filePath === fixture.item.filePath));
	assert.ok(plan.every((page, index) =>
		page.pageIndex === index && page.pageCount === plan.length));
	assert.ok(plan.every((page) => !page.hasUnsplitOverflow), fixture.kind);
	assert.ok(plan.every((page) => (page.bodyFontPoints ?? 0) >= 7));
	assert.ok(plan.slice(1).every((page) => page.kind !== 'primary'));
	if (fixture.kind === 'table-heavy') {
		const expectedRows = parseSemanticMarkdown(fixture.item.description).flatMap((block) =>
			block.type === 'table' ? block.rows : []);
		const plannedRows = plan.flatMap((page) => page.blocks).flatMap((block) =>
			block.type === 'table' ? block.rows : []);
		assert.deepEqual(plannedRows, expectedRows, fixture.kind);
	} else {
		assert.equal(
			normalizeWhitespace(flattenPageContent(plan)),
			normalizeWhitespace(
				serializeSemanticMarkdown(parseSemanticMarkdown(fixture.item.description)),
			),
			fixture.kind,
		);
	}
	if (design.density === 'standard') {
		assert.ok(plan.every((page) => page.resolvedDensity === 'standard'));
	} else if (design.density === 'compact') {
		assert.ok(plan.every((page) => page.resolvedDensity === 'compact'));
		assert.ok(plan.every((page) => (page.bodyFontPoints ?? 0) <= 9));
	} else {
		assert.ok(plan.every((page) =>
			page.resolvedDensity === 'standard' || page.resolvedDensity === 'compact'));
	}
	if (design.artworkSize === 'hidden') {
		assert.ok(plan.every((page) => !page.showArtwork));
	}
	if (fixture.minimumManualPages) {
		assert.ok(plan.length >= fixture.minimumManualPages);
	}
	if (fixture.expectsCrafting) {
		assert.ok(plan.some((page) => page.kind === 'crafting'));
	}
	const visibleRows = buildItemStatRows(fixture.item, design);
	assert.equal(new Set(visibleRows.map((row) => row.label)).size, visibleRows.length);
	assertVisibleFieldRows(visibleRows.map((row) => row.label), design.fieldVisibility);
	if (design.fieldVisibility?.source === false) {
		assert.ok(plan.every((page) => !page.showSource));
	}
	const primary = plan[0]!;
	if (primary.showArtwork) {
		const profile = getItemCardLayoutProfile(
			primary.layout,
			primary.bodyFontPoints,
			primary.statsPresentation === 'compact',
			primary.artworkSharePercent,
		);
		if (design.artworkSize === 'minimal') {
			const standard = getItemCardLayoutProfile(
				primary.layout,
				primary.bodyFontPoints,
				primary.statsPresentation === 'compact',
				resolveArtworkSharePercent(primary.layout, 'standard'),
			);
			assert.ok(profile.artworkSharePercent <= standard.artworkSharePercent);
		}
		if (design.artworkSize === 'larger') {
			const standard = getItemCardLayoutProfile(
				primary.layout,
				primary.bodyFontPoints,
				primary.statsPresentation === 'compact',
				resolveArtworkSharePercent(primary.layout, 'standard'),
			);
			assert.ok(profile.artworkSharePercent >= standard.artworkSharePercent);
		}
	}
}

function assertVisibleFieldRows(
	labels: readonly string[],
	visibility: Readonly<CardFieldVisibility> | undefined,
): void {
	const labelByField: Partial<Record<CardDesignField, string>> = {
		damage: 'Damage',
		damageTwoHanded: 'Damage',
		properties: 'Properties',
		mastery: 'Mastery',
		range: 'Range',
		weight: 'Weight',
		cost: 'Cost',
	};
	for (const field of CARD_DESIGN_FIELDS) {
		const label = labelByField[field];
		if (visibility?.[field] === false && label) {
			if (field === 'damage' && visibility.damageTwoHanded !== false) {
				continue;
			}
			if (field === 'damageTwoHanded' && visibility.damage !== false) {
				continue;
			}
			assert.equal(labels.includes(label), false, field);
		}
	}
}

function xorshift32(value: number): number {
	let next = value | 0;
	next ^= next << 13;
	next ^= next >>> 17;
	next ^= next << 5;
	return next >>> 0;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, ' ').trim();
}
