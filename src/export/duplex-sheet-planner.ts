import { normalizeCardDesignProfile } from '../models/card-design';
import type { PrintExportSettings } from '../models/print-export-settings';
import { normalizePrintExportSettings } from '../models/print-export-settings';
import type { PhysicalQueueCard } from '../services/print-queue-planner';
import { A4_CARDS_PER_SHEET } from './a4-sheet-geometry';

export type PrintSheetSide = 'front' | 'back';

export interface PlannedPrintSlot {
	card: PhysicalQueueCard;
	sourceSlotIndex: number;
	/** False keeps a duplex alignment/cut position but intentionally draws no back. */
	render: boolean;
}

export interface PlannedPrintSheet {
	side: PrintSheetSide;
	/** Zero-based front-sheet identity retained when manual backs reverse page order. */
	sourceSheetIndex: number;
	slots: readonly (PlannedPrintSlot | undefined)[];
}

/**
 * Converts completed physical front pages into deterministic A4 sides.
 *
 * Landscape long-edge duplex mirrors rows; short-edge duplex mirrors columns.
 * Automatic duplex interleaves each front and back. Manual duplex emits every
 * front first, then back sheets in reverse sheet order for a two-pass re-feed.
 * Single-sided keeps backs in forward order as separate printable sheets.
 */
export function planPrintSheets(
	cards: readonly PhysicalQueueCard[],
	settingsInput: Readonly<PrintExportSettings>,
): PlannedPrintSheet[] {
	const settings = normalizePrintExportSettings(settingsInput);
	const frontSheets = chunkCards(cards).map((slots, sourceSheetIndex) => ({
		side: 'front' as const,
		sourceSheetIndex,
		slots,
	}));
	if (settings.backMode === 'no-backs') {
		return frontSheets;
	}

	const backSheets = frontSheets.map((front) => ({
		side: 'back' as const,
		sourceSheetIndex: front.sourceSheetIndex,
		slots: createBackSlots(
			front.slots,
			settings.duplexOrientation,
			settings.printMode !== 'single-sided',
		),
	}));
	if (settings.printMode === 'automatic-duplex') {
		return frontSheets.flatMap((front, index) => [front, backSheets[index]!]);
	}
	if (settings.printMode === 'manual-duplex') {
		return [...frontSheets, ...[...backSheets].reverse()];
	}
	return [...frontSheets, ...backSheets];
}

export function getDuplexBackSlotIndex(
	frontSlotIndex: number,
	orientation: PrintExportSettings['duplexOrientation'],
): number {
	const row = Math.floor(frontSlotIndex / 4);
	const column = frontSlotIndex % 4;
	return orientation === 'long-edge'
		? (1 - row) * 4 + column
		: row * 4 + (3 - column);
}

function chunkCards(
	cards: readonly PhysicalQueueCard[],
): (PlannedPrintSlot | undefined)[][] {
	const sheets: (PlannedPrintSlot | undefined)[][] = [];
	for (let start = 0; start < cards.length; start += A4_CARDS_PER_SHEET) {
		const slots = Array.from(
			{ length: A4_CARDS_PER_SHEET },
			(): PlannedPrintSlot | undefined => undefined,
		);
		for (let offset = 0; offset < A4_CARDS_PER_SHEET; offset += 1) {
			const card = cards[start + offset];
			if (card) {
				slots[offset] = { card, sourceSlotIndex: offset, render: true };
			}
		}
		sheets.push(slots);
	}
	return sheets;
}

function createBackSlots(
	frontSlots: readonly (PlannedPrintSlot | undefined)[],
	orientation: PrintExportSettings['duplexOrientation'],
	mirror: boolean,
): (PlannedPrintSlot | undefined)[] {
	const backSlots = Array.from(
		{ length: A4_CARDS_PER_SHEET },
		(): PlannedPrintSlot | undefined => undefined,
	);
	for (const [frontSlotIndex, slot] of frontSlots.entries()) {
		if (!slot) {
			continue;
		}
		backSlots[mirror
			? getDuplexBackSlotIndex(frontSlotIndex, orientation)
			: frontSlotIndex] = {
			...slot,
			render: normalizeCardDesignProfile(slot.card.design).back.style !== 'none',
		};
	}
	return backSlots;
}
