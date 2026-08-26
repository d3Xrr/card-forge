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

export interface RasterizedPrintSlot {
	/** Undefined means an intentional blank back for a physical front card. */
	card?: RasterizedPhysicalCard;
}

export interface RasterizedPrintSheet {
	side: 'front' | 'back';
	slots: readonly (RasterizedPrintSlot | undefined)[];
}

export interface DuplexPdfAssemblyOptions extends PdfAssemblyOptions {
	backOffsetXmm: number;
	backOffsetYmm: number;
}

export interface PdfCardPlacementMm {
	xMm: number;
	yFromBottomMm: number;
	widthMm: number;
	heightMm: number;
}

export async function assembleA4CardPdf(
	cards: readonly RasterizedPhysicalCard[],
	options: PdfAssemblyOptions,
): Promise<Uint8Array> {
	const sheets: RasterizedPrintSheet[] = paginatePhysicalCards(cards).map((sheetCards) => ({
		side: 'front',
		slots: sheetCards.map((card) => ({ card })),
	}));
	return assembleA4DuplexCardPdf(sheets, {
		...options,
		backOffsetXmm: 0,
		backOffsetYmm: 0,
	});
}

export async function assembleA4DuplexCardPdf(
	sheets: readonly RasterizedPrintSheet[],
	options: DuplexPdfAssemblyOptions,
): Promise<Uint8Array> {
	const document = await PDFDocument.create();
	document.setTitle('TTRPG Card Forge print sheets');
	document.setAuthor('D3Xr');
	document.setCreator('TTRPG Card Forge');
	document.setProducer('TTRPG Card Forge / pdf-lib');
	document.setSubject('Printable 63.5 × 88.9 mm TTRPG item cards');

	const embeddedImages = new Map<string, PDFImage>();
	for (const sheet of sheets) {
		const page = document.addPage([
			mmToPoints(A4_LANDSCAPE_WIDTH_MM),
			mmToPoints(A4_LANDSCAPE_HEIGHT_MM),
		]);

		for (const [slotIndex, plannedSlot] of sheet.slots.entries()) {
			const slot = A4_CARD_SLOTS[slotIndex];
			const card = plannedSlot?.card;
			if (!slot || !card) {
				continue;
			}
			let image = embeddedImages.get(card.cacheKey);
			if (!image) {
				image = await document.embedPng(card.pngBytes);
				embeddedImages.set(card.cacheKey, image);
			}
			const placement = getPdfCardPlacementMm(
				slotIndex,
				sheet.side,
				options.backOffsetXmm,
				options.backOffsetYmm,
			);
			page.drawImage(image, {
				x: mmToPoints(placement.xMm),
				y: mmToPoints(placement.yFromBottomMm),
				width: mmToPoints(placement.widthMm),
				height: mmToPoints(placement.heightMm),
			});
		}

		if (options.showCropMarks) {
			drawCropMarks(page, sheet.slots);
		}
	}

	return document.save();
}

export function getPdfCardPlacementMm(
	slotIndex: number,
	side: RasterizedPrintSheet['side'],
	backOffsetXmm: number,
	backOffsetYmm: number,
): PdfCardPlacementMm {
	const slot = A4_CARD_SLOTS[slotIndex];
	if (!slot) {
		throw new RangeError(`A4 card slot ${slotIndex} is outside the canonical grid.`);
	}
	return {
		xMm: slot.xMm + (side === 'back' ? backOffsetXmm : 0),
		yFromBottomMm: A4_LANDSCAPE_HEIGHT_MM
			- slot.yMm
			- slot.heightMm
			- (side === 'back' ? backOffsetYmm : 0),
		widthMm: PHYSICAL_CARD_PROFILE.widthMm,
		heightMm: PHYSICAL_CARD_PROFILE.heightMm,
	};
}

function drawCropMarks(
	page: PDFPage,
	slots: readonly (RasterizedPrintSlot | undefined)[],
): void {
	for (const segment of createCropMarkSegments(
		A4_CARD_SLOTS.filter((_, index) => slots[index] !== undefined),
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
