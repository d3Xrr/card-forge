import { PDFDocument, rgb, type PDFImage, type PDFPage } from 'pdf-lib';

import { PHYSICAL_CARD_PROFILE } from '../models/physical-card-profile';
import {
	A4_CARD_SLOTS,
	A4_LANDSCAPE_HEIGHT_MM,
	A4_LANDSCAPE_WIDTH_MM,
	createCropMarkSegments,
	mmToPoints,
	paginatePhysicalCards,
} from './a4-sheet-geometry';

export interface RasterizedPhysicalCard {
	cacheKey: string;
	pngBytes: Uint8Array;
}

export interface PdfAssemblyOptions {
	showCropMarks: boolean;
}

export async function assembleA4CardPdf(
	cards: readonly RasterizedPhysicalCard[],
	options: PdfAssemblyOptions,
): Promise<Uint8Array> {
	const document = await PDFDocument.create();
	document.setTitle('TTRPG Card Forge print sheets');
	document.setAuthor('D3Xr');
	document.setCreator('TTRPG Card Forge');
	document.setProducer('TTRPG Card Forge / pdf-lib');
	document.setSubject('Printable 63.5 × 88.9 mm TTRPG item cards');

	const embeddedImages = new Map<string, PDFImage>();
	for (const sheetCards of paginatePhysicalCards(cards)) {
		const page = document.addPage([
			mmToPoints(A4_LANDSCAPE_WIDTH_MM),
			mmToPoints(A4_LANDSCAPE_HEIGHT_MM),
		]);

		for (const [slotIndex, card] of sheetCards.entries()) {
			const slot = A4_CARD_SLOTS[slotIndex];
			if (!slot) {
				continue;
			}
			let image = embeddedImages.get(card.cacheKey);
			if (!image) {
				image = await document.embedPng(card.pngBytes);
				embeddedImages.set(card.cacheKey, image);
			}
			page.drawImage(image, {
				x: mmToPoints(slot.xMm),
				y: mmToPoints(A4_LANDSCAPE_HEIGHT_MM - slot.yMm - slot.heightMm),
				width: mmToPoints(PHYSICAL_CARD_PROFILE.widthMm),
				height: mmToPoints(PHYSICAL_CARD_PROFILE.heightMm),
			});
		}

		if (options.showCropMarks) {
			drawCropMarks(page, sheetCards.length);
		}
	}

	return document.save();
}

function drawCropMarks(page: PDFPage, occupiedSlotCount: number): void {
	for (const segment of createCropMarkSegments(
		A4_CARD_SLOTS.slice(0, occupiedSlotCount),
	)) {
		page.drawLine({
			start: {
				x: mmToPoints(segment.x1Mm),
				y: mmToPoints(A4_LANDSCAPE_HEIGHT_MM - segment.y1Mm),
			},
			end: {
				x: mmToPoints(segment.x2Mm),
				y: mmToPoints(A4_LANDSCAPE_HEIGHT_MM - segment.y2Mm),
			},
			thickness: 0.35,
			color: rgb(0.15, 0.15, 0.15),
			opacity: 0.85,
		});
	}
}
