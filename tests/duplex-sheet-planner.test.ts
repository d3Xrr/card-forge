import assert from 'node:assert/strict';
import test from 'node:test';

import { planPrintSheets, getDuplexBackSlotIndex } from '../src/export/duplex-sheet-planner';
import { createCardDesignProfile, normalizeCardDesignProfile } from '../src/models/card-design';
import type { ItemCardData } from '../src/models/item';
import type { ItemCardPage } from '../src/models/item-card-page';
import type { PhysicalQueueCard } from '../src/services/print-queue-planner';
import { normalizePrintExportSettings } from '../src/models/print-export-settings';

void test('no-backs retains canonical front sheets and fixed partial slots', () => {
	const sheets = planPrintSheets(createCards(10), normalizePrintExportSettings(undefined));
	assert.deepEqual(sheets.map((sheet) => [sheet.side, sheet.sourceSheetIndex]), [
		['front', 0], ['front', 1],
	]);
	assert.equal(sheets[0]?.slots.length, 8);
	assert.equal(sheets[1]?.slots.filter(Boolean).length, 2);
	assert.deepEqual(sheets[1]?.slots.slice(2), Array(6).fill(undefined));
});

void test('single, manual, and automatic modes have deterministic side ordering', () => {
	const cards = createCards(10);
	const base = {
		backMode: 'use-card-backs' as const,
		duplexOrientation: 'long-edge' as const,
		backOffsetXmm: 0,
		backOffsetYmm: 0,
	};
	assert.deepEqual(
		planPrintSheets(cards, { ...base, printMode: 'single-sided' }).map(sheetId),
		['front-0', 'front-1', 'back-0', 'back-1'],
	);
	const single = planPrintSheets(cards, { ...base, printMode: 'single-sided' });
	assert.equal(single[2]?.slots[0]?.card.itemName, 'Card 1');
	assert.deepEqual(
		planPrintSheets(cards, { ...base, printMode: 'manual-duplex' }).map(sheetId),
		['front-0', 'front-1', 'back-1', 'back-0'],
	);
	assert.deepEqual(
		planPrintSheets(cards, { ...base, printMode: 'automatic-duplex' }).map(sheetId),
		['front-0', 'back-0', 'front-1', 'back-1'],
	);
});

void test('landscape edge semantics mirror rows or columns without changing geometry', () => {
	assert.deepEqual(
		Array.from({ length: 8 }, (_, index) => getDuplexBackSlotIndex(index, 'long-edge')),
		[4, 5, 6, 7, 0, 1, 2, 3],
	);
	assert.deepEqual(
		Array.from({ length: 8 }, (_, index) => getDuplexBackSlotIndex(index, 'short-edge')),
		[3, 2, 1, 0, 7, 6, 5, 4],
	);
});

void test('None backs remain occupied alignment slots but are intentionally blank', () => {
	const cards = createCards(3);
	cards[1]!.design = normalizeCardDesignProfile({
		...cards[1]!.design,
		back: { style: 'none' },
	});
	const sheets = planPrintSheets(cards, normalizePrintExportSettings({
		printMode: 'automatic-duplex',
		backMode: 'use-card-backs',
		duplexOrientation: 'short-edge',
	}));
	const back = sheets[1];
	assert.equal(back?.side, 'back');
	assert.equal(back?.slots[2]?.card.itemName, 'Card 2');
	assert.equal(back?.slots[2]?.render, false);
	assert.equal(back?.slots[3]?.render, true);
});

function sheetId(sheet: { side: string; sourceSheetIndex: number }): string {
	return `${sheet.side}-${sheet.sourceSheetIndex}`;
}

function createCards(count: number): PhysicalQueueCard[] {
	return Array.from({ length: count }, (_, index) => {
		const item: ItemCardData = {
			filePath: `items/card-${index + 1}.md`,
			name: `Card ${index + 1}`,
			description: 'Rules.',
			hasImage: false,
			rawTags: [],
		};
		const page: ItemCardPage = {
			item,
			pageIndex: 0,
			pageCount: 1,
			kind: 'primary',
			title: item.name,
			blocks: [],
			layout: 'text',
			showArtwork: false,
			showStats: false,
			showSource: false,
			hasUnsplitOverflow: false,
		};
		return {
			queueEntryId: `entry-${index + 1}`,
			filePath: item.filePath,
			itemName: item.name,
			copyIndex: 0,
			pageIndex: 0,
			page,
			design: normalizeCardDesignProfile({
				...createCardDesignProfile(),
				back: { style: 'generic' },
			}),
		};
	});
}
