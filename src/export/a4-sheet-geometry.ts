import { PHYSICAL_CARD_PROFILE } from '../models/physical-card-profile';

export interface SheetSlot {
	index: number;
	row: number;
	column: number;
	xMm: number;
	yMm: number;
	widthMm: number;
	heightMm: number;
}

export interface CropMarkSegment {
	x1Mm: number;
	y1Mm: number;
	x2Mm: number;
	y2Mm: number;
}

export const A4_LANDSCAPE_WIDTH_MM = 297;
export const A4_LANDSCAPE_HEIGHT_MM = 210;
export const A4_CARD_COLUMNS = 4;
export const A4_CARD_ROWS = 2;
export const A4_CARDS_PER_SHEET = A4_CARD_COLUMNS * A4_CARD_ROWS;
export const A4_CARD_GAP_MM = 3;
export const A4_MARGIN_X_MM = roundMm((
	A4_LANDSCAPE_WIDTH_MM
	- A4_CARD_COLUMNS * PHYSICAL_CARD_PROFILE.widthMm
	- (A4_CARD_COLUMNS - 1) * A4_CARD_GAP_MM
) / 2);
export const A4_MARGIN_Y_MM = roundMm((
	A4_LANDSCAPE_HEIGHT_MM
	- A4_CARD_ROWS * PHYSICAL_CARD_PROFILE.heightMm
	- (A4_CARD_ROWS - 1) * A4_CARD_GAP_MM
) / 2);

const CROP_MARK_OFFSET_MM = 0.4;
const CROP_MARK_LENGTH_MM = 0.8;

export const A4_CARD_SLOTS: readonly SheetSlot[] = Object.freeze(
	Array.from({ length: A4_CARDS_PER_SHEET }, (_, index) => {
		const row = Math.floor(index / A4_CARD_COLUMNS);
		const column = index % A4_CARD_COLUMNS;
		return Object.freeze({
			index,
			row,
			column,
			xMm: roundMm(A4_MARGIN_X_MM
				+ column * (PHYSICAL_CARD_PROFILE.widthMm + A4_CARD_GAP_MM)),
			yMm: roundMm(A4_MARGIN_Y_MM
				+ row * (PHYSICAL_CARD_PROFILE.heightMm + A4_CARD_GAP_MM)),
			widthMm: PHYSICAL_CARD_PROFILE.widthMm,
			heightMm: PHYSICAL_CARD_PROFILE.heightMm,
		});
	}),
);

export function mmToPoints(millimeters: number): number {
	return millimeters * 72 / 25.4;
}

export function paginatePhysicalCards<T>(cards: readonly T[]): T[][] {
	const sheets: T[][] = [];
	for (let index = 0; index < cards.length; index += A4_CARDS_PER_SHEET) {
		sheets.push(cards.slice(index, index + A4_CARDS_PER_SHEET));
	}
	return sheets;
}

export function createCropMarkSegments(
	slots: readonly SheetSlot[] = A4_CARD_SLOTS,
): CropMarkSegment[] {
	const segments: CropMarkSegment[] = [];
	for (const slot of slots) {
		const left = slot.xMm;
		const right = slot.xMm + slot.widthMm;
		const top = slot.yMm;
		const bottom = slot.yMm + slot.heightMm;
		appendCornerMarks(segments, left, top, -1, -1);
		appendCornerMarks(segments, right, top, 1, -1);
		appendCornerMarks(segments, left, bottom, -1, 1);
		appendCornerMarks(segments, right, bottom, 1, 1);
	}
	return deduplicateSegments(segments);
}

function appendCornerMarks(
	segments: CropMarkSegment[],
	xMm: number,
	yMm: number,
	xDirection: -1 | 1,
	yDirection: -1 | 1,
): void {
	segments.push({
		x1Mm: roundMm(xMm + xDirection * CROP_MARK_OFFSET_MM),
		y1Mm: yMm,
		x2Mm: roundMm(xMm + xDirection * (CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM)),
		y2Mm: yMm,
	});
	segments.push({
		x1Mm: xMm,
		y1Mm: roundMm(yMm + yDirection * CROP_MARK_OFFSET_MM),
		x2Mm: xMm,
		y2Mm: roundMm(yMm + yDirection * (CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM)),
	});
}

function deduplicateSegments(segments: CropMarkSegment[]): CropMarkSegment[] {
	const seen = new Set<string>();
	return segments.filter((segment) => {
		const key = [segment.x1Mm, segment.y1Mm, segment.x2Mm, segment.y2Mm].join(':');
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function roundMm(value: number): number {
	return Math.round(value * 1000) / 1000;
}
