import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';

import { PdfExportService, type PdfExportProgress } from '../export/pdf-export-service';
import { A4_CARDS_PER_SHEET } from '../export/a4-sheet-geometry';
import type { ItemCardData } from '../models/item';
import type { ItemCardPage } from '../models/item-card-page';
import type { PrintQueueService } from '../models/print-queue';
import {
	applyCanonicalCardSize,
	PHYSICAL_CARD_PROFILE,
} from '../models/physical-card-profile';
import { ArtworkBoundsService } from '../renderer/artwork-bounds';
import { formatArtworkOrientation } from '../renderer/artwork-orientation';
import {
	ItemCardFitService,
	type FittedItemCardPlan,
} from '../renderer/item-card-fit-service';
import { formatLayoutName } from '../renderer/item-card-layout';
import {
	ItemCardRenderer,
	type ArtworkLoadResult,
	type RenderedItemCard,
} from '../renderer/item-card-renderer';
import { formatSourceDisplay } from '../renderer/source-formatter';
import { getArtworkResourcePath } from '../services/artwork-resolver';
import type { ItemIndex } from '../services/item-index';
import {
	calculatePrintQueueSummary,
	flattenPrintQueue,
	getInvalidQueueEntries,
	resolvePrintQueue,
	type PhysicalItemPlan,
	type ResolvedPrintQueueEntry,
} from '../services/print-queue-planner';
import type { CardForgeSettings } from '../settings';

export const CARD_FORGE_VIEW_TYPE = 'ttrpg-card-forge-view';

export class CardForgeView extends ItemView {
	private readonly artworkBounds = new ArtworkBoundsService();
	private readonly cardRenderer = new ItemCardRenderer(this.artworkBounds);
	private readonly cardFitService = new ItemCardFitService(
		this.cardRenderer,
		this.artworkBounds,
	);
	private readonly pdfExportService: PdfExportService;
	private readonly physicalPlanCache = new Map<string, Promise<FittedItemCardPlan>>();
	private searchInput: HTMLInputElement | null = null;
	private totalCountElement: HTMLElement | null = null;
	private filteredCountElement: HTMLElement | null = null;
	private resultsElement: HTMLElement | null = null;
	private cardHostElement: HTMLElement | null = null;
	private diagnosticsElement: HTMLElement | null = null;
	private pageNavigationElement: HTMLElement | null = null;
	private previousPageButton: HTMLButtonElement | null = null;
	private nextPageButton: HTMLButtonElement | null = null;
	private pageLabelElement: HTMLElement | null = null;
	private addToQueueButton: HTMLButtonElement | null = null;
	private openSourceButton: HTMLButtonElement | null = null;
	private queueListElement: HTMLElement | null = null;
	private queueSummaryElement: HTMLElement | null = null;
	private queueStatusElement: HTMLElement | null = null;
	private exportButton: HTMLButtonElement | null = null;
	private clearQueueButton: HTMLButtonElement | null = null;
	private openLastPdfButton: HTMLButtonElement | null = null;
	private sheetGridElement: HTMLElement | null = null;
	private sheetLabelElement: HTMLElement | null = null;
	private previousSheetButton: HTMLButtonElement | null = null;
	private nextSheetButton: HTMLButtonElement | null = null;
	private selectedFilePath: string | null = null;
	private lastPdfFile: TFile | null = null;
	private unsubscribeFromIndex: (() => void) | null = null;
	private unsubscribeFromQueue: (() => void) | null = null;
	private overflowFrame: number | null = null;
	private cardResizeObserver: ResizeObserver | null = null;
	private previewGeneration = 0;
	private queuePlanGeneration = 0;
	private previewPages: ItemCardPage[] = [];
	private currentQueuePlan: ResolvedPrintQueueEntry[] = [];
	private currentPageIndex = 0;
	private currentSheetIndex = 0;
	private unfitPageIndexes: ReadonlySet<number> = new Set<number>();
	private currentArtworkResourcePath: string | undefined;
	private exportInProgress = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly itemIndex: ItemIndex,
		private readonly printQueue: PrintQueueService,
		private readonly getSettings: () => Readonly<CardForgeSettings>,
	) {
		super(leaf);
		this.pdfExportService = new PdfExportService(this.app, this.cardRenderer);
	}

	getViewType(): string {
		return CARD_FORGE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'TTRPG Card Forge';
	}

	getIcon(): string {
		return 'layers-3';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		if (!(container instanceof HTMLElement)) {
			return;
		}

		container.empty();
		container.addClass('ttrpg-card-forge');
		const header = container.createDiv({ cls: 'ttrpg-card-forge__header' });
		const headingGroup = header.createDiv({ cls: 'ttrpg-card-forge__heading-group' });
		headingGroup.createEl('h2', {
			text: 'TTRPG Card Forge',
			cls: 'ttrpg-card-forge__heading',
		});
		headingGroup.createDiv({
			text: 'Physical item cards and A4 PDF export',
			cls: 'ttrpg-card-forge__subtitle',
		});
		this.totalCountElement = header.createDiv({ cls: 'ttrpg-card-forge__total-count' });

		const workspace = container.createDiv({ cls: 'ttrpg-card-forge__workspace' });
		this.buildBrowser(workspace);
		this.buildPreview(workspace);
		this.buildQueue(workspace);

		if (this.searchInput) {
			this.registerDomEvent(this.searchInput, 'input', () => this.render());
		}
		if (this.previousPageButton) {
			this.registerDomEvent(this.previousPageButton, 'click', () => this.showRelativePage(-1));
		}
		if (this.nextPageButton) {
			this.registerDomEvent(this.nextPageButton, 'click', () => this.showRelativePage(1));
		}
		if (this.addToQueueButton) {
			this.registerDomEvent(this.addToQueueButton, 'click', () => this.addSelectedToQueue());
		}
		if (this.openSourceButton) {
			this.registerDomEvent(this.openSourceButton, 'click', () => this.openSelectedItem());
		}
		if (this.clearQueueButton) {
			this.registerDomEvent(this.clearQueueButton, 'click', () => this.printQueue.clear());
		}
		if (this.exportButton) {
			this.registerDomEvent(this.exportButton, 'click', () => {
				void this.exportPdf();
			});
		}
		if (this.openLastPdfButton) {
			this.registerDomEvent(this.openLastPdfButton, 'click', () => {
				void this.openLastPdf();
			});
		}
		if (this.previousSheetButton) {
			this.registerDomEvent(this.previousSheetButton, 'click', () => this.showRelativeSheet(-1));
		}
		if (this.nextSheetButton) {
			this.registerDomEvent(this.nextSheetButton, 'click', () => this.showRelativeSheet(1));
		}

		this.unsubscribeFromIndex = this.itemIndex.subscribe(() => {
			this.physicalPlanCache.clear();
			this.render();
		});
		this.unsubscribeFromQueue = this.printQueue.subscribe(() => {
			this.currentSheetIndex = 0;
			this.renderQueue();
		});
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromQueue?.();
		this.unsubscribeFromIndex = null;
		this.unsubscribeFromQueue = null;
		if (this.overflowFrame !== null) {
			window.cancelAnimationFrame(this.overflowFrame);
		}
		this.cardResizeObserver?.disconnect();
		this.previewGeneration += 1;
		this.queuePlanGeneration += 1;
		this.physicalPlanCache.clear();
		this.containerEl.children[1]?.removeClass('ttrpg-card-forge');
		this.previewPages = [];
		this.currentQueuePlan = [];
		this.unfitPageIndexes = new Set<number>();
		this.currentArtworkResourcePath = undefined;
	}

	private buildBrowser(workspace: HTMLElement): void {
		const browser = workspace.createEl('section', {
			cls: 'ttrpg-card-forge__browser',
			attr: { 'aria-label': 'Item browser' },
		});
		const toolbar = browser.createDiv({ cls: 'ttrpg-card-forge__browser-toolbar' });
		this.searchInput = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search items…',
			cls: 'ttrpg-card-forge__search',
			attr: { 'aria-label': 'Search indexed items' },
		});
		this.filteredCountElement = toolbar.createDiv({ cls: 'ttrpg-card-forge__filtered-count' });
		this.resultsElement = browser.createDiv({
			cls: 'ttrpg-card-forge__results',
			attr: { role: 'listbox', 'aria-label': 'Indexed items' },
		});
	}

	private buildPreview(workspace: HTMLElement): void {
		const preview = workspace.createEl('section', {
			cls: 'ttrpg-card-forge__preview',
			attr: { 'aria-label': 'Card preview' },
		});
		preview.createEl('h3', {
			text: 'Card preview',
			cls: 'ttrpg-card-forge__panel-heading',
		});
		this.pageNavigationElement = preview.createDiv({
			cls: 'ttrpg-card-forge__page-navigation',
			attr: { 'aria-label': 'Card page navigation' },
		});
		this.pageNavigationElement.hidden = true;
		this.previousPageButton = this.pageNavigationElement.createEl('button', {
			text: '‹',
			cls: 'ttrpg-card-forge__page-button',
			attr: { type: 'button', 'aria-label': 'Previous card page' },
		});
		this.pageLabelElement = this.pageNavigationElement.createSpan({ cls: 'ttrpg-card-forge__page-label' });
		this.nextPageButton = this.pageNavigationElement.createEl('button', {
			text: '›',
			cls: 'ttrpg-card-forge__page-button',
			attr: { type: 'button', 'aria-label': 'Next card page' },
		});
		this.cardHostElement = preview.createDiv({ cls: 'ttrpg-card-forge__card-host' });
		this.diagnosticsElement = preview.createDiv({ cls: 'ttrpg-card-forge__diagnostics' });
		const actions = preview.createDiv({ cls: 'ttrpg-card-forge__preview-actions' });
		this.addToQueueButton = actions.createEl('button', {
			text: 'Add to print queue',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		this.openSourceButton = actions.createEl('button', {
			text: 'Open source note',
			attr: { type: 'button' },
		});
	}

	private buildQueue(workspace: HTMLElement): void {
		const queue = workspace.createEl('section', {
			cls: 'ttrpg-card-forge__queue',
			attr: { 'aria-label': 'Print queue' },
		});
		const queueHeader = queue.createDiv({ cls: 'ttrpg-card-forge__queue-header' });
		queueHeader.createEl('h3', {
			text: 'Print queue',
			cls: 'ttrpg-card-forge__panel-heading',
		});
		this.clearQueueButton = queueHeader.createEl('button', {
			text: 'Clear',
			attr: { type: 'button', 'aria-label': 'Clear print queue' },
		});
		this.queueSummaryElement = queue.createDiv({ cls: 'ttrpg-card-forge__queue-summary' });
		this.queueListElement = queue.createDiv({ cls: 'ttrpg-card-forge__queue-list' });

		const sheetPreview = queue.createDiv({ cls: 'ttrpg-card-forge__sheet-preview' });
		const sheetNavigation = sheetPreview.createDiv({ cls: 'ttrpg-card-forge__sheet-navigation' });
		this.previousSheetButton = sheetNavigation.createEl('button', {
			text: '‹',
			attr: { type: 'button', 'aria-label': 'Previous A4 sheet' },
		});
		this.sheetLabelElement = sheetNavigation.createSpan();
		this.nextSheetButton = sheetNavigation.createEl('button', {
			text: '›',
			attr: { type: 'button', 'aria-label': 'Next A4 sheet' },
		});
		this.sheetGridElement = sheetPreview.createDiv({
			cls: 'ttrpg-card-forge__sheet-grid',
			attr: { 'aria-label': 'A4 landscape sheet preview' },
		});

		this.queueStatusElement = queue.createDiv({
			cls: 'ttrpg-card-forge__queue-status',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		const exportActions = queue.createDiv({ cls: 'ttrpg-card-forge__export-actions' });
		this.exportButton = exportActions.createEl('button', {
			text: 'Export PDF',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		this.openLastPdfButton = exportActions.createEl('button', {
			text: 'Open last PDF',
			attr: { type: 'button' },
		});
		this.openLastPdfButton.hidden = true;
	}

	private render(): void {
		if (!this.resultsElement || !this.totalCountElement || !this.filteredCountElement) {
			return;
		}
		const allItems = this.itemIndex.getItems();
		const query = this.searchInput?.value.trim().toLocaleLowerCase() ?? '';
		const visibleItems = query
			? allItems.filter((item) => isSearchMatch(item, query))
			: allItems;
		this.totalCountElement.setText(formatItemCount(allItems.length));
		this.filteredCountElement.setText(query ? `${visibleItems.length} results` : formatItemCount(visibleItems.length));

		if (!visibleItems.some((item) => item.filePath === this.selectedFilePath)) {
			this.selectedFilePath = visibleItems[0]?.filePath ?? null;
			this.currentPageIndex = 0;
		}
		this.renderItemList(visibleItems, query);
		this.renderPreview();
		this.renderQueue();
	}

	private renderItemList(items: readonly ItemCardData[], query: string): void {
		if (!this.resultsElement) {
			return;
		}
		this.resultsElement.empty();
		if (items.length === 0) {
			this.resultsElement.createDiv({
				cls: 'ttrpg-card-forge__empty',
				text: query ? 'No indexed items match this search.' : 'No items are indexed. Check settings and rebuild the index.',
			});
			return;
		}

		for (const item of items) {
			const isSelected = item.filePath === this.selectedFilePath;
			const result = this.resultsElement.createEl('button', {
				cls: `ttrpg-card-forge__result${isSelected ? ' is-selected' : ''}`,
				attr: { type: 'button', role: 'option', 'aria-selected': isSelected ? 'true' : 'false' },
			});
			result.dataset.filePath = item.filePath;
			result.createDiv({ text: item.name, cls: 'ttrpg-card-forge__result-name' });
			const metadata = result.createDiv({ cls: 'ttrpg-card-forge__result-metadata' });
			if (item.rarity) {
				metadata.createSpan({ text: humanizeSlug(item.rarity) });
			}
			const source = formatSourceDisplay(item.source, item.sourceText, 'compact');
			if (source) {
				metadata.createSpan({ text: source });
			}
			result.addEventListener('click', () => this.selectItem(item.filePath));
			result.addEventListener('dblclick', () => this.openItem(item));
		}
	}

	private selectItem(filePath: string): void {
		if (this.selectedFilePath === filePath) {
			return;
		}
		this.selectedFilePath = filePath;
		this.currentPageIndex = 0;
		this.render();
	}

	private renderPreview(): void {
		if (!this.cardHostElement || !this.diagnosticsElement || !this.openSourceButton || !this.addToQueueButton) {
			return;
		}
		this.cancelPreviewObservation();
		const generation = ++this.previewGeneration;
		const item = this.findSelectedItem();
		this.cardHostElement.empty();
		this.diagnosticsElement.empty();
		this.previewPages = [];
		this.unfitPageIndexes = new Set<number>();
		this.currentArtworkResourcePath = undefined;
		this.updatePageNavigation();
		this.openSourceButton.disabled = !item;
		this.addToQueueButton.disabled = !item;

		if (!item) {
			this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Select an item to preview its card.' });
			return;
		}
		this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Planning physical card pages…' });
		void this.planAndRenderPreview(item, generation);
	}

	private async planAndRenderPreview(item: ItemCardData, generation: number): Promise<void> {
		if (!this.cardHostElement) {
			return;
		}
		try {
			const plan = await this.getPhysicalPlan(item);
			if (generation !== this.previewGeneration) {
				return;
			}
			this.previewPages = plan.pages;
			this.unfitPageIndexes = plan.unfitPageIndexes;
			this.currentArtworkResourcePath = getArtworkResourcePath(this.app, item);
			this.currentPageIndex = Math.min(this.currentPageIndex, Math.max(0, plan.pages.length - 1));
			this.renderCurrentPage(generation);
		} catch (error) {
			console.error('TTRPG Card Forge: physical card planning failed', error);
			if (generation === this.previewGeneration && this.cardHostElement) {
				this.cardHostElement.empty();
				this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Physical card planning failed. See the developer console.' });
			}
		}
	}

	private getPhysicalPlan(item: ItemCardData): Promise<FittedItemCardPlan> {
		let plan = this.physicalPlanCache.get(item.filePath);
		if (!plan) {
			plan = this.cardFitService.fit(
				this.containerEl.ownerDocument,
				item,
				getArtworkResourcePath(this.app, item),
			);
			this.physicalPlanCache.set(item.filePath, plan);
		}
		return plan;
	}

	private renderCurrentPage(generation: number): void {
		if (!this.cardHostElement) {
			return;
		}
		const page = this.previewPages[this.currentPageIndex];
		if (!page) {
			return;
		}
		this.cancelPreviewObservation();
		this.updatePageNavigation();
		this.cardHostElement.empty();
		const viewport = this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__scaled-card-viewport' });
		const physicalHost = viewport.createDiv({ cls: 'ttrpg-card-forge__scaled-card' });
		applyCanonicalCardSize(physicalHost);
		const rendered = this.cardRenderer.render(physicalHost, page, this.currentArtworkResourcePath);
		const scalePhysicalCard = (): void => {
			if (!this.cardHostElement) {
				return;
			}
			const scale = Math.min(1, this.cardHostElement.clientWidth / PHYSICAL_CARD_PROFILE.widthPx);
			physicalHost.style.transform = `scale(${scale})`;
			viewport.style.height = `${PHYSICAL_CARD_PROFILE.heightPx * scale}px`;
		};
		scalePhysicalCard();
		this.renderDiagnostics(
			page,
			rendered,
			this.currentArtworkResourcePath,
			generation,
			scalePhysicalCard,
		);
	}

	private renderQueue(): void {
		const generation = ++this.queuePlanGeneration;
		const entries = this.printQueue.getEntries();
		this.currentQueuePlan = [];
		this.renderQueuePlanningState(entries.length);
		void this.planQueue(generation);
	}

	private async planQueue(generation: number): Promise<void> {
		const entries = this.printQueue.getEntries();
		const items = this.itemIndex.getItems();
		const itemsByPath = new Map(items.map((item) => [item.filePath, item]));
		const plans = new Map<string, PhysicalItemPlan>();
		try {
			for (const entry of entries) {
				const item = itemsByPath.get(entry.filePath);
				if (item && !plans.has(item.filePath)) {
					const plan = await this.getPhysicalPlan(item);
					plans.set(item.filePath, plan);
				}
			}
		} catch (error) {
			console.error('TTRPG Card Forge: print queue planning failed', error);
			if (generation === this.queuePlanGeneration && this.queueStatusElement) {
				this.currentQueuePlan = [];
				this.queueStatusElement.setText('Queue planning failed. See the developer console.');
				this.updateExportControls();
			}
			return;
		}

		if (generation !== this.queuePlanGeneration) {
			return;
		}
		this.currentQueuePlan = resolvePrintQueue(entries, items, plans);
		this.renderResolvedQueue();
	}

	private renderQueuePlanningState(entryCount: number): void {
		if (!this.queueListElement || !this.queueSummaryElement) {
			return;
		}
		this.queueListElement.empty();
		this.queueSummaryElement.setText(entryCount > 0 ? 'Planning physical cards…' : '0 item types · 0 copies · 0 physical cards · 0 A4 pages');
		if (entryCount === 0) {
			this.queueListElement.createDiv({ cls: 'ttrpg-card-forge__empty', text: 'Add an item from the card preview.' });
		}
		this.updateExportControls();
	}

	private renderResolvedQueue(): void {
		if (!this.queueListElement || !this.queueSummaryElement) {
			return;
		}
		this.queueListElement.empty();
		const summary = calculatePrintQueueSummary(this.currentQueuePlan);
		this.queueSummaryElement.setText(
			`${summary.itemTypes} item ${summary.itemTypes === 1 ? 'type' : 'types'} · ${summary.copies} ${summary.copies === 1 ? 'copy' : 'copies'} · ${summary.physicalCards} physical ${summary.physicalCards === 1 ? 'card' : 'cards'} · ${summary.a4Pages} A4 ${summary.a4Pages === 1 ? 'page' : 'pages'}`,
		);
		if (this.currentQueuePlan.length === 0) {
			this.queueListElement.createDiv({ cls: 'ttrpg-card-forge__empty', text: 'Add an item from the card preview.' });
		}

		for (const [index, resolved] of this.currentQueuePlan.entries()) {
			this.renderQueueEntry(resolved, index);
		}
		this.renderSheetPreview();
		this.updateExportControls();
	}

	private renderQueueEntry(resolved: ResolvedPrintQueueEntry, index: number): void {
		if (!this.queueListElement) {
			return;
		}
		const row = this.queueListElement.createDiv({
			cls: `ttrpg-card-forge__queue-entry${resolved.unavailable ? ' is-unavailable' : ''}`,
		});
		const details = row.createDiv({ cls: 'ttrpg-card-forge__queue-entry-details' });
		details.createDiv({
			cls: 'ttrpg-card-forge__queue-entry-name',
			text: resolved.item?.name ?? resolved.entry.filePath,
		});
		const metadata = resolved.unavailable
			? 'Unavailable — remove this entry to export'
			: resolved.unfitPageIndexes.size > 0
				? 'Content does not fit a physical card — export blocked'
				: `${resolved.pages.length} ${resolved.pages.length === 1 ? 'card' : 'cards'} per copy · ${resolved.pages.length * resolved.entry.quantity} total`;
		details.createDiv({ cls: 'ttrpg-card-forge__queue-entry-meta', text: metadata });

		const controls = row.createDiv({ cls: 'ttrpg-card-forge__queue-controls' });
		appendQueueButton(controls, '−', `Decrease ${resolved.item?.name ?? 'item'} quantity`, () => this.printQueue.decrement(resolved.entry.id), resolved.entry.quantity <= 1);
		controls.createSpan({ cls: 'ttrpg-card-forge__queue-quantity', text: String(resolved.entry.quantity) });
		appendQueueButton(controls, '+', `Increase ${resolved.item?.name ?? 'item'} quantity`, () => this.printQueue.increment(resolved.entry.id));
		appendQueueButton(controls, '↑', `Move ${resolved.item?.name ?? 'item'} up`, () => this.printQueue.move(resolved.entry.id, -1), index === 0);
		appendQueueButton(controls, '↓', `Move ${resolved.item?.name ?? 'item'} down`, () => this.printQueue.move(resolved.entry.id, 1), index === this.currentQueuePlan.length - 1);
		appendQueueButton(controls, 'Remove', `Remove ${resolved.item?.name ?? 'item'} from queue`, () => this.printQueue.remove(resolved.entry.id));
	}

	private renderSheetPreview(): void {
		if (!this.sheetGridElement || !this.sheetLabelElement || !this.previousSheetButton || !this.nextSheetButton) {
			return;
		}
		const cards = flattenPrintQueue(this.currentQueuePlan);
		const sheetCount = Math.ceil(cards.length / A4_CARDS_PER_SHEET);
		this.currentSheetIndex = Math.min(this.currentSheetIndex, Math.max(0, sheetCount - 1));
		this.sheetLabelElement.setText(sheetCount ? `Sheet ${this.currentSheetIndex + 1} / ${sheetCount}` : 'No sheets');
		this.previousSheetButton.disabled = this.currentSheetIndex <= 0;
		this.nextSheetButton.disabled = this.currentSheetIndex >= sheetCount - 1;
		this.sheetGridElement.empty();
		const start = this.currentSheetIndex * A4_CARDS_PER_SHEET;
		for (let slot = 0; slot < A4_CARDS_PER_SHEET; slot += 1) {
			const card = cards[start + slot];
			const host = this.sheetGridElement.createDiv({ cls: 'ttrpg-card-forge__sheet-slot' });
			if (card) {
				this.cardRenderer.render(host, card.page, getArtworkResourcePath(this.app, card.page.item));
			} else {
				host.addClass('is-empty');
			}
		}
	}

	private updateExportControls(): void {
		if (!this.exportButton || !this.clearQueueButton || !this.openLastPdfButton) {
			return;
		}
		const invalid = getInvalidQueueEntries(this.currentQueuePlan);
		const physicalCount = flattenPrintQueue(this.currentQueuePlan).length;
		this.exportButton.disabled = this.exportInProgress || physicalCount === 0 || invalid.length > 0;
		this.clearQueueButton.disabled = this.exportInProgress || this.printQueue.getEntries().length === 0;
		this.openLastPdfButton.hidden = !this.lastPdfFile;
		this.openLastPdfButton.disabled = this.exportInProgress || !this.lastPdfFile;
	}

	private async exportPdf(): Promise<void> {
		if (this.exportInProgress || !this.queueStatusElement) {
			return;
		}
		this.exportInProgress = true;
		this.updateExportControls();
		try {
			const settings = this.getSettings();
			const result = await this.pdfExportService.export(
				this.containerEl.ownerDocument,
				this.currentQueuePlan,
				{
					exportFolder: settings.pdfExportFolder,
					showCropMarks: settings.showCropMarks,
					onProgress: (progress) => this.renderExportProgress(progress),
				},
			);
			this.lastPdfFile = result.file;
			this.queueStatusElement.setText(
				`Saved ${result.fileName} · ${result.physicalCardCount} physical cards · ${result.a4PageCount} A4 pages`,
			);
			new Notice(`Saved ${result.fileName}: ${result.physicalCardCount} physical cards on ${result.a4PageCount} A4 pages.`);
			if (settings.openPdfAfterExport) {
				await this.openPdf(result.file);
			}
		} catch (error) {
			console.error('TTRPG Card Forge: PDF export failed', error);
			const message = error instanceof Error ? error.message : 'Unknown export error';
			this.queueStatusElement.setText(`Export failed: ${message}`);
			new Notice(`TTRPG Card Forge could not export the PDF. ${message}`);
		} finally {
			this.exportInProgress = false;
			this.updateExportControls();
		}
	}

	private renderExportProgress(progress: PdfExportProgress): void {
		if (!this.queueStatusElement) {
			return;
		}
		if (progress.stage === 'rendering') {
			this.queueStatusElement.setText(`Rendering cards ${progress.completed} / ${progress.total}…`);
		} else if (progress.stage === 'building') {
			this.queueStatusElement.setText('Building PDF…');
		} else {
			this.queueStatusElement.setText('Saving PDF to vault…');
		}
	}

	private addSelectedToQueue(): void {
		const item = this.findSelectedItem();
		if (item) {
			this.printQueue.add(item.filePath);
			new Notice(`Added ${item.name} to the print queue.`);
		}
	}

	private findSelectedItem(): ItemCardData | undefined {
		return this.itemIndex.getItems().find((item) => item.filePath === this.selectedFilePath);
	}

	private showRelativePage(offset: number): void {
		const next = Math.min(Math.max(0, this.currentPageIndex + offset), Math.max(0, this.previewPages.length - 1));
		if (next !== this.currentPageIndex) {
			this.currentPageIndex = next;
			this.renderCurrentPage(this.previewGeneration);
		}
	}

	private showRelativeSheet(offset: number): void {
		this.currentSheetIndex = Math.max(0, this.currentSheetIndex + offset);
		this.renderSheetPreview();
	}

	private updatePageNavigation(): void {
		if (!this.pageNavigationElement || !this.previousPageButton || !this.nextPageButton || !this.pageLabelElement) {
			return;
		}
		const count = this.previewPages.length;
		this.pageNavigationElement.hidden = count <= 1;
		this.pageLabelElement.setText(count ? `${this.currentPageIndex + 1} / ${count}` : '');
		this.previousPageButton.disabled = this.currentPageIndex <= 0;
		this.nextPageButton.disabled = this.currentPageIndex >= count - 1;
	}

	private renderDiagnostics(
		page: ItemCardPage,
		renderedCard: RenderedItemCard,
		artworkResourcePath: string | undefined,
		generation: number,
		onResize: () => void,
	): void {
		if (!this.diagnosticsElement) {
			return;
		}
		let artworkResult: ArtworkLoadResult | undefined;
		const update = (): void => {
			if (!this.diagnosticsElement || generation !== this.previewGeneration) {
				return;
			}
			const hasOverflow = renderedCard.hasOverflow() || this.unfitPageIndexes.has(page.pageIndex);
			const parts = [
				`${page.pageCount} physical ${page.pageCount === 1 ? 'card' : 'cards'}`,
				...(page.pageCount > 1 ? [`Page ${page.pageIndex + 1}/${page.pageCount}`] : []),
				`Layout: ${formatLayoutName(renderedCard.layout)}`,
				formatArtworkDiagnostic(page, artworkResourcePath, artworkResult),
				hasOverflow ? `Does not fit at ${renderedCard.printFontPoints.toFixed(1)} pt` : 'Fits canonical 750 × 1050 px',
			];
			this.diagnosticsElement.empty();
			this.diagnosticsElement.createSpan({ text: parts.join(' · '), cls: hasOverflow ? 'is-warning' : undefined });
		};
		const schedule = (): void => {
			onResize();
			if (this.overflowFrame !== null) {
				window.cancelAnimationFrame(this.overflowFrame);
			}
			this.overflowFrame = window.requestAnimationFrame(() => {
				this.overflowFrame = null;
				update();
			});
		};
		this.cardResizeObserver = new ResizeObserver(schedule);
		this.cardResizeObserver.observe(renderedCard.element);
		if (this.cardHostElement) {
			this.cardResizeObserver.observe(this.cardHostElement);
		}
		void renderedCard.artworkReady.then((result) => {
			if (generation === this.previewGeneration) {
				artworkResult = result;
				schedule();
			}
		});
		schedule();
	}

	private cancelPreviewObservation(): void {
		if (this.overflowFrame !== null) {
			window.cancelAnimationFrame(this.overflowFrame);
			this.overflowFrame = null;
		}
		this.cardResizeObserver?.disconnect();
		this.cardResizeObserver = null;
	}

	private openSelectedItem(): void {
		const item = this.findSelectedItem();
		if (item) {
			this.openItem(item);
		}
	}

	private openItem(item: ItemCardData): void {
		void this.app.workspace.openLinkText(item.filePath, '', false);
	}

	private async openLastPdf(): Promise<void> {
		if (this.lastPdfFile) {
			await this.openPdf(this.lastPdfFile);
		}
	}

	private async openPdf(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file);
		await this.app.workspace.revealLeaf(leaf);
	}
}

function appendQueueButton(
	container: HTMLElement,
	text: string,
	ariaLabel: string,
	onClick: () => void,
	disabled = false,
): void {
	const button = container.createEl('button', {
		text,
		attr: { type: 'button', 'aria-label': ariaLabel },
	});
	button.disabled = disabled;
	button.addEventListener('click', onClick);
}

function formatArtworkDiagnostic(
	page: ItemCardPage,
	artworkResourcePath?: string,
	artworkResult?: ArtworkLoadResult,
): string {
	if (!page.item.imagePath) {
		return 'No artwork';
	}
	if (!page.showArtwork) {
		return 'Artwork omitted';
	}
	if (!artworkResourcePath || artworkResult?.status === 'error') {
		return 'Artwork unavailable';
	}
	if (artworkResult?.status === 'ready') {
		return `Artwork: ${formatArtworkOrientation(artworkResult.orientation)}`;
	}
	if (artworkResult?.status === 'invalid-dimensions') {
		return 'Artwork dimensions unavailable';
	}
	return artworkResult?.status === 'not-rendered' ? 'Artwork omitted' : 'Artwork: loading';
}

function isSearchMatch(item: ItemCardData, query: string): boolean {
	return [item.name, item.rarity, item.source, item.detail]
		.filter((value): value is string => Boolean(value))
		.some((value) => value.toLocaleLowerCase().includes(query));
}

function formatItemCount(count: number): string {
	return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function humanizeSlug(value: string): string {
	return value
		.split('-')
		.map((part) => part ? `${part[0]?.toLocaleUpperCase()}${part.slice(1)}` : part)
		.join(' ');
}
