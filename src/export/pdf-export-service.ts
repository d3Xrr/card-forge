import type { App, TFile } from 'obsidian';

import {
	resolveArtworkDescriptor,
	resolveVaultArtworkDescriptor,
	type ResolvedArtworkDescriptor,
} from '../services/artwork-resolver';
import {
	flattenPrintQueue,
	getInvalidQueueEntries,
	type ResolvedPrintQueueEntry,
} from '../services/print-queue-planner';
import type { ItemCardRenderer } from '../renderer/item-card-renderer';
import { CardRasterizer } from './card-rasterizer';
import {
	createBackRasterCacheKey,
	createRasterCacheKey,
} from './card-raster-identity';
import { planPrintSheets } from './duplex-sheet-planner';
import {
	assembleA4DuplexCardPdf,
	type RasterizedPhysicalCard,
	type RasterizedPrintSheet,
} from './pdf-assembler';
import { savePdfToVault } from './vault-pdf-storage';
import type { PrintExportSettings } from '../models/print-export-settings';
import { normalizePrintExportSettings } from '../models/print-export-settings';

export type PdfExportStage = 'rendering' | 'building' | 'saving';

export interface PdfExportProgress {
	stage: PdfExportStage;
	completed: number;
	total: number;
}

export interface PdfExportOptions {
	exportFolder: string;
	showCropMarks: boolean;
	printSettings?: Readonly<PrintExportSettings>;
	onProgress?: (progress: PdfExportProgress) => void;
}

export interface PdfExportResult {
	file: TFile;
	fileName: string;
	physicalCardCount: number;
	backCardCount: number;
	a4PageCount: number;
	rasterizedPageCount: number;
}

export class PdfExportService {
	private readonly rasterizer: CardRasterizer;

	constructor(
		private readonly app: App,
		cardRenderer: ItemCardRenderer,
	) {
		this.rasterizer = new CardRasterizer(cardRenderer);
	}

	async export(
		document: Document,
		queue: readonly ResolvedPrintQueueEntry[],
		options: PdfExportOptions,
	): Promise<PdfExportResult> {
		const invalidEntries = getInvalidQueueEntries(queue);
		if (invalidEntries.length > 0) {
			const names = invalidEntries.map((resolved) =>
				resolved.item?.name ?? resolved.entry.filePath,
			);
			throw new Error(`Remove or resolve invalid queue entries before export: ${names.join(', ')}`);
		}

		const physicalCards = flattenPrintQueue(queue);
		if (physicalCards.length === 0) {
			throw new Error('The print queue is empty.');
		}

		const printSettings = normalizePrintExportSettings(options.printSettings);
		const plannedSheets = planPrintSheets(physicalCards, printSettings);
		const renderCount = plannedSheets.reduce(
			(total, sheet) => total + sheet.slots.filter((slot) => slot?.render).length,
			0,
		);
		const rasterCache = new Map<string, Uint8Array>();
		let completed = 0;
		const rasterizedSheets: RasterizedPrintSheet[] = [];
		for (const sheet of plannedSheets) {
			const rasterizedSlots: RasterizedPrintSheet['slots'][number][] = [];
			for (const slot of sheet.slots) {
				if (!slot) {
					rasterizedSlots.push(undefined);
					continue;
				}
				if (!slot.render) {
					rasterizedSlots.push({});
					continue;
				}
				const card = slot.card;
				const artwork = card.artworkResourcePath
					? undefined
					: resolveArtworkDescriptor(this.app, card.page.item);
				let selectedArtwork: Pick<
					ResolvedArtworkDescriptor,
					'resourcePath' | 'revisionFingerprint'
				> | undefined = card.artworkResourcePath
						? {
							resourcePath: card.artworkResourcePath,
							revisionFingerprint: card.artworkRevisionFingerprint ?? '',
						}
						: artwork;
				if (sheet.side === 'back' && card.design.back.style === 'custom-image') {
					selectedArtwork = card.design.back.customArtworkPath
						? resolveVaultArtworkDescriptor(
							this.app,
							card.design.back.customArtworkPath,
							card.filePath,
						)
						: undefined;
					if (!selectedArtwork) {
						throw new Error(
							`Choose an available custom back image for ${card.itemName}.`,
						);
					}
				} else if (sheet.side === 'back' && card.design.back.style !== 'artwork') {
					selectedArtwork = undefined;
				}
				const artworkResourcePath = selectedArtwork?.resourcePath;
				const artworkRevisionFingerprint = selectedArtwork?.revisionFingerprint;
				const identityInput = {
					page: card.page,
					...(card.physicalPlanKey
						? { physicalPlanKey: card.physicalPlanKey }
						: {}),
					...(artworkResourcePath ? { artworkResourcePath } : {}),
					...(artworkRevisionFingerprint
						? { artworkRevisionFingerprint }
						: {}),
					design: card.design,
				};
				const cacheKey = sheet.side === 'front'
					? createRasterCacheKey(identityInput)
					: createBackRasterCacheKey(identityInput);
				let pngBytes = rasterCache.get(cacheKey);
				if (!pngBytes) {
					pngBytes = sheet.side === 'front'
						? await this.rasterizer.rasterize(
							document,
							card.page,
							artworkResourcePath,
							artworkRevisionFingerprint,
							card.design,
						)
						: await this.rasterizer.rasterizeBack(
							document,
							card.page,
							artworkResourcePath,
							artworkRevisionFingerprint,
							card.design,
						);
					rasterCache.set(cacheKey, pngBytes);
				}
				const rasterizedCard: RasterizedPhysicalCard = { cacheKey, pngBytes };
				rasterizedSlots.push({ card: rasterizedCard });
				completed += 1;
				options.onProgress?.({
					stage: 'rendering',
					completed,
					total: renderCount,
				});
				await yieldToUi();
			}
			rasterizedSheets.push({ side: sheet.side, slots: rasterizedSlots });
		}

		options.onProgress?.({ stage: 'building', completed: 0, total: renderCount });
		const pdfBytes = await assembleA4DuplexCardPdf(rasterizedSheets, {
			showCropMarks: options.showCropMarks,
			backOffsetXmm: printSettings.backOffsetXmm,
			backOffsetYmm: printSettings.backOffsetYmm,
		});
		options.onProgress?.({ stage: 'saving', completed: 0, total: renderCount });
		const saved = await savePdfToVault(this.app, options.exportFolder, pdfBytes);
		return {
			file: saved.file,
			fileName: saved.fileName,
			physicalCardCount: physicalCards.length,
			backCardCount: plannedSheets
				.filter((sheet) => sheet.side === 'back')
				.reduce((total, sheet) => total + sheet.slots.filter((slot) => slot?.render).length, 0),
			a4PageCount: plannedSheets.length,
			rasterizedPageCount: rasterCache.size,
		};
	}
}

async function yieldToUi(): Promise<void> {
	await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}
