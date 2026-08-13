import assert from 'node:assert/strict';
import test from 'node:test';

import {
	A4_CARD_COLUMNS,
	A4_CARD_GAP_MM,
	A4_CARD_ROWS,
	A4_CARD_SLOTS,
	A4_CARDS_PER_SHEET,
	A4_LANDSCAPE_HEIGHT_MM,
	A4_LANDSCAPE_WIDTH_MM,
	A4_MARGIN_X_MM,
	A4_MARGIN_Y_MM,
	createCropMarkSegments,
	mmToPoints,
	paginatePhysicalCards,
} from '../src/export/a4-sheet-geometry';
import { PHYSICAL_CARD_PROFILE } from '../src/models/physical-card-profile';

void test('defines the exact A4 landscape four-by-two physical card grid', () => {
	assert.equal(A4_LANDSCAPE_WIDTH_MM, 297);
	assert.equal(A4_LANDSCAPE_HEIGHT_MM, 210);
	assert.equal(A4_CARD_COLUMNS, 4);
	assert.equal(A4_CARD_ROWS, 2);
	assert.equal(A4_CARDS_PER_SHEET, 8);
	assert.equal(A4_CARD_GAP_MM, 3);
	assert.equal(A4_MARGIN_X_MM, 17);
	assert.equal(A4_MARGIN_Y_MM, 14.6);
	assert.equal(A4_CARD_SLOTS.length, 8);
});

void test('keeps exact non-overlapping cards inside A4 in row-major order', () => {
	for (const [index, slot] of A4_CARD_SLOTS.entries()) {
		assert.equal(slot.index, index);
		assert.equal(slot.row, Math.floor(index / 4));
		assert.equal(slot.column, index % 4);
		assert.equal(slot.widthMm, PHYSICAL_CARD_PROFILE.widthMm);
		assert.equal(slot.heightMm, PHYSICAL_CARD_PROFILE.heightMm);
		assert.ok(slot.xMm >= 0 && slot.yMm >= 0);
		assert.ok(slot.xMm + slot.widthMm <= A4_LANDSCAPE_WIDTH_MM);
		assert.ok(slot.yMm + slot.heightMm <= A4_LANDSCAPE_HEIGHT_MM);
	}
	for (let left = 0; left < A4_CARD_SLOTS.length; left += 1) {
		for (let right = left + 1; right < A4_CARD_SLOTS.length; right += 1) {
			assert.equal(overlaps(A4_CARD_SLOTS[left]!, A4_CARD_SLOTS[right]!), false);
		}
	}
});

void test('uses the same fixed slot positions for a partial final sheet', () => {
	const sheets = paginatePhysicalCards(Array.from({ length: 9 }, (_, index) => index));
	assert.deepEqual(sheets.map((sheet) => sheet.length), [8, 1]);
	assert.equal(A4_CARD_SLOTS[0]?.xMm, 17);
	assert.equal(A4_CARD_SLOTS[0]?.yMm, 14.6);
});

void test('paginates physical card counts at eight per sheet', () => {
	const cases: Array<[number, number]> = [
		[0, 0],
		[1, 1],
		[8, 1],
		[9, 2],
		[16, 2],
		[17, 3],
	];
	for (const [cards, pages] of cases) {
		assert.equal(paginatePhysicalCards(Array.from({ length: cards }, () => null)).length, pages);
	}
});

void test('converts millimeters to PDF points and keeps crop marks outside card interiors', () => {
	assert.ok(Math.abs(mmToPoints(25.4) - 72) < 1e-10);
	const segments = createCropMarkSegments();
	assert.ok(segments.length > 0);
	for (const segment of segments) {
		assert.ok(segment.x1Mm >= 0 && segment.x1Mm <= A4_LANDSCAPE_WIDTH_MM);
		assert.ok(segment.x2Mm >= 0 && segment.x2Mm <= A4_LANDSCAPE_WIDTH_MM);
		assert.ok(segment.y1Mm >= 0 && segment.y1Mm <= A4_LANDSCAPE_HEIGHT_MM);
		assert.ok(segment.y2Mm >= 0 && segment.y2Mm <= A4_LANDSCAPE_HEIGHT_MM);
	}
	assert.equal(createCropMarkSegments(A4_CARD_SLOTS.slice(0, 1)).length, 8);
});

function overlaps(
	left: (typeof A4_CARD_SLOTS)[number],
	right: (typeof A4_CARD_SLOTS)[number],
): boolean {
	return left.xMm < right.xMm + right.widthMm
		&& left.xMm + left.widthMm > right.xMm
		&& left.yMm < right.yMm + right.heightMm
		&& left.yMm + left.heightMm > right.yMm;
}
