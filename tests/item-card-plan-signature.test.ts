import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import type { ItemCardPage } from '../src/models/item-card-page';
import {
	createFittedItemCardPlanSignature,
	createItemCardPlanSignature,
	ITEM_CARD_PLAN_SIGNATURE_VERSION,
	serializeFittedItemCardPlanSignature,
	serializeItemCardPlanSignature,
} from '../src/renderer/item-card-plan-signature';
import { planItemCardPages } from '../src/renderer/item-card-planner';
import {
	createPhysicalPlanCacheIdentity,
	PhysicalPlanCache,
} from '../src/services/physical-plan-cache';

void test('creates a deterministic, versioned signature without exposing rules text', () => {
	const pages = createSyntheticPlan();
	const first = createItemCardPlanSignature(pages);
	const cloned = createItemCardPlanSignature(structuredClone(pages));
	const serialized = serializeItemCardPlanSignature(pages);

	assert.deepEqual(cloned, first);
	assert.equal(first.version, ITEM_CARD_PLAN_SIGNATURE_VERSION);
	assert.deepEqual(first.physicalProfile, {
		widthMm: 63.5,
		heightMm: 88.9,
		widthPx: 750,
		heightPx: 1050,
		dpi: 300,
	});
	assert.equal(first.pageCount, 2);
	for (const privateText of [
		'Hidden operational rule',
		'Raise the shield',
		'Synthetic apparatus',
		'items/synthetic-apparatus.md',
	]) {
		assert.equal(serialized.includes(privateText), false);
	}
});

void test('distinguishes output-relevant page, item, and semantic content changes', () => {
	const baseline = createSyntheticPlan();
	const variants = [
		mutatePlan(baseline, (pages) => { pages[0]!.layout = 'compact'; }),
		mutatePlan(baseline, (pages) => { pages[0]!.bodyFontPoints = 8; }),
		mutatePlan(baseline, (pages) => { pages[0]!.artworkSharePercent = 16; }),
		mutatePlan(baseline, (pages) => { pages[0]!.showArtwork = false; }),
		mutatePlan(baseline, (pages) => { pages[0]!.showStats = false; }),
		mutatePlan(baseline, (pages) => { pages[0]!.statsPresentation = 'full'; }),
		mutatePlan(baseline, (pages) => { pages[1]!.showSource = false; }),
		mutatePlan(baseline, (pages) => { pages[0]!.artworkOrientation = 'square'; }),
		mutatePlan(baseline, (pages) => { pages[0]!.title = 'Renamed item'; }),
		mutatePlan(baseline, (pages) => { pages[0]!.item.detail = 'Different identity'; }),
		mutatePlan(baseline, (pages) => { pages[0]!.item.damage = '2d6 force'; }),
		mutatePlan(baseline, (pages) => {
			pages[0]!.item.sourceDisplayOverride = 'Literal source';
		}),
		mutatePlan(baseline, (pages) => {
			pages[0]!.blocks[0] = { type: 'paragraph', markdown: 'Different rule.' };
		}),
	];
	const baselineSignature = createItemCardPlanSignature(baseline);

	for (const variant of variants) {
		assert.notDeepEqual(createItemCardPlanSignature(variant), baselineSignature);
	}
});

void test('captures table headers, row order, duplication, and page fragmentation', () => {
	const baseline = createSyntheticPlan();
	const baselineSignature = createItemCardPlanSignature(baseline);
	const tableFragments = baselineSignature.pages.flatMap((page) =>
		page.blocks.filter((block) => block.type === 'table'),
	);

	assert.deepEqual(tableFragments.map((fragment) => fragment.rows.length), [2, 1]);
	assert.ok(tableFragments.every((fragment) => fragment.headers.length === 2));

	const reordered = mutatePlan(baseline, (pages) => {
		const table = getTable(pages[0]!);
		table.rows = [table.rows[1]!, table.rows[0]!];
	});
	const refragmented = mutatePlan(baseline, (pages) => {
		const firstTable = getTable(pages[0]!);
		const secondTable = getTable(pages[1]!);
		secondTable.rows.unshift(firstTable.rows.pop()!);
	});
	const duplicated = mutatePlan(baseline, (pages) => {
		const table = getTable(pages[1]!);
		table.rows.push([...table.rows[0]!]);
	});
	const changedHeader = mutatePlan(baseline, (pages) => {
		getTable(pages[1]!).headers[1] = 'Alternate effect';
	});

	for (const changed of [reordered, refragmented, duplicated, changedHeader]) {
		assert.notDeepEqual(createItemCardPlanSignature(changed), baselineSignature);
	}
});

void test('final cache retains the full fitted reference signature and exportability', async () => {
	const item = createItem({
		name: 'Synthetic cache benchmark',
		description: [
			'A short effect introduces the controls.',
			'',
			'- First safe option',
			'- Second safe option',
			'',
			'| Control | Result |',
			'| --- | --- |',
			'| One | Opens the upper panel |',
			'| Two | Closes the upper panel |',
		].join('\n'),
	});
	const reference = planItemCardPages(item, {
		artworkOrientation: 'landscape',
		bodyFontPoints: 9,
		capacityScale: 0.88,
	});
	const referenceFit = {
		pages: reference,
		capacityScale: 0.88,
		bodyFontPoints: 9,
		unfitPageIndexes: new Set<number>(),
		artworkResult: { status: 'ready', orientation: 'landscape' },
	};
	const cache = new PhysicalPlanCache<typeof referenceFit>();
	const identity = createPhysicalPlanCacheIdentity({
		item,
		sourceFingerprint: 'synthetic-source-v1',
		renderSettingsFingerprint: 'card-render-settings-v1',
	});
	let plannerCalls = 0;
	const optimizedPlan = await cache.getOrCreate(identity, () => {
		plannerCalls += 1;
		return {
			...referenceFit,
			pages: planItemCardPages(item, {
				artworkOrientation: 'landscape',
				bodyFontPoints: 9,
				capacityScale: 0.88,
			}),
		};
	});

	assert.equal(
		serializeFittedItemCardPlanSignature(optimizedPlan),
		serializeFittedItemCardPlanSignature(referenceFit),
	);
	assert.strictEqual(await cache.getOrCreate(identity, () => referenceFit), optimizedPlan);
	assert.equal(plannerCalls, 1);
	assert.equal(createFittedItemCardPlanSignature(referenceFit).exportable, true);
	assert.notDeepEqual(
		createFittedItemCardPlanSignature({
			...referenceFit,
			unfitPageIndexes: new Set([1]),
		}),
		createFittedItemCardPlanSignature(referenceFit),
	);
});

function createSyntheticPlan(): ItemCardPage[] {
	const item = createItem();
	return [
		{
			item,
			pageIndex: 0,
			pageCount: 2,
			kind: 'primary',
			title: item.name,
			blocks: [
				{ type: 'paragraph', markdown: 'Hidden operational rule.' },
				{ type: 'unordered-list', items: ['Raise the shield', 'Lower the shield'] },
				{
					type: 'table',
					headers: ['Control', 'Effect'],
					rows: [
						['One', 'Open the hatch'],
						['Two', 'Close the hatch'],
					],
				},
			],
			layout: 'image',
			bodyFontPoints: 9,
			artworkSharePercent: 20,
			showArtwork: true,
			showStats: true,
			statsPresentation: 'compact',
			showSource: false,
			artworkOrientation: 'landscape',
			hasUnsplitOverflow: false,
		},
		{
			item,
			pageIndex: 1,
			pageCount: 2,
			kind: 'continuation',
			title: item.name,
			blocks: [{
				type: 'table',
				headers: ['Control', 'Effect'],
				rows: [['Three', 'Lock the controls']],
			}],
			layout: 'text',
			bodyFontPoints: 9,
			showArtwork: false,
			showStats: false,
			showSource: true,
			hasUnsplitOverflow: false,
		},
	];
}

function createItem(overrides: Partial<ItemCardData> = {}): ItemCardData {
	return {
		filePath: 'items/synthetic-apparatus.md',
		name: 'Synthetic apparatus',
		description: 'Hidden operational rule.',
		detail: 'Wondrous mechanism, rare',
		imagePath: 'items/img/synthetic-apparatus.webp',
		sourceText: 'Synthetic reference p. 12',
		hasImage: true,
		rarity: 'rare',
		attunement: true,
		source: 'synthetic-reference',
		damage: '1d8 force',
		damageTwoHanded: '1d10 force',
		range: '20/60',
		properties: ['Heavy', 'Mechanical'],
		mastery: 'Control',
		cost: '100 gp',
		weight: 50,
		rawTags: ['synthetic/item'],
		...overrides,
	};
}

function mutatePlan(
	plan: readonly ItemCardPage[],
	mutate: (pages: ItemCardPage[]) => void,
): ItemCardPage[] {
	const clone: ItemCardPage[] = structuredClone([...plan]);
	mutate(clone);
	return clone;
}

function getTable(
	page: ItemCardPage,
): Extract<ItemCardPage['blocks'][number], { type: 'table' }> {
	const table = page.blocks.find((block) => block.type === 'table');
	assert.ok(table?.type === 'table');
	return table;
}
