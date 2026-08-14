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
import { serializeFittedItemCardPlanSignature } from '../renderer/item-card-plan-signature';
import {
	ItemCardRenderer,
	type ArtworkLoadResult,
	type RenderedItemCard,
} from '../renderer/item-card-renderer';
import { formatSourceDisplay } from '../renderer/source-formatter';
import {
	resolveArtworkDescriptor,
} from '../services/artwork-resolver';
import type { ItemIndex } from '../services/item-index';
import {
	areQueuePlanInputsCurrent,
	isIndexedPlanningInputCurrent,
	LatestRequestGate,
	reconcileVisibleSelection,
	resolveQueuePlanMap,
	selectRelativePageIndex,
	shouldRequestSelectedPlan,
	type LatestRequestToken,
} from '../services/planning-interactions';
import {
	createEffectiveItemFingerprint,
	createPhysicalPlanCacheIdentity,
	type PhysicalPlanCache,
	type PhysicalPlanCacheIdentity,
} from '../services/physical-plan-cache';
import {
	calculatePrintQueueSummary,
	flattenPrintQueue,
	getInvalidQueueEntries,
	resolvePrintQueue,
	type PhysicalItemPlan,
	type ResolvedPrintQueueEntry,
} from '../services/print-queue-planner';
import type { CardForgeSettings } from '../settings';
import {
	type PlanningCacheStatus,
	PlanningPerformanceMonitor,
} from '../services/planning-performance';

export const CARD_FORGE_VIEW_TYPE = 'ttrpg-card-forge-view';
const PHYSICAL_PLAN_RENDER_SETTINGS_FINGERPRINT = 'card-render-settings-v1';

interface PhysicalPlanLookup {
	identity: PhysicalPlanCacheIdentity;
	indexIsCurrent: boolean;
	artworkResourcePath?: string;
	artworkRevisionFingerprint?: string;
	cacheStatus: PlanningCacheStatus;
	completed?: FittedItemCardPlan;
	promise?: Promise<FittedItemCardPlan>;
}

export class CardForgeView extends ItemView {
	private readonly artworkBounds = new ArtworkBoundsService();
	private readonly cardRenderer = new ItemCardRenderer(this.artworkBounds);
	private readonly cardFitService = new ItemCardFitService(
		this.cardRenderer,
		this.artworkBounds,
	);
	private readonly pdfExportService: PdfExportService;
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
	private pageRenderGeneration = 0;
	private readonly previewRequestGate = new LatestRequestGate<string>();
	private readonly queueRequestGate = new LatestRequestGate<number>();
	private previewPages: ItemCardPage[] = [];
	private currentQueuePlan: ResolvedPrintQueueEntry[] = [];
	private currentPageIndex = 0;
	private currentSheetIndex = 0;
	private unfitPageIndexes: ReadonlySet<number> = new Set<number>();
	private currentArtworkResourcePath: string | undefined;
	private currentArtworkRevisionFingerprint: string | undefined;
	private currentPreviewPlanKey: string | undefined;
	private exportInProgress = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly itemIndex: ItemIndex,
		private readonly printQueue: PrintQueueService,
		private readonly getSettings: () => Readonly<CardForgeSettings>,
		private readonly physicalPlanCache: PhysicalPlanCache<FittedItemCardPlan>,
		private readonly planningPerformance: PlanningPerformanceMonitor,
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
			this.registerDomEvent(this.searchInput, 'input', () => {
				const selectionChanged = this.renderBrowser();
				if (selectionChanged) {
					this.renderPreview();
				}
			});
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
			const selectionChanged = this.renderBrowser();
			const selectedItem = this.findSelectedItem();
			const selectedIdentity = selectedItem
				? this.createPhysicalPlanRequest(selectedItem).identity.key
				: undefined;
			const effectivePlanChanged = selectedIdentity === undefined
				? this.currentPreviewPlanKey !== undefined
				: shouldRequestSelectedPlan(
					this.currentPreviewPlanKey ?? null,
					selectedIdentity,
				);
			if (selectionChanged || effectivePlanChanged) {
				this.renderPreview();
			}
			this.renderQueue();
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
		this.pageRenderGeneration += 1;
		this.previewRequestGate.invalidate();
		this.queueRequestGate.invalidate();
		this.containerEl.children[1]?.removeClass('ttrpg-card-forge');
		this.previewPages = [];
		this.currentQueuePlan = [];
		this.unfitPageIndexes = new Set<number>();
		this.currentArtworkResourcePath = undefined;
		this.currentArtworkRevisionFingerprint = undefined;
		this.currentPreviewPlanKey = undefined;
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
		this.renderBrowser();
		this.renderPreview();
		this.renderQueue();
	}

	private renderBrowser(): boolean {
		if (!this.resultsElement || !this.totalCountElement || !this.filteredCountElement) {
			return false;
		}
		const allItems = this.itemIndex.getItems();
		const query = this.searchInput?.value.trim().toLocaleLowerCase() ?? '';
		const visibleItems = query
			? allItems.filter((item) => isSearchMatch(item, query))
			: allItems;
		this.totalCountElement.setText(formatItemCount(allItems.length));
		this.filteredCountElement.setText(query ? `${visibleItems.length} results` : formatItemCount(visibleItems.length));

		const selection = reconcileVisibleSelection(
			this.selectedFilePath,
			visibleItems.map((item) => item.filePath),
		);
		this.selectedFilePath = selection.selectedFilePath;
		if (selection.selectionChanged) {
			this.currentPageIndex = 0;
		}
		this.renderItemList(visibleItems, query);
		return selection.selectionChanged;
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
		this.renderBrowser();
		this.renderPreview();
	}

	private renderPreview(): void {
		if (!this.cardHostElement || !this.diagnosticsElement || !this.openSourceButton || !this.addToQueueButton) {
			return;
		}
		this.cancelPreviewObservation();
		const generation = ++this.previewGeneration;
		this.pageRenderGeneration += 1;
		this.previewRequestGate.invalidate();
		const item = this.findSelectedItem();
		this.cardHostElement.empty();
		this.diagnosticsElement.empty();
		this.previewPages = [];
		this.unfitPageIndexes = new Set<number>();
		this.currentArtworkResourcePath = undefined;
		this.currentArtworkRevisionFingerprint = undefined;
		this.currentPreviewPlanKey = undefined;
		this.updatePageNavigation();
		this.openSourceButton.disabled = !item;
		this.addToQueueButton.disabled = !item;

		if (!item) {
			this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Select an item to preview its card.' });
			return;
		}
		const lookup = this.beginPhysicalPlanLookup(item);
		this.currentPreviewPlanKey = lookup.identity.key;
		if (!lookup.indexIsCurrent || !lookup.promise) {
			this.cardHostElement.createDiv({
				cls: 'ttrpg-card-forge__preview-empty',
				text: 'Updating the item index…',
			});
			return;
		}
		const requestToken = this.previewRequestGate.begin(lookup.identity.key);
		if (lookup.completed) {
			this.applyPhysicalPlanToPreview(
				item,
				lookup,
				lookup.completed,
				generation,
				requestToken,
			);
			return;
		}
		this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Planning physical card pages…' });
		void this.planAndRenderPreview(item, lookup, generation, requestToken);
	}

	private async planAndRenderPreview(
		item: ItemCardData,
		lookup: PhysicalPlanLookup,
		generation: number,
		requestToken: LatestRequestToken<string>,
	): Promise<void> {
		if (!this.cardHostElement) {
			return;
		}
		try {
			if (!lookup.promise) {
				return;
			}
			const plan = await lookup.promise;
			if (
				generation !== this.previewGeneration
				|| this.selectedFilePath !== item.filePath
				|| this.currentPreviewPlanKey !== lookup.identity.key
				|| !this.previewRequestGate.isCurrent(requestToken)
			) {
				return;
			}
			this.applyPhysicalPlanToPreview(
				item,
				lookup,
				plan,
				generation,
				requestToken,
			);
		} catch (error) {
			console.error('TTRPG Card Forge: physical card planning failed', error);
			if (
				generation === this.previewGeneration
				&& this.currentPreviewPlanKey === lookup.identity.key
				&& this.previewRequestGate.isCurrent(requestToken)
				&& this.cardHostElement
			) {
				this.currentPreviewPlanKey = undefined;
				this.cardHostElement.empty();
				this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Physical card planning failed. See the developer console.' });
			}
		}
	}

	private applyPhysicalPlanToPreview(
		item: ItemCardData,
		lookup: PhysicalPlanLookup,
		plan: FittedItemCardPlan,
		generation: number,
		requestToken: LatestRequestToken<string>,
	): void {
		if (
			generation !== this.previewGeneration
			|| this.selectedFilePath !== item.filePath
			|| this.currentPreviewPlanKey !== lookup.identity.key
			|| !this.previewRequestGate.isCurrent(requestToken)
		) {
			return;
		}
		this.previewPages = plan.pages;
		this.unfitPageIndexes = plan.unfitPageIndexes;
		this.currentArtworkResourcePath = lookup.artworkResourcePath;
		this.currentArtworkRevisionFingerprint = lookup.artworkRevisionFingerprint;
		this.currentPageIndex = Math.min(
			this.currentPageIndex,
			Math.max(0, plan.pages.length - 1),
		);
		this.renderCurrentPage();
	}

	private beginPhysicalPlanLookup(item: ItemCardData): PhysicalPlanLookup {
		const trace = this.planningPerformance.start(item.name, 'physical-plan');
		const request = this.createPhysicalPlanRequest(item, trace);
		if (!request.indexIsCurrent) {
			trace?.finish({ cacheStatus: 'miss' });
			return {
				...request,
				cacheStatus: 'miss',
			};
		}
		const cacheStatus = this.physicalPlanCache.getStatus(request.identity);
		const completed = cacheStatus === 'hit'
			? this.physicalPlanCache.peek(request.identity)
			: undefined;
		if (completed) {
			trace?.finish({
				cacheStatus,
				pageCount: completed.pages.length,
				planSignature: serializeFittedItemCardPlanSignature(completed),
			});
			return {
				...request,
				cacheStatus,
				completed,
				promise: Promise.resolve(completed),
			};
		}
		const plan = this.physicalPlanCache.getOrCreate(
				request.identity,
				() => this.cardFitService.fit(
					this.containerEl.ownerDocument,
					item,
					request.artworkResourcePath,
					trace,
					request.artworkRevisionFingerprint,
				),
			);
		const tracedPlan = plan.then(
			(result) => {
				trace?.finish({
					cacheStatus,
					pageCount: result.pages.length,
					planSignature: serializeFittedItemCardPlanSignature(result),
				});
				return result;
			},
			(error: unknown) => {
				trace?.finish({ cacheStatus });
				throw error;
			},
		);
		return {
			...request,
			cacheStatus,
			promise: tracedPlan,
		};
	}

	private createPhysicalPlanRequest(
		item: ItemCardData,
		trace?: ReturnType<PlanningPerformanceMonitor['start']>,
	): Pick<
		PhysicalPlanLookup,
		'identity' | 'indexIsCurrent' | 'artworkResourcePath' | 'artworkRevisionFingerprint'
	> {
		const resolveArtwork = () => resolveArtworkDescriptor(this.app, item);
		const artwork = trace
			? trace.measure('artworkResolution', resolveArtwork)
			: resolveArtwork();
		const createRequest = () => {
			const indexedSourceRevision = this.itemIndex.getSourceRevision(item.filePath);
			const sourceFile = this.app.vault.getFileByPath(item.filePath);
			const indexIsCurrent = isIndexedPlanningInputCurrent(
				indexedSourceRevision,
				sourceFile
					? {
						modifiedTime: sourceFile.stat.mtime,
						size: sourceFile.stat.size,
					}
					: undefined,
				item.hasImage,
				Boolean(artwork),
			);
			const identity = createPhysicalPlanCacheIdentity({
				item,
				sourceFingerprint: this.itemIndex.getSourceFingerprint(item.filePath)
					?? createEffectiveItemFingerprint(item),
				...(artwork
					? {
						artworkFingerprint: {
							filePath: artwork.filePath,
							modifiedTime: artwork.modifiedTime,
							size: artwork.size,
						},
					}
					: {}),
				renderSettingsFingerprint: PHYSICAL_PLAN_RENDER_SETTINGS_FINGERPRINT,
			});
			return {
				identity,
				indexIsCurrent,
				...(artwork
					? {
						artworkResourcePath: artwork.resourcePath,
						artworkRevisionFingerprint: artwork.revisionFingerprint,
					}
					: {}),
			};
		};
		return trace
			? trace.measure('itemDataResolution', createRequest)
			: createRequest();
	}

	private renderCurrentPage(): void {
		if (!this.cardHostElement) {
			return;
		}
		const pageRenderGeneration = ++this.pageRenderGeneration;
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
		const renderTrace = this.planningPerformance.start(page.item.name, 'preview-render');
		const rendered = renderTrace
			? renderTrace.measure(
				'previewRendering',
				() => this.cardRenderer.render(
					physicalHost,
					page,
					this.currentArtworkResourcePath,
					this.currentArtworkRevisionFingerprint,
				),
			)
			: this.cardRenderer.render(
				physicalHost,
				page,
				this.currentArtworkResourcePath,
				this.currentArtworkRevisionFingerprint,
			);
		void rendered.artworkReady.finally(() => renderTrace?.finish({
			pageCount: page.pageCount,
		}));
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
			pageRenderGeneration,
			scalePhysicalCard,
		);
	}

	private renderQueue(): void {
		const generation = ++this.queuePlanGeneration;
		this.queueRequestGate.invalidate();
		const entries = this.printQueue.getEntries();
		const items = this.itemIndex.getItems();
		const itemsByPath = new Map(items.map((item) => [item.filePath, item]));
		const warmPlans = new Map<string, PhysicalItemPlan>();
		const queueItemPaths = new Set<string>();
		let indexIsStale = false;
		const currentPlansByPath = new Map(
			this.currentQueuePlan
				.filter((resolved) => resolved.item && !resolved.unavailable)
				.map((resolved) => [resolved.entry.filePath, resolved] as const),
		);
		for (const entry of entries) {
			const item = itemsByPath.get(entry.filePath);
			if (!item || queueItemPaths.has(item.filePath)) {
				continue;
			}
			queueItemPaths.add(item.filePath);
			const request = this.createPhysicalPlanRequest(item);
			if (!request.indexIsCurrent) {
				indexIsStale = true;
				continue;
			}
			const currentPlan = currentPlansByPath.get(item.filePath);
			if (currentPlan?.cacheKey === request.identity.key) {
				warmPlans.set(item.filePath, {
					pages: currentPlan.pages,
					unfitPageIndexes: currentPlan.unfitPageIndexes,
					cacheKey: currentPlan.cacheKey,
					...(currentPlan.artworkResourcePath
						? { artworkResourcePath: currentPlan.artworkResourcePath }
						: {}),
					...(currentPlan.artworkRevisionFingerprint
						? {
							artworkRevisionFingerprint:
								currentPlan.artworkRevisionFingerprint,
						}
						: {}),
				});
				continue;
			}
			const completed = this.physicalPlanCache.peek(request.identity);
			if (completed) {
				warmPlans.set(
					item.filePath,
					this.createQueuePhysicalPlan(request, completed),
				);
			}
		}
		if (indexIsStale) {
			this.currentQueuePlan = [];
			this.renderQueuePlanningState(entries.length, 'Updating the item index…');
			return;
		}

		if (warmPlans.size === queueItemPaths.size) {
			this.currentQueuePlan = resolvePrintQueue(entries, items, warmPlans);
			this.renderResolvedQueue();
			return;
		}

		this.currentQueuePlan = [];
		this.renderQueuePlanningState(entries.length);
		const requestToken = this.queueRequestGate.begin(generation);
		void this.planQueue(requestToken, entries, items, warmPlans);
	}

	private async planQueue(
		requestToken: LatestRequestToken<number>,
		entries: ReturnType<PrintQueueService['getEntries']>,
		items: readonly ItemCardData[],
		warmPlans: ReadonlyMap<string, PhysicalItemPlan>,
	): Promise<void> {
		let plans: Map<string, PhysicalItemPlan>;
		try {
			const itemsByPath = new Map(items.map((item) => [item.filePath, item]));
			const availableEntries = entries.filter(
				(entry) => itemsByPath.has(entry.filePath),
			);
			plans = await resolveQueuePlanMap(
				availableEntries,
				warmPlans,
				async (filePath) => {
					const item = itemsByPath.get(filePath);
					if (!item) {
						throw new Error(`Indexed queue item disappeared: ${filePath}`);
					}
					const lookup = this.beginPhysicalPlanLookup(item);
					if (!lookup.indexIsCurrent || !lookup.promise) {
						throw new ItemIndexStaleError();
					}
					return this.createQueuePhysicalPlan(
						lookup,
						await lookup.promise,
					);
				},
				() => this.queueRequestGate.isCurrent(requestToken),
			);
		} catch (error) {
			if (error instanceof ItemIndexStaleError) {
				if (this.queueRequestGate.isCurrent(requestToken)) {
					this.currentQueuePlan = [];
					this.renderQueuePlanningState(
						entries.length,
						'Updating the item index…',
					);
				}
				return;
			}
			console.error('TTRPG Card Forge: print queue planning failed', error);
			if (
				this.queueRequestGate.isCurrent(requestToken)
				&& this.queueStatusElement
			) {
				this.currentQueuePlan = [];
				this.queueStatusElement.setText('Queue planning failed. See the developer console.');
				this.updateExportControls();
			}
			return;
		}

		if (!this.queueRequestGate.isCurrent(requestToken)) {
			return;
		}
		this.currentQueuePlan = resolvePrintQueue(entries, items, plans);
		this.renderResolvedQueue();
	}

	private createQueuePhysicalPlan(
		request: Pick<
			PhysicalPlanLookup,
			'identity' | 'artworkResourcePath' | 'artworkRevisionFingerprint'
		>,
		plan: FittedItemCardPlan,
	): PhysicalItemPlan {
		return {
			pages: plan.pages,
			unfitPageIndexes: plan.unfitPageIndexes,
			cacheKey: request.identity.key,
			...(request.artworkResourcePath
				? { artworkResourcePath: request.artworkResourcePath }
				: {}),
			...(request.artworkRevisionFingerprint
				? {
					artworkRevisionFingerprint:
						request.artworkRevisionFingerprint,
				}
				: {}),
		};
	}

	private renderQueuePlanningState(
		entryCount: number,
		message = 'Planning physical cards…',
	): void {
		if (!this.queueListElement || !this.queueSummaryElement) {
			return;
		}
		this.queueListElement.empty();
		this.queueSummaryElement.setText(entryCount > 0 ? message : '0 item types · 0 copies · 0 physical cards · 0 A4 pages');
		if (entryCount === 0) {
			this.queueListElement.createDiv({ cls: 'ttrpg-card-forge__empty', text: 'Add an item from the card preview.' });
		}
		this.renderSheetPreview();
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
				this.cardRenderer.render(
					host,
					card.page,
					card.artworkResourcePath,
					card.artworkRevisionFingerprint,
				);
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
		if (!this.isCurrentQueuePlanInput()) {
			this.renderQueue();
			new Notice('Card inputs changed. Wait for the print queue to finish planning, then export again.');
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

	private isCurrentQueuePlanInput(): boolean {
		const availablePlans = this.currentQueuePlan.flatMap((resolved) =>
			resolved.item && !resolved.unavailable
				? [{
					filePath: resolved.item.filePath,
					...(resolved.cacheKey ? { cacheKey: resolved.cacheKey } : {}),
				}]
				: [],
		);
		const itemsByPath = new Map(
			this.itemIndex.getItems().map((item) => [item.filePath, item]),
		);
		return areQueuePlanInputsCurrent(availablePlans, (filePath) => {
			const item = itemsByPath.get(filePath);
			if (!item) {
				return undefined;
			}
			const request = this.createPhysicalPlanRequest(item);
			return request.indexIsCurrent ? request.identity.key : undefined;
		});
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
		const next = selectRelativePageIndex(
			this.currentPageIndex,
			offset,
			this.previewPages.length,
		);
		if (next !== this.currentPageIndex) {
			this.currentPageIndex = next;
			this.renderCurrentPage();
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
		pageRenderGeneration: number,
		onResize: () => void,
	): void {
		if (!this.diagnosticsElement) {
			return;
		}
		let artworkResult: ArtworkLoadResult | undefined;
		const update = (): void => {
			if (
				!this.diagnosticsElement
				|| pageRenderGeneration !== this.pageRenderGeneration
			) {
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
			if (pageRenderGeneration === this.pageRenderGeneration) {
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

class ItemIndexStaleError extends Error {
	constructor() {
		super('The item index changed while physical cards were being planned.');
		this.name = 'ItemIndexStaleError';
	}
}
