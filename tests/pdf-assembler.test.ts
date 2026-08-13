import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import {
	A4_LANDSCAPE_HEIGHT_MM,
	A4_LANDSCAPE_WIDTH_MM,
	mmToPoints,
} from '../src/export/a4-sheet-geometry';
import { assembleA4CardPdf } from '../src/export/pdf-assembler';

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
