import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import {
	A4_LANDSCAPE_HEIGHT_MM,
	A4_LANDSCAPE_WIDTH_MM,
	mmToPoints,
} from '../src/export/a4-sheet-geometry';
import {
	assembleA4CardPdf,
	assembleA4DuplexCardPdf,
	getPdfCardPlacementMm,
} from '../src/export/pdf-assembler';

const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
);

void test('creates inspectable A4 landscape PDF pages from placeholder PNG cards', async () => {
	const cards = Array.from({ length: 9 }, (_, index) => ({
		cacheKey: `placeholder-${index % 2}`,
		pngBytes: new Uint8Array(ONE_PIXEL_PNG),
	}));
	const bytes = await assembleA4CardPdf(cards, { showCropMarks: true });
	const document = await PDFDocument.load(bytes);
	assert.equal(document.getPageCount(), 2);
	assert.equal(document.getTitle(), 'TTRPG Card Forge print sheets');
	for (const page of document.getPages()) {
		const { width, height } = page.getSize();
		assert.ok(Math.abs(width - mmToPoints(A4_LANDSCAPE_WIDTH_MM)) < 0.01);
		assert.ok(Math.abs(height - mmToPoints(A4_LANDSCAPE_HEIGHT_MM)) < 0.01);
		assert.ok(width > height);
	}
});

void test('assembles front/back sides with intentional blank back slots as valid A4 pages', async () => {
	const card = {
		cacheKey: 'placeholder',
		pngBytes: new Uint8Array(ONE_PIXEL_PNG),
	};
	const bytes = await assembleA4DuplexCardPdf([
		{ side: 'front', slots: [{ card }, { card }] },
		{ side: 'back', slots: [{ card }, {}] },
	], {
		showCropMarks: true,
		backOffsetXmm: 0.8,
		backOffsetYmm: -0.4,
	});
	const document = await PDFDocument.load(bytes);
	assert.equal(document.getPageCount(), 2);
	for (const page of document.getPages()) {
		assert.equal(page.getWidth(), mmToPoints(A4_LANDSCAPE_WIDTH_MM));
		assert.equal(page.getHeight(), mmToPoints(A4_LANDSCAPE_HEIGHT_MM));
	}
});

void test('back calibration moves only back image placement and never card dimensions', () => {
	const front = getPdfCardPlacementMm(0, 'front', 1.2, -0.7);
	const back = getPdfCardPlacementMm(0, 'back', 1.2, -0.7);
	assert.ok(Math.abs(back.xMm - front.xMm - 1.2) < 1e-9);
	assert.ok(Math.abs(back.yFromBottomMm - front.yFromBottomMm - 0.7) < 1e-9);
	assert.equal(back.widthMm, 63.5);
	assert.equal(back.heightMm, 88.9);
	assert.throws(() => getPdfCardPlacementMm(8, 'front', 0, 0), RangeError);
});
