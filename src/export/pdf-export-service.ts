import type { App, TFile } from 'obsidian';

import { resolveArtworkDescriptor } from '../services/artwork-resolver';
import {
	flattenPrintQueue,
	getInvalidQueueEntries,
	type ResolvedPrintQueueEntry,
} from '../services/print-queue-planner';
import type { ItemCardRenderer } from '../renderer/item-card-renderer';
import { A4_CARDS_PER_SHEET } from './a4-sheet-geometry';
import { CardRasterizer } from './card-rasterizer';
import { createRasterCacheKey } from './card-raster-identity';
import { assembleA4CardPdf, type RasterizedPhysicalCard } from './pdf-assembler';
import { savePdfToVault } from './vault-pdf-storage';

export type PdfExportStage = 'rendering' | 'building' | 'saving';

export interface PdfExportProgress {
	stage: PdfExportStage;
	completed: number;
	total: number;
}

export interface PdfExportOptions {
	exportFolder: string;
	showCropMarks: boolean;
	onProgress?: (progress: PdfExportProgress) => void;
}

export interface PdfExportResult {
	file: TFile;
	fileName: string;
	physicalCardCount: number;
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

		const rasterCache = new Map<string, Uint8Array>();
		const rasterizedCards: RasterizedPhysicalCard[] = [];
		for (const [index, card] of physicalCards.entries()) {
			const artwork = card.artworkResourcePath
				? undefined
				: resolveArtworkDescriptor(this.app, card.page.item);
			const artworkResourcePath = card.artworkResourcePath
				?? artwork?.resourcePath;
			const artworkRevisionFingerprint = card.artworkRevisionFingerprint
				?? artwork?.revisionFingerprint;
			const cacheKey = createRasterCacheKey({
				page: card.page,
				...(card.physicalPlanKey
					? { physicalPlanKey: card.physicalPlanKey }
					: {}),
				...(artworkResourcePath ? { artworkResourcePath } : {}),
				...(artworkRevisionFingerprint
					? { artworkRevisionFingerprint }
					: {}),
				design: card.design,
			});
			let pngBytes = rasterCache.get(cacheKey);
			if (!pngBytes) {
				pngBytes = await this.rasterizer.rasterize(
					document,
					card.page,
					artworkResourcePath,
					artworkRevisionFingerprint,
					card.design,
				);
				rasterCache.set(cacheKey, pngBytes);
			}
			rasterizedCards.push({ cacheKey, pngBytes });
			options.onProgress?.({
				stage: 'rendering',
				completed: index + 1,
				total: physicalCards.length,
			});
			await yieldToUi();
		}

		options.onProgress?.({ stage: 'building', completed: 0, total: physicalCards.length });
		const pdfBytes = await assembleA4CardPdf(rasterizedCards, {
			showCropMarks: options.showCropMarks,
		});
		options.onProgress?.({ stage: 'saving', completed: 0, total: physicalCards.length });
		const saved = await savePdfToVault(this.app, options.exportFolder, pdfBytes);
		return {
			file: saved.file,
			fileName: saved.fileName,
			physicalCardCount: physicalCards.length,
			a4PageCount: Math.ceil(physicalCards.length / A4_CARDS_PER_SHEET),
			rasterizedPageCount: rasterCache.size,
		};
	}
}

async function yieldToUi(): Promise<void> {
	await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}
