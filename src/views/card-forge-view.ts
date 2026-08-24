import {
	ItemView,
	MarkdownRenderer,
	Notice,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from 'obsidian';

import { PdfExportService, type PdfExportProgress } from '../export/pdf-export-service';
import { A4_CARDS_PER_SHEET } from '../export/a4-sheet-geometry';
import type { ItemCardData } from '../models/item';
import type { ItemCardPage } from '../models/item-card-page';
import type { PrintQueueService } from '../models/print-queue';
import type {
	SavedPrintSet,
	SavedPrintSetService,
} from '../models/saved-print-set';
import type { CardOverrides } from '../models/card-overrides';
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
	isSupportedArtworkPath,
	resolveArtworkDescriptor,
} from '../services/artwork-resolver';
import { ArtworkImporter } from '../services/artwork-importer';
import {
	areCardOverridesEqual,
	normalizeCardOverrides,
} from '../services/card-overrides';
import {
	createEffectiveCardInput,
	type EffectiveCardInput,
} from '../services/effective-card';
import {
	type CardEditorActionId,
	getCardEditorActions,
	hasExplicitDraftField,
	resetDraftField,
	selectDraftVariant,
} from '../services/card-editor-draft';
import {
	discoverItemVariants,
	getVariantDisplayLabel,
} from '../services/item-variants';
import type { ItemIndex } from '../services/item-index';
import {
	isIndexedPlanningInputCurrent,
	LatestRequestGate,
	reconcileVisibleSelection,
	selectRelativePageIndex,
	shouldRequestSelectedPlan,
	type LatestRequestToken,
} from '../services/planning-interactions';
import {
	applyItemBrowserInteraction,
	clearBatchSelection,
	createItemBrowserFilterOptions,
	DEFAULT_ITEM_BROWSER_FILTERS,
	filterIndexedItems,
	formatBrowserResultCount,
	getItemBrowserTypeText,
	isItemBrowserFiltered,
	removeBatchSelections,
	resolveBatchSelection,
	selectAllFilteredItems,
	type AttunementFilter,
	type ItemBrowserFilterOption,
	type ItemBrowserFilters,
} from '../services/item-browser-workflow';
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
import { DebouncedAction } from '../services/debounced-action';
import type { ArtworkImportPayload } from '../services/artwork-importer-core';
import { selectArtworkStorage } from '../services/artwork-selection';
import { loadSourceNote } from '../services/source-note';
import {
	isCurrentSourceNoteRender,
	SourceNoteScrollMemory,
} from '../services/source-note-scroll';
import type {
	TemporaryArtworkAsset,
	TemporaryArtworkStore,
} from '../services/temporary-artwork-store';
import {
	createMissingArtworkWarning,
	createPreviewModeState,
	createPreviewStatusChips,
	createTemporaryArtworkStatus,
	createVariantPreservationNotice,
	getArtworkEditorPresentation,
	isArtworkUseKey,
	resolveRulesDraftOverride,
	validateVaultArtworkPath,
	type ArtworkEditorMode,
	type PreviewMode,
	type VariantPreservationNotice,
} from '../services/live-edit-ui';
import {
	buildExportGalleryState,
	deleteGalleryExport,
	openGalleryExport,
	type ExportGalleryFileInfo,
} from '../services/export-gallery';
import { normalizeExportFolder } from '../export/vault-pdf-storage';
import {
	confirmWorkflowAction,
	promptForText,
} from './workflow-modals';

export const CARD_FORGE_VIEW_TYPE = 'ttrpg-card-forge-view';
const PHYSICAL_PLAN_RENDER_SETTINGS_FINGERPRINT = 'card-render-settings-v3-live-edit';
type WorkflowMode = 'queue' | 'saved-sets' | 'exports';

interface PhysicalPlanLookup {
	identity: PhysicalPlanCacheIdentity;
	indexIsCurrent: boolean;
	artworkResourcePath?: string;
	artworkRevisionFingerprint?: string;
	temporaryArtworkUnavailable?: boolean;
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
	private readonly artworkImporter: ArtworkImporter;
	private searchInput: HTMLInputElement | null = null;
	private typeFilterSelect: HTMLSelectElement | null = null;
	private rarityFilterSelect: HTMLSelectElement | null = null;
	private sourceFilterSelect: HTMLSelectElement | null = null;
	private attunementFilterSelect: HTMLSelectElement | null = null;
	private resetFiltersButton: HTMLButtonElement | null = null;
	private filteredCountElement: HTMLElement | null = null;
	private batchSelectedCountElement: HTMLElement | null = null;
	private addBatchButton: HTMLButtonElement | null = null;
	private selectAllFilteredButton: HTMLButtonElement | null = null;
	private clearBatchButton: HTMLButtonElement | null = null;
	private resultsElement: HTMLElement | null = null;
	private cardHostElement: HTMLElement | null = null;
	private diagnosticsElement: HTMLElement | null = null;
	private sourceNoteElement: HTMLElement | null = null;
	private sourceNoteContentElement: HTMLElement | null = null;
	private previewActionsElement: HTMLElement | null = null;
	private pageNavigationElement: HTMLElement | null = null;
	private previousPageButton: HTMLButtonElement | null = null;
	private nextPageButton: HTMLButtonElement | null = null;
	private pageLabelElement: HTMLElement | null = null;
	private addToQueueButton: HTMLButtonElement | null = null;
	private openSourceButton: HTMLButtonElement | null = null;
	private sourceNoteOpenButton: HTMLButtonElement | null = null;
	private editorElement: HTMLElement | null = null;
	private editorStatusElement: HTMLElement | null = null;
	private previewModeButton: HTMLButtonElement | null = null;
	private editModeButton: HTMLButtonElement | null = null;
	private sourceModeButton: HTMLButtonElement | null = null;
	private previewIndicatorElement: HTMLElement | null = null;
	private queueListElement: HTMLElement | null = null;
	private queueSummaryElement: HTMLElement | null = null;
	private queueStatusElement: HTMLElement | null = null;
	private exportButton: HTMLButtonElement | null = null;
	private clearQueueButton: HTMLButtonElement | null = null;
	private openLastPdfButton: HTMLButtonElement | null = null;
	private workflowQueueElement: HTMLElement | null = null;
	private workflowAuxElement: HTMLElement | null = null;
	private queueModeButton: HTMLButtonElement | null = null;
	private savedSetsModeButton: HTMLButtonElement | null = null;
	private exportsModeButton: HTMLButtonElement | null = null;
	private savePrintSetButton: HTMLButtonElement | null = null;
	private sheetGridElement: HTMLElement | null = null;
	private sheetLabelElement: HTMLElement | null = null;
	private previousSheetButton: HTMLButtonElement | null = null;
	private nextSheetButton: HTMLButtonElement | null = null;
	private selectedFilePath: string | null = null;
	private lastPdfFile: TFile | null = null;
	private unsubscribeFromIndex: (() => void) | null = null;
	private unsubscribeFromQueue: (() => void) | null = null;
	private unsubscribeFromSavedPrintSets: (() => void) | null = null;
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
	private workflowMode: WorkflowMode = 'queue';
	private exportGalleryGeneration = 0;
	private previewMode: PreviewMode = 'preview';
	private sourceNoteGeneration = 0;
	private sourceNoteScrollFrame: number | null = null;
	private readonly sourceNoteScrollMemory = new SourceNoteScrollMemory();
	private renderedSourceNotePath: string | undefined;
	private selectedBatchFilePaths = new Set<string>();
	private visibleBrowserItems: readonly ItemCardData[] = [];
	private lastBrowserItems: readonly ItemCardData[] | undefined;
	private draftOverrides: CardOverrides | undefined;
	private appliedOverrides: CardOverrides | undefined;
	private editingQueueEntryId: string | undefined;
	private readonly editorPreviewDebounce = new DebouncedAction(350);
	private readonly temporaryArtworkOwner = `view-${createRuntimeId()}`;
	private variantRulesNotice: VariantPreservationNotice | undefined;
	private artworkLoadGeneration = 0;
	private artworkEditorMode: ArtworkEditorMode | undefined;
	private artworkVaultPathDraft: string | undefined;
	private artworkHttpsUrl = '';
	private persistArtworkToVault = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly itemIndex: ItemIndex,
		private readonly printQueue: PrintQueueService,
		private readonly savedPrintSets: SavedPrintSetService,
		private readonly getSettings: () => Readonly<CardForgeSettings>,
		private readonly physicalPlanCache: PhysicalPlanCache<FittedItemCardPlan>,
		private readonly planningPerformance: PlanningPerformanceMonitor,
		private readonly temporaryArtworkStore: TemporaryArtworkStore,
	) {
		super(leaf);
		this.pdfExportService = new PdfExportService(this.app, this.cardRenderer);
		this.artworkImporter = new ArtworkImporter(this.app);
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

		const workspace = container.createDiv({ cls: 'ttrpg-card-forge__workspace' });
		this.buildBrowser(workspace);
		this.buildPreview(workspace);
		this.buildWorkflow(workspace);

		if (this.searchInput) {
			this.registerDomEvent(this.searchInput, 'input', () => {
				this.renderBrowser();
			});
		}
		for (const select of [
			this.typeFilterSelect,
			this.rarityFilterSelect,
			this.sourceFilterSelect,
			this.attunementFilterSelect,
		]) {
			if (select) {
				this.registerDomEvent(select, 'change', () => this.renderBrowser());
			}
		}
		if (this.resetFiltersButton) {
			this.registerDomEvent(this.resetFiltersButton, 'click', () => this.resetBrowserFilters());
		}
		if (this.addBatchButton) {
			this.registerDomEvent(this.addBatchButton, 'click', () => this.addBatchSelectionToQueue());
		}
		if (this.selectAllFilteredButton) {
			this.registerDomEvent(this.selectAllFilteredButton, 'click', () => {
				this.selectedBatchFilePaths = selectAllFilteredItems(
					this.selectedBatchFilePaths,
					this.visibleBrowserItems,
				);
				this.renderBrowser();
			});
		}
		if (this.clearBatchButton) {
			this.registerDomEvent(this.clearBatchButton, 'click', () => {
				this.selectedBatchFilePaths = clearBatchSelection();
				this.renderBrowser();
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
		if (this.sourceNoteOpenButton) {
			this.registerDomEvent(this.sourceNoteOpenButton, 'click', () => this.openSelectedItem());
		}
		if (this.clearQueueButton) {
			this.registerDomEvent(this.clearQueueButton, 'click', () => this.printQueue.clear());
		}
		if (this.savePrintSetButton) {
			this.registerDomEvent(this.savePrintSetButton, 'click', () => {
				void this.saveCurrentQueueAsPrintSet();
			});
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
		if (this.queueModeButton) {
			this.registerDomEvent(this.queueModeButton, 'click', () => this.setWorkflowMode('queue'));
		}
		if (this.savedSetsModeButton) {
			this.registerDomEvent(this.savedSetsModeButton, 'click', () => this.setWorkflowMode('saved-sets'));
		}
		if (this.exportsModeButton) {
			this.registerDomEvent(this.exportsModeButton, 'click', () => this.setWorkflowMode('exports'));
		}

		this.unsubscribeFromIndex = this.itemIndex.subscribe(() => {
			const selectionChanged = this.renderBrowser();
			if (selectionChanged) {
				this.resetEditorSession();
				this.renderEditor();
			}
			if (this.previewMode === 'source-note') {
				void this.renderSourceNote();
			} else {
				const selectedItem = this.findSelectedItem();
				const effective = selectedItem ? createEffectiveCardInput(
					selectedItem,
					this.itemIndex.getItems(),
					this.draftOverrides,
				) : undefined;
				const selectedIdentity = effective
					? this.createPhysicalPlanRequest(effective).identity.key
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
			}
			this.renderQueue();
		});
		this.unsubscribeFromQueue = this.printQueue.subscribe(() => {
			this.currentSheetIndex = 0;
			this.renderQueue();
		});
		this.unsubscribeFromSavedPrintSets = this.savedPrintSets.subscribe(() => {
			if (this.workflowMode === 'saved-sets') {
				this.renderSavedPrintSets();
			}
		});
		this.registerEvent(this.app.vault.on('create', (file) => {
			this.refreshExportsForVaultChange(file.path);
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.refreshExportsForVaultChange(file.path);
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.refreshExportsForVaultChange(file.path, oldPath);
		}));
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromQueue?.();
		this.unsubscribeFromSavedPrintSets?.();
		this.unsubscribeFromIndex = null;
		this.unsubscribeFromQueue = null;
		this.unsubscribeFromSavedPrintSets = null;
		if (this.overflowFrame !== null) {
			window.cancelAnimationFrame(this.overflowFrame);
		}
		this.editorPreviewDebounce.cancel();
		this.cardResizeObserver?.disconnect();
		this.previewGeneration += 1;
		this.queuePlanGeneration += 1;
		this.pageRenderGeneration += 1;
		this.previewRequestGate.invalidate();
		this.queueRequestGate.invalidate();
		this.sourceNoteGeneration += 1;
		this.exportGalleryGeneration += 1;
		this.rememberSourceNoteScroll();
		if (this.sourceNoteScrollFrame !== null) {
			window.cancelAnimationFrame(this.sourceNoteScrollFrame);
			this.sourceNoteScrollFrame = null;
		}
		this.artworkLoadGeneration += 1;
		this.temporaryArtworkStore.releaseOwner(this.temporaryArtworkOwner);
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
		const filters = toolbar.createDiv({
			cls: 'ttrpg-card-forge__filters',
			attr: { 'aria-label': 'Item filters' },
		});
		this.typeFilterSelect = this.createBrowserFilter(filters, 'Type');
		this.rarityFilterSelect = this.createBrowserFilter(filters, 'Rarity');
		this.sourceFilterSelect = this.createBrowserFilter(filters, 'Source');
		this.attunementFilterSelect = this.createBrowserFilter(filters, 'Attunement');
		this.appendFilterOptions(this.attunementFilterSelect, [
			{ value: 'required', label: 'Requires attunement' },
			{ value: 'none', label: 'No attunement' },
		]);
		this.resetFiltersButton = toolbar.createEl('button', {
			text: 'Reset filters',
			cls: 'ttrpg-card-forge__reset-filters',
			attr: { type: 'button' },
		});
		this.filteredCountElement = toolbar.createDiv({ cls: 'ttrpg-card-forge__filtered-count' });
		const batchToolbar = toolbar.createDiv({
			cls: 'ttrpg-card-forge__batch-toolbar',
			attr: { role: 'toolbar', 'aria-label': 'Batch item selection' },
		});
		this.batchSelectedCountElement = batchToolbar.createDiv({
			cls: 'ttrpg-card-forge__batch-count',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		const batchActions = batchToolbar.createDiv({ cls: 'ttrpg-card-forge__batch-actions' });
		this.addBatchButton = batchActions.createEl('button', {
			text: 'Add selected',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		this.selectAllFilteredButton = batchActions.createEl('button', {
			text: 'Select all filtered',
			attr: { type: 'button' },
		});
		this.clearBatchButton = batchActions.createEl('button', {
			text: 'Clear',
			attr: { type: 'button', 'aria-label': 'Clear all batch selections' },
		});
		this.resultsElement = browser.createDiv({
			cls: 'ttrpg-card-forge__results',
			attr: { role: 'list', 'aria-label': 'Indexed items' },
		});
	}

	private createBrowserFilter(container: HTMLElement, label: string): HTMLSelectElement {
		const control = container.createEl('label', { cls: 'ttrpg-card-forge__filter' });
		control.createSpan({ text: label });
		const select = control.createEl('select', {
			cls: 'dropdown ttrpg-card-forge__filter-select',
			attr: { 'aria-label': `${label} filter` },
		});
		this.appendFilterOptions(select, []);
		return select;
	}

	private appendFilterOptions(
		select: HTMLSelectElement,
		options: readonly ItemBrowserFilterOption[],
	): void {
		select.empty();
		select.createEl('option', { text: 'All', value: '' });
		for (const option of options) {
			select.createEl('option', { value: option.value, text: option.label });
		}
	}

	private buildPreview(workspace: HTMLElement): void {
		const preview = workspace.createEl('section', {
			cls: 'ttrpg-card-forge__preview',
			attr: { 'aria-label': 'Card preview' },
		});
		const previewHeader = preview.createDiv({ cls: 'ttrpg-card-forge__preview-header' });
		previewHeader.createEl('h3', {
			text: 'Card preview',
			cls: 'ttrpg-card-forge__panel-heading',
		});
		const previewToolbar = previewHeader.createDiv({
			cls: 'ttrpg-card-forge__preview-toolbar',
			attr: { role: 'toolbar', 'aria-label': 'Card preview controls' },
		});
		const modeToggle = previewToolbar.createDiv({
			cls: 'ttrpg-card-forge__mode-toggle',
			attr: { 'aria-label': 'Preview mode' },
		});
		this.previewModeButton = modeToggle.createEl('button', {
			text: 'Preview',
			attr: { type: 'button', 'aria-pressed': 'true' },
		});
		this.editModeButton = modeToggle.createEl('button', {
			text: 'Edit card',
			attr: { type: 'button', 'aria-pressed': 'false' },
		});
		this.sourceModeButton = modeToggle.createEl('button', {
			text: 'Source note',
			attr: { type: 'button', 'aria-pressed': 'false' },
		});
		this.pageNavigationElement = previewToolbar.createDiv({
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
		this.previewIndicatorElement = previewToolbar.createDiv({
			cls: 'ttrpg-card-forge__preview-indicator',
			attr: { 'aria-label': 'Card state' },
		});
		this.registerDomEvent(this.previewModeButton, 'click', () => this.setPreviewMode('preview'));
		this.registerDomEvent(this.editModeButton, 'click', () => this.setPreviewMode('edit'));
		this.registerDomEvent(this.sourceModeButton, 'click', () => this.setPreviewMode('source-note'));
		this.editorElement = preview.createDiv({ cls: 'ttrpg-card-forge__editor' });
		this.editorElement.hidden = true;
		const previewRegion = preview.createDiv({ cls: 'ttrpg-card-forge__card-preview-region' });
		const previewBlock = previewRegion.createDiv({ cls: 'ttrpg-card-forge__card-preview-block' });
		this.cardHostElement = previewBlock.createDiv({ cls: 'ttrpg-card-forge__card-host' });
		this.diagnosticsElement = previewBlock.createDiv({ cls: 'ttrpg-card-forge__diagnostics' });
		this.sourceNoteElement = preview.createDiv({
			cls: 'ttrpg-card-forge__source-note',
			attr: { 'aria-label': 'Original source note' },
		});
		this.sourceNoteElement.hidden = true;
		this.sourceNoteContentElement = this.sourceNoteElement.createDiv({
			cls: 'ttrpg-card-forge__source-note-content markdown-rendered',
		});
		const sourceActions = this.sourceNoteElement.createDiv({ cls: 'ttrpg-card-forge__source-note-actions' });
		this.sourceNoteOpenButton = sourceActions.createEl('button', {
			text: 'Open source note',
			attr: { type: 'button' },
		});
		this.previewActionsElement = preview.createDiv({ cls: 'ttrpg-card-forge__preview-actions' });
		const actions = this.previewActionsElement;
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

	private buildWorkflow(workspace: HTMLElement): void {
		const queue = workspace.createEl('section', {
			cls: 'ttrpg-card-forge__queue ttrpg-card-forge__workflow',
			attr: { 'aria-label': 'Card Forge workflow' },
		});
		const queueHeader = queue.createDiv({ cls: 'ttrpg-card-forge__queue-header' });
		queueHeader.createEl('h3', {
			text: 'Workflow',
			cls: 'ttrpg-card-forge__panel-heading',
		});
		const modeToggle = queueHeader.createDiv({
			cls: 'ttrpg-card-forge__workflow-toggle',
			attr: { role: 'tablist', 'aria-label': 'Workflow mode' },
		});
		this.queueModeButton = this.createWorkflowModeButton(modeToggle, 'Print queue', 'queue');
		this.savedSetsModeButton = this.createWorkflowModeButton(modeToggle, 'Saved sets', 'saved-sets');
		this.exportsModeButton = this.createWorkflowModeButton(modeToggle, 'Exports', 'exports');

		this.workflowQueueElement = queue.createDiv({ cls: 'ttrpg-card-forge__workflow-queue' });
		const queueActions = this.workflowQueueElement.createDiv({
			cls: 'ttrpg-card-forge__queue-actions',
		});
		this.savePrintSetButton = queueActions.createEl('button', {
			text: 'Save print set',
			attr: { type: 'button' },
		});
		this.clearQueueButton = queueActions.createEl('button', {
			text: 'Clear',
			attr: { type: 'button', 'aria-label': 'Clear print queue' },
		});
		this.queueSummaryElement = this.workflowQueueElement.createDiv({ cls: 'ttrpg-card-forge__queue-summary' });
		this.queueListElement = this.workflowQueueElement.createDiv({ cls: 'ttrpg-card-forge__queue-list' });

		const sheetPreview = this.workflowQueueElement.createDiv({ cls: 'ttrpg-card-forge__sheet-preview' });
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

		this.queueStatusElement = this.workflowQueueElement.createDiv({
			cls: 'ttrpg-card-forge__queue-status',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		const exportActions = this.workflowQueueElement.createDiv({ cls: 'ttrpg-card-forge__export-actions' });
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
		this.workflowAuxElement = queue.createDiv({ cls: 'ttrpg-card-forge__workflow-aux' });
		this.workflowAuxElement.hidden = true;
		this.updateWorkflowModePresentation();
	}

	private createWorkflowModeButton(
		container: HTMLElement,
		label: string,
		mode: WorkflowMode,
	): HTMLButtonElement {
		return container.createEl('button', {
			text: label,
			attr: {
				type: 'button',
				role: 'tab',
				'aria-selected': String(this.workflowMode === mode),
			},
		});
	}

	private render(): void {
		this.renderBrowser();
		this.renderEditor();
		this.renderPreview();
		this.renderQueue();
	}

	private setWorkflowMode(mode: WorkflowMode): void {
		this.workflowMode = mode;
		this.updateWorkflowModePresentation();
		if (mode === 'saved-sets') {
			this.renderSavedPrintSets();
		} else if (mode === 'exports') {
			void this.renderExportGallery();
		}
	}

	private updateWorkflowModePresentation(): void {
		const buttons = [
			[this.queueModeButton, 'queue'],
			[this.savedSetsModeButton, 'saved-sets'],
			[this.exportsModeButton, 'exports'],
		] as const;
		for (const [button, mode] of buttons) {
			button?.toggleClass('is-active', this.workflowMode === mode);
			button?.setAttribute('aria-selected', String(this.workflowMode === mode));
		}
		if (this.workflowQueueElement) {
			this.workflowQueueElement.hidden = this.workflowMode !== 'queue';
		}
		if (this.workflowAuxElement) {
			this.workflowAuxElement.hidden = this.workflowMode === 'queue';
		}
	}

	private async saveCurrentQueueAsPrintSet(): Promise<void> {
		const entries = this.printQueue.getEntries();
		if (entries.length === 0) {
			new Notice('Add at least one item before saving a print set.');
			return;
		}
		const name = await promptForText(this.app, {
			title: 'Save print set',
			label: 'Name',
			confirmLabel: 'Save',
		});
		if (name === null) {
			return;
		}
		let result = this.savedPrintSets.save(name, entries);
		if (result.status === 'duplicate-name') {
			const replace = await confirmWorkflowAction(
				this.app,
				'Replace saved print set?',
				`A saved set named “${result.existing.name}” already exists. Replace it with the current queue?`,
				'Replace',
			);
			if (!replace) {
				return;
			}
			result = this.savedPrintSets.save(name, entries, true);
		}
		if (result.status === 'invalid-name') {
			new Notice('Saved print set name cannot be blank.');
			return;
		}
		if (result.status !== 'created' && result.status !== 'replaced') {
			return;
		}
		new Notice(result.containsTemporaryArtwork
			? `Saved “${result.set.name}”. Temporary artwork may need to be selected again after restart.`
			: `Saved print set “${result.set.name}”.`);
	}

	private renderSavedPrintSets(): void {
		if (!this.workflowAuxElement || this.workflowMode !== 'saved-sets') {
			return;
		}
		this.workflowAuxElement.empty();
		const sets = this.savedPrintSets.getSets();
		this.workflowAuxElement.createDiv({
			cls: 'ttrpg-card-forge__workflow-summary',
			text: `${sets.length} saved ${sets.length === 1 ? 'set' : 'sets'}`,
		});
		if (sets.length === 0) {
			this.workflowAuxElement.createDiv({
				cls: 'ttrpg-card-forge__empty',
				text: 'No saved print sets yet.',
			});
			return;
		}
		const list = this.workflowAuxElement.createDiv({ cls: 'ttrpg-card-forge__saved-set-list' });
		for (const set of sets) {
			this.renderSavedPrintSetRow(list, set);
		}
	}

	private renderSavedPrintSetRow(container: HTMLElement, set: SavedPrintSet): void {
		const row = container.createDiv({ cls: 'ttrpg-card-forge__saved-set' });
		const details = row.createDiv({ cls: 'ttrpg-card-forge__saved-set-details' });
		details.createDiv({ cls: 'ttrpg-card-forge__saved-set-name', text: set.name });
		const copies = set.entries.reduce((sum, entry) => sum + entry.quantity, 0);
		details.createDiv({
			cls: 'ttrpg-card-forge__saved-set-meta',
			text: `${set.entries.length} ${set.entries.length === 1 ? 'entry' : 'entries'} · ${copies} ${copies === 1 ? 'copy' : 'copies'} · ${formatWorkflowDate(set.updatedAt)}`,
		});
		const actions = row.createDiv({ cls: 'ttrpg-card-forge__saved-set-actions' });
		appendQueueButton(actions, 'Load', `Load saved print set ${set.name}`, () => {
			void this.loadSavedPrintSet(set.id);
		});
		appendQueueButton(actions, 'Rename', `Rename saved print set ${set.name}`, () => {
			void this.renameSavedPrintSet(set.id);
		});
		appendQueueButton(actions, 'Delete', `Delete saved print set ${set.name}`, () => {
			void this.deleteSavedPrintSet(set.id);
		});
	}

	private async loadSavedPrintSet(id: string): Promise<void> {
		const available = new Set(this.itemIndex.getItems().map((item) => item.filePath));
		let result = this.savedPrintSets.loadIntoQueue(id, this.printQueue, available);
		if (result.status === 'requires-confirmation') {
			const replace = await confirmWorkflowAction(
				this.app,
				'Replace current print queue?',
				`Loading “${result.set.name}” will replace the current print queue.`,
				'Replace queue',
			);
			if (!replace) {
				return;
			}
			result = this.savedPrintSets.loadIntoQueue(id, this.printQueue, available, true);
		}
		if (result.status === 'not-found') {
			new Notice('That saved print set is no longer available.');
			return;
		}
		if (result.status === 'no-resolvable-entries') {
			new Notice('No saved items could be found. The current print queue was left unchanged.');
			return;
		}
		if (result.status !== 'loaded') {
			return;
		}
		if (this.editingQueueEntryId && !this.printQueue.getEntry(this.editingQueueEntryId)) {
			this.resetEditorSession();
			this.renderEditor();
			if (this.previewMode !== 'source-note') {
				this.renderPreview();
			}
		}
		const missing = result.missingCount > 0
			? ` ${result.missingCount} saved ${result.missingCount === 1 ? 'item was' : 'items were'} not found.`
			: '';
		const temporary = result.containsTemporaryArtwork
			? ' Temporary artwork may need to be selected again.'
			: '';
		new Notice(`Loaded ${result.entries.length} ${result.entries.length === 1 ? 'entry' : 'entries'} (${result.totalCopies} ${result.totalCopies === 1 ? 'copy' : 'copies'}).${missing}${temporary}`);
	}

	private async renameSavedPrintSet(id: string): Promise<void> {
		const set = this.savedPrintSets.getSet(id);
		if (!set) {
			return;
		}
		const name = await promptForText(this.app, {
			title: 'Rename saved print set',
			label: 'Name',
			initialValue: set.name,
			confirmLabel: 'Rename',
		});
		if (name === null) {
			return;
		}
		const result = this.savedPrintSets.rename(id, name);
		if (result.status === 'invalid-name') {
			new Notice('Saved print set name cannot be blank.');
		} else if (result.status === 'duplicate-name') {
			new Notice(`A saved print set named “${result.existing.name}” already exists.`);
		} else if (result.status === 'renamed') {
			new Notice(`Renamed saved print set to “${result.set.name}”.`);
		}
	}

	private async deleteSavedPrintSet(id: string): Promise<void> {
		const set = this.savedPrintSets.getSet(id);
		if (!set) {
			return;
		}
		const confirmed = await confirmWorkflowAction(
			this.app,
			'Delete saved print set?',
			`Delete “${set.name}”? The current queue, source notes, artwork, and PDFs will not be changed.`,
			'Delete',
		);
		if (confirmed && this.savedPrintSets.delete(id)) {
			new Notice(`Deleted saved print set “${set.name}”.`);
		}
	}

	async onPdfExportFolderChanged(): Promise<void> {
		if (this.workflowMode === 'exports') {
			await this.renderExportGallery();
		}
	}

	private async renderExportGallery(): Promise<void> {
		if (!this.workflowAuxElement || this.workflowMode !== 'exports') {
			return;
		}
		const generation = ++this.exportGalleryGeneration;
		const exportFolder = normalizeExportFolder(this.getSettings().pdfExportFolder);
		let state: ReturnType<typeof buildExportGalleryState>;
		try {
			const folder = this.app.vault.getAbstractFileByPath(exportFolder);
			state = !folder
				? buildExportGalleryState({ status: 'missing' })
				: folder instanceof TFolder
					? buildExportGalleryState({
						status: 'ready',
						files: folder.children
							.filter((file): file is TFile => file instanceof TFile)
							.map((file) => ({
								path: file.path,
								name: file.name,
								modifiedTime: file.stat.mtime,
								size: file.stat.size,
							})),
					})
					: buildExportGalleryState({ status: 'unreadable' });
		} catch (error) {
			console.warn('TTRPG Card Forge: export folder could not be read', error);
			state = buildExportGalleryState({ status: 'unreadable' });
		}
		if (
			generation !== this.exportGalleryGeneration
			|| !this.workflowAuxElement
			|| this.workflowMode !== 'exports'
		) {
			return;
		}
		this.workflowAuxElement.empty();
		this.workflowAuxElement.createDiv({
			cls: 'ttrpg-card-forge__workflow-summary',
			text: `${state.entries.length} Card Forge ${state.entries.length === 1 ? 'export' : 'exports'}`,
		});
		if (state.status === 'unreadable') {
			this.workflowAuxElement.createDiv({
				cls: 'ttrpg-card-forge__empty is-warning',
				text: 'Export folder could not be read.',
			});
			return;
		}
		if (state.entries.length === 0) {
			this.workflowAuxElement.createDiv({
				cls: 'ttrpg-card-forge__empty',
				text: 'No Card Forge exports yet.',
			});
			return;
		}
		const list = this.workflowAuxElement.createDiv({ cls: 'ttrpg-card-forge__export-list' });
		for (const entry of state.entries) {
			this.renderExportGalleryRow(list, entry);
		}
	}

	private renderExportGalleryRow(
		container: HTMLElement,
		entry: ExportGalleryFileInfo,
	): void {
		const row = container.createDiv({ cls: 'ttrpg-card-forge__export-entry' });
		const details = row.createDiv({ cls: 'ttrpg-card-forge__export-entry-details' });
		details.createDiv({ cls: 'ttrpg-card-forge__export-entry-name', text: entry.name });
		details.createDiv({
			cls: 'ttrpg-card-forge__export-entry-meta',
			text: `${formatWorkflowDate(entry.modifiedTime)} · ${formatFileSize(entry.size)}`,
		});
		const actions = row.createDiv({ cls: 'ttrpg-card-forge__export-entry-actions' });
		appendQueueButton(actions, 'Open', `Open ${entry.name}`, () => {
			void this.openGalleryEntry(entry);
		});
		appendQueueButton(actions, 'Delete', `Delete ${entry.name}`, () => {
			void this.deleteGalleryEntry(entry);
		});
	}

	private async openGalleryEntry(entry: ExportGalleryFileInfo): Promise<void> {
		try {
			const opened = await openGalleryExport(entry, async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile) || file.name !== entry.name) {
					throw new Error('Export file is no longer available.');
				}
				await this.openPdf(file);
			});
			if (!opened) {
				new Notice('That file is not a recognized Card Forge export.');
			}
		} catch (error) {
			console.warn('TTRPG Card Forge: export could not be opened', error);
			new Notice('Card Forge could not open that export.');
		}
	}

	private async deleteGalleryEntry(entry: ExportGalleryFileInfo): Promise<void> {
		const selected = this.app.vault.getAbstractFileByPath(entry.path);
		if (!(selected instanceof TFile) || selected.name !== entry.name) {
			new Notice('That export is no longer available.');
			await this.renderExportGallery();
			return;
		}
		try {
			const confirmed = await this.app.fileManager.promptForDeletion(selected);
			await deleteGalleryExport(entry, confirmed, async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile) || file.name !== entry.name) {
					throw new Error('Export file is no longer available.');
				}
				await this.app.fileManager.trashFile(file);
			});
		} catch (error) {
			console.warn('TTRPG Card Forge: export could not be deleted', error);
			new Notice('Card Forge could not delete that export.');
		}
		await this.renderExportGallery();
	}

	private refreshExportsForVaultChange(path: string, oldPath?: string): void {
		if (this.workflowMode !== 'exports') {
			return;
		}
		const folder = normalizeExportFolder(this.getSettings().pdfExportFolder);
		if (isDirectChildPath(path, folder) || (oldPath && isDirectChildPath(oldPath, folder))) {
			void this.renderExportGallery();
		}
	}

	private renderBrowser(): boolean {
		if (!this.resultsElement || !this.filteredCountElement) {
			return false;
		}
		const allItems = this.itemIndex.getItems();
		if (this.lastBrowserItems !== allItems) {
			this.lastBrowserItems = allItems;
			this.populateBrowserFilterOptions(allItems);
		}
		const filters = this.getBrowserFilters();
		const visibleItems = filterIndexedItems(allItems, filters);
		this.visibleBrowserItems = visibleItems;
		const filtered = isItemBrowserFiltered(filters);
		this.filteredCountElement.setText(formatBrowserResultCount(
			visibleItems.length,
			allItems.length,
			filtered,
		));

		const selection = reconcileVisibleSelection(
			this.selectedFilePath,
			allItems.map((item) => item.filePath),
		);
		this.selectedFilePath = selection.selectedFilePath;
		if (selection.selectionChanged) {
			this.currentPageIndex = 0;
		}
		this.renderItemList(visibleItems, filtered);
		this.updateBatchToolbar();
		this.resetFiltersButton?.toggleAttribute('disabled', !filtered);
		return selection.selectionChanged;
	}

	private populateBrowserFilterOptions(items: readonly ItemCardData[]): void {
		const options = createItemBrowserFilterOptions(items);
		for (const [select, nextOptions] of [
			[this.typeFilterSelect, options.types],
			[this.rarityFilterSelect, options.rarities],
			[this.sourceFilterSelect, options.sources],
		] as const) {
			if (!select) {
				continue;
			}
			const currentValue = select.value;
			this.appendFilterOptions(select, nextOptions);
			select.value = nextOptions.some((option) => option.value === currentValue)
				? currentValue
				: '';
		}
	}

	private getBrowserFilters(): ItemBrowserFilters {
		return {
			query: this.searchInput?.value ?? DEFAULT_ITEM_BROWSER_FILTERS.query,
			type: this.typeFilterSelect?.value ?? DEFAULT_ITEM_BROWSER_FILTERS.type,
			rarity: this.rarityFilterSelect?.value ?? DEFAULT_ITEM_BROWSER_FILTERS.rarity,
			source: this.sourceFilterSelect?.value ?? DEFAULT_ITEM_BROWSER_FILTERS.source,
			attunement: (this.attunementFilterSelect?.value || 'all') as AttunementFilter,
		};
	}

	private resetBrowserFilters(): void {
		if (this.searchInput) {
			this.searchInput.value = '';
		}
		for (const select of [
			this.typeFilterSelect,
			this.rarityFilterSelect,
			this.sourceFilterSelect,
			this.attunementFilterSelect,
		]) {
			if (select) {
				select.value = '';
			}
		}
		this.renderBrowser();
	}

	private updateBatchToolbar(): void {
		const selectedCount = this.selectedBatchFilePaths.size;
		this.batchSelectedCountElement?.setText(
			`${selectedCount} ${selectedCount === 1 ? 'item' : 'items'} selected`,
		);
		if (this.addBatchButton) {
			this.addBatchButton.disabled = selectedCount === 0;
		}
		if (this.clearBatchButton) {
			this.clearBatchButton.disabled = selectedCount === 0;
		}
		if (this.selectAllFilteredButton) {
			this.selectAllFilteredButton.disabled = this.visibleBrowserItems.length === 0;
		}
	}

	private renderItemList(items: readonly ItemCardData[], filtered: boolean): void {
		if (!this.resultsElement) {
			return;
		}
		this.resultsElement.empty();
		if (items.length === 0) {
			this.resultsElement.createDiv({
				cls: 'ttrpg-card-forge__empty',
				text: filtered
					? 'No indexed items match the current search and filters.'
					: 'No items are indexed. Check settings and rebuild the index.',
			});
			return;
		}

		for (const item of items) {
			const isPreviewSelected = item.filePath === this.selectedFilePath;
			const isBatchSelected = this.selectedBatchFilePaths.has(item.filePath);
			const result = this.resultsElement.createDiv({
				cls: [
					'ttrpg-card-forge__result',
					isPreviewSelected ? 'is-selected' : '',
					isBatchSelected ? 'is-batch-selected' : '',
				].filter(Boolean).join(' '),
				attr: { role: 'listitem' },
			});
			result.dataset.filePath = item.filePath;
			const checkbox = result.createEl('input', {
				type: 'checkbox',
				cls: 'ttrpg-card-forge__result-checkbox',
				attr: { 'aria-label': `Select ${item.name} for batch queue addition` },
			});
			checkbox.checked = isBatchSelected;
			const content = result.createEl('button', {
				cls: 'ttrpg-card-forge__result-content',
				attr: {
					type: 'button',
					'aria-label': `Preview ${item.name}`,
					'aria-pressed': String(isPreviewSelected),
				},
			});
			content.createDiv({ text: item.name, cls: 'ttrpg-card-forge__result-name' });
			const metadata = content.createDiv({ cls: 'ttrpg-card-forge__result-metadata' });
			if (item.rarity) {
				metadata.createSpan({ text: humanizeSlug(item.rarity) });
			}
			const source = formatSourceDisplay(item.source, item.sourceText, 'compact');
			if (source) {
				metadata.createSpan({ text: source });
			}
			checkbox.addEventListener('change', () => {
				const next = applyItemBrowserInteraction({
					previewFilePath: this.selectedFilePath,
					selectedFilePaths: this.selectedBatchFilePaths,
				}, {
					kind: 'batch',
					filePath: item.filePath,
					selected: checkbox.checked,
				});
				this.selectedBatchFilePaths = new Set(next.selectedFilePaths);
				result.toggleClass('is-batch-selected', checkbox.checked);
				this.updateBatchToolbar();
			});
			content.addEventListener('click', () => this.selectItem(item.filePath));
			content.addEventListener('dblclick', () => this.openItem(item));
		}
	}

	private selectItem(filePath: string): void {
		if (this.selectedFilePath === filePath) {
			return;
		}
		this.rememberSourceNoteScroll();
		this.selectedFilePath = filePath;
		this.resetEditorSession();
		this.currentPageIndex = 0;
		this.renderBrowser();
		this.renderEditor();
		this.renderPreview();
	}

	private setPreviewMode(mode: PreviewMode): void {
		const wasSourceNote = this.previewMode === 'source-note';
		if (wasSourceNote && mode !== 'source-note') {
			this.rememberSourceNoteScroll();
		}
		this.previewMode = mode;
		this.renderEditor();
		if (mode === 'source-note') {
			void this.renderSourceNote();
		} else if (wasSourceNote) {
			this.renderPreview();
		}
	}

	private resetEditorSession(): void {
		this.draftOverrides = undefined;
		this.appliedOverrides = undefined;
		this.editingQueueEntryId = undefined;
		this.editorPreviewDebounce.cancel();
		this.artworkLoadGeneration += 1;
		this.variantRulesNotice = undefined;
		this.artworkEditorMode = undefined;
		this.artworkVaultPathDraft = undefined;
		this.artworkHttpsUrl = '';
		this.persistArtworkToVault = false;
		this.syncDraftTemporaryArtworkReferences();
	}

	private renderEditor(): void {
		if (!this.editorElement) {
			return;
		}
		const modeState = createPreviewModeState(this.previewMode);
		this.editorElement.hidden = !modeState.showEditor;
		this.cardHostElement?.toggleAttribute('hidden', !modeState.showCard);
		this.diagnosticsElement?.toggleAttribute('hidden', !modeState.showCard);
		this.sourceNoteElement?.toggleAttribute('hidden', !modeState.showSourceNote);
		this.previewActionsElement?.toggleAttribute('hidden', !modeState.showGlobalPreviewActions);
		this.previewIndicatorElement?.toggleAttribute('hidden', modeState.showSourceNote);
		this.editorElement.parentElement?.toggleClass('is-editing', modeState.showEditor);
		this.editorElement.parentElement?.toggleClass('is-source-note', modeState.showSourceNote);
		this.previewModeButton?.toggleClass('is-active', modeState.previewActive);
		this.editModeButton?.toggleClass('is-active', modeState.editActive);
		this.sourceModeButton?.toggleClass('is-active', modeState.sourceActive);
		this.previewModeButton?.setAttribute('aria-pressed', String(modeState.previewActive));
		this.editModeButton?.setAttribute('aria-pressed', String(modeState.editActive));
		this.sourceModeButton?.setAttribute('aria-pressed', String(modeState.sourceActive));
		if (modeState.showSourceNote) {
			this.pageNavigationElement?.toggleAttribute('hidden', true);
		} else {
			this.updatePageNavigation();
		}
		this.editorElement.empty();
		if (!modeState.showEditor) {
			return;
		}
		const source = this.findSelectedItem();
		if (!source) {
			this.editorElement.createDiv({ cls: 'ttrpg-card-forge__empty', text: 'Select an item to edit its print card.' });
			return;
		}
		const effective = createEffectiveCardInput(
			source,
			this.itemIndex.getItems(),
			this.draftOverrides,
		);
		const variants = discoverItemVariants(source, this.itemIndex.getItems());
		if (variants.length > 0) {
			const variantRow = this.createEditorField('Variant');
			const variantSelect = variantRow.createEl('select');
			variantSelect.setAttribute('aria-label', 'Variant');
			variantSelect.createEl('option', { text: 'Source item', value: '' });
			for (const variant of variants) {
				variantSelect.createEl('option', {
					text: getVariantDisplayLabel(variant),
					value: variant.id,
				});
			}
			variantSelect.value = this.draftOverrides?.variant?.id ?? '';
			variantSelect.addEventListener('change', () => {
				const hadCustomRules = hasExplicitDraftField(
					this.draftOverrides,
					'rulesMarkdown',
				);
				const customRules = this.draftOverrides?.rulesMarkdown;
				this.draftOverrides = selectDraftVariant(
					this.draftOverrides,
					variantSelect.value || undefined,
				);
				const selected = variants.find(
					(candidate) => candidate.id === variantSelect.value,
				);
				const defaultLabel = selected
					? getVariantDisplayLabel(selected)
					: 'Source item';
				const selectedDefaultRules = selected?.item.description
					?? source.description;
				const customRulesWerePreserved = hadCustomRules
					&& customRules !== selectedDefaultRules;
				if (!customRulesWerePreserved) {
					this.draftOverrides = resetDraftField(
						this.draftOverrides,
						'rulesMarkdown',
					);
				}
				this.variantRulesNotice = createVariantPreservationNotice(
					defaultLabel,
					customRulesWerePreserved,
				);
				this.syncDraftTemporaryArtworkReferences();
				this.scheduleEditorPreview();
				this.renderEditor();
			});
		}

		this.appendTextEditor('Title', effective.item.name, (value) => this.updateDraft((draft) => {
			draft.title = value;
		}));
		this.appendTextEditor('Type', effective.item.typeText ?? getItemBrowserTypeText(effective.item), (value) => this.updateDraft((draft) => {
			draft.typeText = value || null;
		}));
		this.appendTextEditor('Rarity', effective.item.rarityText ?? (effective.item.rarity ? humanizeSlug(effective.item.rarity) : ''), (value) => this.updateDraft((draft) => {
			draft.rarityText = value || null;
		}));
		this.appendTextEditor('Attunement', effective.item.attunementText ?? (effective.item.attunement ? 'Requires attunement' : ''), (value) => this.updateDraft((draft) => {
			draft.attunementText = value || null;
		}));
		this.appendTextEditor('Damage', effective.item.damage ?? '', (value) => this.updateStatDraft('damage', value || null));
		this.appendTextEditor('Two-handed damage', effective.item.damageTwoHanded ?? '', (value) => this.updateStatDraft('damageTwoHanded', value || null));
		this.appendTextEditor('Properties', effective.item.properties?.join(', ') ?? '', (value) => this.updateDraft((draft) => {
			draft.stats = { ...draft.stats, properties: value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : null };
		}));
		this.appendTextEditor('Mastery', effective.item.mastery ?? '', (value) => this.updateStatDraft('mastery', value || null));
		this.appendTextEditor('Range', effective.item.range ?? '', (value) => this.updateStatDraft('range', value || null));
		this.appendTextEditor('Weight', effective.item.weight?.toString() ?? '', (value) => this.updateDraft((draft) => {
			draft.stats = { ...draft.stats, weight: value ? Number(value) : null };
		}), 'number');
		this.appendTextEditor('Cost', effective.item.cost ?? '', (value) => this.updateStatDraft('cost', value || null));

		const rulesRow = this.createEditorField('Rules Markdown', true);
		const rules = rulesRow.createEl('textarea', {
			cls: 'ttrpg-card-forge__editor-rules',
			attr: { rows: '10', placeholder: 'Rules markdown' },
		});
		rules.value = this.draftOverrides?.rulesMarkdown ?? effective.item.description;
		const currentRulesDefault = effective.variant?.item.description
			?? source.description;
		let variantNoticeElement: HTMLElement | undefined;
		rules.addEventListener('input', () => {
			const override = resolveRulesDraftOverride(
				rules.value,
				currentRulesDefault,
			);
			if (override === undefined) {
				this.variantRulesNotice = undefined;
				if (variantNoticeElement) {
					variantNoticeElement.hidden = true;
				}
			}
			this.updateDraft((draft) => {
				if (override === undefined) {
					delete draft.rulesMarkdown;
				} else {
					draft.rulesMarkdown = override;
				}
			});
		});
		if (this.variantRulesNotice) {
			variantNoticeElement = rulesRow.createDiv({
				cls: 'ttrpg-card-forge__variant-notice',
				attr: { role: 'status' },
			});
			const noticeCopy = variantNoticeElement.createDiv({
				cls: 'ttrpg-card-forge__variant-notice-copy',
			});
			noticeCopy.createEl('strong', { text: this.variantRulesNotice.title });
			noticeCopy.createSpan({ text: this.variantRulesNotice.message });
			const useVariantRules = variantNoticeElement.createEl('button', {
				text: this.variantRulesNotice.actionLabel,
				attr: { type: 'button' },
			});
			useVariantRules.addEventListener('click', () => {
				this.draftOverrides = resetDraftField(
					this.draftOverrides,
					'rulesMarkdown',
				);
				this.variantRulesNotice = undefined;
				this.syncDraftTemporaryArtworkReferences();
				this.scheduleEditorPreview();
				this.renderEditor();
			});
		}
		const breakButton = rulesRow.createEl('button', {
			text: 'Insert card break',
			attr: { type: 'button' },
		});
		breakButton.addEventListener('click', () => {
			const insertion = '\n\n///CARD BREAK///\n\n';
			rules.setRangeText(insertion, rules.selectionStart, rules.selectionEnd, 'end');
			rules.dispatchEvent(new Event('input'));
			rules.focus();
		});

		const sourceDisplay = effective.item.sourceDisplayOverride
			?? formatSourceDisplay(effective.item.source, effective.item.sourceText)
			?? '';
		const sourceRow = this.appendTextEditor('Source', sourceDisplay, (value) => this.updateDraft((draft) => {
			draft.sourceText = value || null;
		}));
		if (hasExplicitDraftField(this.draftOverrides, 'sourceText')) {
			const useFormattedSource = sourceRow.createEl('button', {
				text: 'Use formatted source',
				attr: { type: 'button' },
			});
			useFormattedSource.addEventListener('click', () => {
				this.draftOverrides = resetDraftField(this.draftOverrides, 'sourceText');
				this.syncDraftTemporaryArtworkReferences();
				this.scheduleEditorPreview();
				this.renderEditor();
			});
		}
		this.appendArtworkEditor(effective);

		this.editorStatusElement = this.editorElement.createDiv({
			cls: 'ttrpg-card-forge__editor-status',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		this.setEditorStatus('');
		const actions = this.editorElement.createDiv({ cls: 'ttrpg-card-forge__editor-actions' });
		for (const action of getCardEditorActions(
			this.editingQueueEntryId ? 'queue-entry' : 'source-draft',
		)) {
			const button = actions.createEl('button', {
				text: action.label,
				...(action.primary ? { cls: 'mod-cta' } : {}),
				attr: { type: 'button' },
			});
			button.addEventListener('click', () => this.runEditorAction(action.id));
		}
	}

	private runEditorAction(action: CardEditorActionId): void {
		switch (action) {
			case 'save-changes':
				this.applyEditorChanges();
				break;
			case 'discard-changes':
				this.discardEditorChanges();
				break;
			case 'reset-edits':
			case 'reset-to-source':
				this.resetEditorChanges();
				break;
			case 'add-to-queue':
				this.addSelectedToQueue();
				break;
		}
	}

	private createEditorField(label: string, wide = false): HTMLElement {
		if (!this.editorElement) {
			throw new Error('Editor is not available.');
		}
		const row = this.editorElement.createDiv({
			cls: `ttrpg-card-forge__editor-field${wide ? ' is-wide' : ''}`,
		});
		row.createEl('label', { text: label });
		return row;
	}

	private appendTextEditor(
		label: string,
		value: string,
		onInput: (value: string) => void,
		type: 'text' | 'number' = 'text',
	): HTMLElement {
		const row = this.createEditorField(label);
		const input = row.createEl('input', { type });
		input.value = value;
		input.addEventListener('input', () => onInput(input.value.trim()));
		return row;
	}

	private appendArtworkEditor(effective: EffectiveCardInput): void {
		const row = this.createEditorField('Artwork', true);
		const select = row.createEl('select');
		select.setAttribute('aria-label', 'Artwork source');
		for (const [value, label] of [
			['source', 'Use source artwork'],
			['none', 'No artwork'],
			['vault', 'Vault image'],
			['local', 'Temporary local file'],
			['https', 'Temporary HTTPS URL'],
		] as const) {
			select.createEl('option', { value, text: label });
		}
		const artworkOverride = this.draftOverrides?.artwork;
		const effectiveArtworkMode = artworkOverride?.kind === 'temporary'
			? artworkOverride.origin ?? 'local'
			: artworkOverride?.kind ?? 'source';
		this.artworkEditorMode ??= effectiveArtworkMode;
		select.value = this.artworkEditorMode;
		select.addEventListener('change', () => {
			this.artworkLoadGeneration += 1;
			this.artworkEditorMode = select.value as ArtworkEditorMode;
			this.persistArtworkToVault = false;
			if (select.value === 'source') {
				this.updateDraft((draft) => { delete draft.artwork; });
			} else if (select.value === 'none') {
				this.updateDraft((draft) => { draft.artwork = { kind: 'none' }; });
			} else if (select.value === 'vault') {
				const initialPath = this.artworkVaultPathDraft
					?? (artworkOverride?.kind === 'vault'
						? artworkOverride.path
						: effective.source.imagePath ?? '');
				const validation = validateVaultArtworkPath(
					initialPath,
					(path) => Boolean(
						this.app.vault.getFileByPath(path)
						&& isSupportedArtworkPath(path),
					),
				);
				if (validation.valid) {
					this.artworkVaultPathDraft = validation.path;
					this.updateDraft((draft) => {
						draft.artwork = { kind: 'vault', path: validation.path };
					});
				}
			}
			this.renderEditor();
		});

		const presentation = getArtworkEditorPresentation(this.artworkEditorMode);
		if (presentation.showVaultPath) {
			const pathInput = row.createEl('input', {
				type: 'text',
				placeholder: 'Vault-relative artwork path',
				cls: 'ttrpg-card-forge__artwork-path-input',
			});
			pathInput.setAttribute('aria-label', 'Vault artwork path');
			const artworkListId = `ttrpg-card-forge-vault-artwork-${this.temporaryArtworkOwner}`;
			pathInput.setAttribute('list', artworkListId);
			const artworkList = row.createEl('datalist', {
				attr: { id: artworkListId },
			});
			for (const file of this.app.vault.getFiles()) {
				if (isSupportedArtworkPath(file.path)) {
					artworkList.createEl('option', { value: file.path });
				}
			}
			this.artworkVaultPathDraft ??= artworkOverride?.kind === 'vault'
				? artworkOverride.path
				: effective.source.imagePath ?? '';
			pathInput.value = this.artworkVaultPathDraft;
			const validationElement = row.createDiv({
				cls: 'ttrpg-card-forge__artwork-validation',
				attr: { role: 'status', 'aria-live': 'polite' },
			});
			validationElement.hidden = true;
			pathInput.addEventListener('input', () => {
				this.artworkVaultPathDraft = pathInput.value;
				const validation = validateVaultArtworkPath(
					pathInput.value,
					(path) => Boolean(
						this.app.vault.getFileByPath(path)
						&& isSupportedArtworkPath(path),
					),
				);
				validationElement.setText(validation.message ?? '');
				validationElement.hidden = validation.valid;
				pathInput.toggleClass('is-invalid', !validation.valid);
				pathInput.setAttribute('aria-invalid', validation.valid ? 'false' : 'true');
				if (validation.valid) {
					this.updateDraft((draft) => {
						draft.artwork = { kind: 'vault', path: validation.path };
					});
				}
			});
			return;
		}

		let fileInput: HTMLInputElement | undefined;
		let webInput: HTMLInputElement | undefined;
		if (presentation.showLocalFile) {
			fileInput = row.createEl('input', {
				type: 'file',
				cls: 'ttrpg-card-forge__artwork-file-input',
			});
			fileInput.setAttribute('aria-label', 'Choose temporary local artwork');
			fileInput.accept = 'image/avif,image/bmp,image/gif,image/jpeg,image/png,image/webp';
		}
		if (presentation.showHttpsUrl) {
			const urlRow = row.createDiv({
				cls: 'ttrpg-card-forge__artwork-control-row',
			});
			webInput = urlRow.createEl('input', {
				type: 'url',
				placeholder: 'https://example.com/art.png',
				cls: 'ttrpg-card-forge__artwork-url-input',
			});
			webInput.setAttribute('aria-label', 'Temporary artwork web address');
			webInput.value = this.artworkHttpsUrl;
			const useButton = urlRow.createEl('button', {
				text: 'Use image',
				cls: 'ttrpg-card-forge__artwork-use-button',
				attr: { type: 'button' },
			});
			const useImage = (): void => {
				this.artworkHttpsUrl = webInput?.value.trim() ?? '';
				void this.loadEditorArtwork(
					() => this.artworkImporter.loadWebUrl(this.artworkHttpsUrl),
					this.persistArtworkToVault,
					'https',
				);
			};
			webInput.addEventListener('input', () => {
				this.artworkHttpsUrl = webInput?.value ?? '';
			});
			webInput.addEventListener('keydown', (event) => {
				if (isArtworkUseKey(event.key)) {
					event.preventDefault();
					useImage();
				}
			});
			useButton.addEventListener('click', useImage);
		}

		if (presentation.showPersistenceChoice) {
			const persistence = row.createDiv({
				cls: 'ttrpg-card-forge__artwork-persistence',
			});
			persistence.createSpan({
				cls: 'ttrpg-card-forge__artwork-status',
				text: createTemporaryArtworkStatus(),
			});
			const persistLabel = persistence.createEl('label', {
				cls: 'ttrpg-card-forge__artwork-persist',
				attr: {
					title: 'Save imported artwork to the vault so it remains available after restart.',
				},
			});
			const persistCheckbox = persistLabel.createEl('input', {
				type: 'checkbox',
				cls: 'ttrpg-card-forge__artwork-persist-checkbox',
			});
			persistCheckbox.checked = this.persistArtworkToVault;
			persistLabel.createSpan({ text: 'Save to vault' });
			persistCheckbox.addEventListener('change', () => {
				this.persistArtworkToVault = persistCheckbox.checked;
			});
		}

		const temporary = artworkOverride?.kind === 'temporary'
			? this.temporaryArtworkStore.get(artworkOverride.id)
			: undefined;
		const warning = createMissingArtworkWarning(
			artworkOverride?.kind === 'temporary' && !temporary,
			effective.source.hasImage,
		);
		if (warning) {
			const panel = row.createDiv({
				cls: 'ttrpg-card-forge__artwork-warning',
				attr: { role: 'alert' },
			});
			panel.createEl('strong', { text: warning.title });
			panel.createDiv({ text: warning.message });
			const actions = panel.createDiv({
				cls: 'ttrpg-card-forge__artwork-warning-actions',
			});
			const chooseAgain = actions.createEl('button', {
				text: 'Choose again',
				attr: { type: 'button' },
			});
			chooseAgain.addEventListener('click', () => {
				if (fileInput) {
					fileInput.click();
				} else {
					webInput?.focus();
				}
			});
			if (warning.showUseSourceArtwork) {
				const useSource = actions.createEl('button', {
					text: 'Use source artwork',
					attr: { type: 'button' },
				});
				useSource.addEventListener('click', () => {
					this.artworkEditorMode = 'source';
					this.updateDraft((draft) => { delete draft.artwork; });
					this.renderEditor();
				});
			}
		}

		fileInput?.addEventListener('change', () => {
			const file = fileInput?.files?.[0];
			if (file) {
				void this.loadEditorArtwork(
					() => this.artworkImporter.loadLocalFile(file),
					this.persistArtworkToVault,
					'local',
				);
			}
		});
	}

	private async loadEditorArtwork(
		loadArtwork: () => Promise<ArtworkImportPayload>,
		persist: boolean,
		origin: 'local' | 'https',
	): Promise<void> {
		const generation = ++this.artworkLoadGeneration;
		const selectedFilePath = this.selectedFilePath;
		const editingQueueEntryId = this.editingQueueEntryId;
		this.setEditorStatus(origin === 'https' ? 'Downloading artwork…' : 'Loading artwork…');
		try {
			const payload = await loadArtwork();
			if (!this.isCurrentArtworkLoad(generation, selectedFilePath, editingQueueEntryId)) {
				return;
			}
			const selected = await selectArtworkStorage(
				this.app.vault,
				this.temporaryArtworkStore,
				payload,
				{
					persist,
					origin,
					folder: this.getSettings().cardForgeAssetsFolder,
				},
			);
			if (!this.isCurrentArtworkLoad(generation, selectedFilePath, editingQueueEntryId)) {
				if (selected.temporaryAsset) {
					this.temporaryArtworkStore.remove(selected.temporaryAsset.id);
				}
				return;
			}
			this.updateDraft((draft) => { draft.artwork = selected.override; });
			this.artworkEditorMode = selected.override.kind === 'temporary'
				? selected.override.origin ?? origin
				: selected.override.kind;
			if (selected.vaultPath) {
				this.artworkVaultPathDraft = selected.vaultPath;
			}
			this.persistArtworkToVault = false;
			new Notice(selected.vaultPath
				? `Saved artwork to ${selected.vaultPath}.`
				: 'Loaded temporary artwork for this Obsidian session.');
			this.renderEditor();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown artwork error';
			this.setEditorStatus(`Artwork load failed: ${message}`);
			new Notice(`Artwork load failed: ${message}`);
		}
	}

	private isCurrentArtworkLoad(
		generation: number,
		selectedFilePath: string | null,
		editingQueueEntryId: string | undefined,
	): boolean {
		return generation === this.artworkLoadGeneration
			&& selectedFilePath === this.selectedFilePath
			&& editingQueueEntryId === this.editingQueueEntryId;
	}

	private updateStatDraft(
		key: 'damage' | 'damageTwoHanded' | 'range' | 'mastery' | 'cost',
		value: string | null,
	): void {
		this.updateDraft((draft) => {
			draft.stats = { ...draft.stats, [key]: value };
		});
	}

	private updateDraft(update: (draft: CardOverrides) => void): void {
		const draft = structuredClone(this.draftOverrides ?? {});
		update(draft);
		this.draftOverrides = normalizeCardOverrides(draft);
		this.syncDraftTemporaryArtworkReferences();
		this.scheduleEditorPreview();
	}

	private scheduleEditorPreview(): void {
		this.setEditorStatus('Updating preview…');
		// Invalidate immediately so an older in-flight fit cannot commit during
		// the debounce window. The last completed DOM remains visible.
		this.previewGeneration += 1;
		this.previewRequestGate.invalidate();
		this.currentPreviewPlanKey = undefined;
		this.editorPreviewDebounce.schedule(() => {
			this.renderPreview(true);
		});
	}

	private applyEditorChanges(): void {
		if (!this.editingQueueEntryId) {
			return;
		}
		const nextOverrides = structuredClone(this.draftOverrides);
		if (!this.printQueue.updateOverrides(this.editingQueueEntryId, nextOverrides)) {
			console.error(
				'TTRPG Card Forge: refused to save queue edits because the entry ID was missing or ambiguous',
				this.editingQueueEntryId,
			);
			this.setEditorStatus('Could not save changes because this queue entry is no longer uniquely identified.');
			new Notice('Card Forge could not safely identify that queue entry. Reload the plugin and try again.');
			return;
		}
		this.appliedOverrides = nextOverrides;
		this.setEditorStatus('');
		const source = this.findSelectedItem();
		this.renderPreviewIndicator(
			source ? createEffectiveCardInput(
				source,
				this.itemIndex.getItems(),
				this.draftOverrides,
			) : undefined,
		);
	}

	private discardEditorChanges(): void {
		this.editorPreviewDebounce.cancel();
		this.artworkLoadGeneration += 1;
		this.draftOverrides = structuredClone(this.appliedOverrides);
		this.variantRulesNotice = undefined;
		this.artworkEditorMode = undefined;
		this.artworkVaultPathDraft = undefined;
		this.artworkHttpsUrl = '';
		this.persistArtworkToVault = false;
		this.syncDraftTemporaryArtworkReferences();
		this.renderEditor();
		this.renderPreview(true);
	}

	private resetEditorChanges(): void {
		this.editorPreviewDebounce.cancel();
		this.artworkLoadGeneration += 1;
		this.draftOverrides = undefined;
		this.variantRulesNotice = undefined;
		this.artworkEditorMode = undefined;
		this.artworkVaultPathDraft = undefined;
		this.artworkHttpsUrl = '';
		this.persistArtworkToVault = false;
		this.syncDraftTemporaryArtworkReferences();
		this.renderEditor();
		this.renderPreview(true);
	}

	private setEditorStatus(message: string): void {
		this.editorStatusElement?.setText(message);
	}

	private syncDraftTemporaryArtworkReferences(): void {
		const id = this.draftOverrides?.artwork?.kind === 'temporary'
			? this.draftOverrides.artwork.id
			: undefined;
		this.temporaryArtworkStore.setOwnerReferences(
			this.temporaryArtworkOwner,
			id ? [id] : [],
		);
	}

	private renderPreview(preserveExisting = false): void {
		if (!this.cardHostElement || !this.diagnosticsElement || !this.openSourceButton || !this.addToQueueButton) {
			return;
		}
		if (this.previewMode === 'source-note') {
			void this.renderSourceNote();
			return;
		}
		if (!preserveExisting) {
			this.cancelPreviewObservation();
		}
		const generation = ++this.previewGeneration;
		this.pageRenderGeneration += 1;
		this.previewRequestGate.invalidate();
		const source = this.findSelectedItem();
		const effective = source ? createEffectiveCardInput(
			source,
			this.itemIndex.getItems(),
			this.draftOverrides,
		) : undefined;
		this.renderPreviewIndicator(effective);
		if (!preserveExisting) {
			this.cardHostElement.empty();
			this.diagnosticsElement.empty();
			this.previewPages = [];
			this.unfitPageIndexes = new Set<number>();
			this.currentArtworkResourcePath = undefined;
			this.currentArtworkRevisionFingerprint = undefined;
		}
		this.currentPreviewPlanKey = undefined;
		this.updatePageNavigation();
		this.openSourceButton.disabled = !source;
		this.addToQueueButton.disabled = !source;

		if (!effective) {
			this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Select an item to preview its card.' });
			return;
		}
		const lookup = this.beginPhysicalPlanLookup(effective);
		this.currentPreviewPlanKey = lookup.identity.key;
		if (!lookup.indexIsCurrent || !lookup.promise) {
			if (!preserveExisting) {
				this.cardHostElement.createDiv({
					cls: 'ttrpg-card-forge__preview-empty',
					text: 'Updating the item index…',
				});
			}
			this.setEditorStatus('Updating the item index…');
			return;
		}
		const requestToken = this.previewRequestGate.begin(lookup.identity.key);
		if (lookup.completed) {
			this.applyPhysicalPlanToPreview(
				effective.item,
				lookup,
				lookup.completed,
				generation,
				requestToken,
			);
			return;
		}
		if (!preserveExisting) {
			this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Planning physical card pages…' });
		}
		this.setEditorStatus('Updating preview…');
		void this.planAndRenderPreview(effective.item, lookup, generation, requestToken);
	}

	private async renderSourceNote(): Promise<void> {
		if (!this.sourceNoteContentElement || !this.sourceNoteOpenButton) {
			return;
		}
		const generation = ++this.sourceNoteGeneration;
		const selectedFilePath = this.selectedFilePath;
		this.rememberSourceNoteScroll();
		this.cancelSourceNoteScrollRestore();
		this.renderedSourceNotePath = undefined;
		this.sourceNoteContentElement.empty();
		this.sourceNoteOpenButton.disabled = !selectedFilePath;
		if (!selectedFilePath) {
			this.sourceNoteContentElement.createDiv({
				cls: 'ttrpg-card-forge__empty',
				text: 'Select an item to inspect its original source note.',
			});
			return;
		}
		this.sourceNoteContentElement.createDiv({
			cls: 'ttrpg-card-forge__source-note-status',
			text: 'Loading source note…',
		});
		const result = await loadSourceNote(selectedFilePath, async (filePath) => {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			return file instanceof TFile ? this.app.vault.cachedRead(file) : undefined;
		});
		if (!isCurrentSourceNoteRender(
			selectedFilePath,
			generation,
			this.selectedFilePath,
			this.sourceNoteGeneration,
			this.previewMode,
		)) {
			return;
		}
		if (result.status !== 'ready') {
			this.sourceNoteContentElement.empty();
			this.sourceNoteContentElement.createDiv({
				cls: 'ttrpg-card-forge__empty is-warning',
				text: result.message,
			});
			this.sourceNoteOpenButton.disabled = true;
			return;
		}

		const rendered = createDiv();
		await MarkdownRenderer.render(
			this.app,
			result.markdown,
			rendered,
			result.filePath,
			this,
		);
		if (!isCurrentSourceNoteRender(
			selectedFilePath,
			generation,
			this.selectedFilePath,
			this.sourceNoteGeneration,
			this.previewMode,
		)) {
			return;
		}
		this.sourceNoteContentElement.empty();
		while (rendered.firstChild) {
			this.sourceNoteContentElement.appendChild(rendered.firstChild);
		}
		this.renderedSourceNotePath = selectedFilePath;
		this.sourceNoteScrollFrame = window.requestAnimationFrame(() => {
			this.sourceNoteScrollFrame = null;
			if (
				!this.sourceNoteContentElement
				|| !isCurrentSourceNoteRender(
					selectedFilePath,
					generation,
					this.selectedFilePath,
					this.sourceNoteGeneration,
					this.previewMode,
				)
			) {
				return;
			}
			const maximumScrollTop = Math.max(
				0,
				this.sourceNoteContentElement.scrollHeight
					- this.sourceNoteContentElement.clientHeight,
			);
			this.sourceNoteContentElement.scrollTop = this.sourceNoteScrollMemory.restore(
				selectedFilePath,
				maximumScrollTop,
			);
		});
	}

	private rememberSourceNoteScroll(): void {
		if (
			this.sourceNoteScrollFrame === null
			&& this.sourceNoteContentElement
			&& this.renderedSourceNotePath
		) {
			this.sourceNoteScrollMemory.remember(
				this.renderedSourceNotePath,
				this.sourceNoteContentElement.scrollTop,
			);
		}
	}

	private cancelSourceNoteScrollRestore(): void {
		if (this.sourceNoteScrollFrame !== null) {
			window.cancelAnimationFrame(this.sourceNoteScrollFrame);
			this.sourceNoteScrollFrame = null;
		}
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
				if (this.previewPages.length > 0) {
					this.setEditorStatus('Preview update failed; showing the last valid card.');
				} else {
					this.cardHostElement.empty();
					this.cardHostElement.createDiv({ cls: 'ttrpg-card-forge__preview-empty', text: 'Physical card planning failed. See the developer console.' });
				}
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
		this.setEditorStatus('');
		this.renderCurrentPage();
	}

	private renderPreviewIndicator(effective: EffectiveCardInput | undefined): void {
		if (!this.previewIndicatorElement) {
			return;
		}
		this.previewIndicatorElement.empty();
		if (!effective) {
			return;
		}
		const artworkMissing = effective.overrides?.artwork?.kind === 'temporary'
			&& !this.temporaryArtworkStore.get(effective.overrides.artwork.id);
		const chips = createPreviewStatusChips({
			...(effective.variant
				? { variantLabel: getVariantDisplayLabel(effective.variant) }
				: {}),
			edited: Boolean(effective.overrides),
			unsaved: Boolean(
				this.editingQueueEntryId
				&& !areCardOverridesEqual(
					this.draftOverrides,
					this.appliedOverrides,
				),
			),
			artworkMissing,
		});
		for (const chip of chips) {
			this.previewIndicatorElement.createSpan({
				cls: `ttrpg-card-forge__status-chip is-${chip.tone}`,
				text: chip.label,
			});
		}
	}

	private beginPhysicalPlanLookup(input: EffectiveCardInput): PhysicalPlanLookup {
		const trace = this.planningPerformance.start(input.item.name, 'physical-plan');
		const request = this.createPhysicalPlanRequest(input, trace);
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
					input.item,
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
		input: EffectiveCardInput,
		trace?: ReturnType<PlanningPerformanceMonitor['start']>,
	): Pick<
		PhysicalPlanLookup,
		'identity' | 'indexIsCurrent' | 'artworkResourcePath'
		| 'artworkRevisionFingerprint' | 'temporaryArtworkUnavailable'
	> {
		const { source, item } = input;
		const temporaryOverride = input.overrides?.artwork?.kind === 'temporary'
			? input.overrides.artwork
			: undefined;
		const resolveArtwork = () => {
			const temporary = temporaryOverride
				? this.temporaryArtworkStore.get(temporaryOverride.id)
				: undefined;
			return temporary
				? toTemporaryArtworkDescriptor(temporary)
				: temporaryOverride ? undefined : resolveArtworkDescriptor(this.app, item);
		};
		const artwork = trace
			? trace.measure('artworkResolution', resolveArtwork)
			: resolveArtwork();
		const createRequest = () => {
			const indexedSourceRevision = this.itemIndex.getSourceRevision(source.filePath);
			const sourceFile = this.app.vault.getFileByPath(source.filePath);
			const sourceArtwork = resolveArtworkDescriptor(this.app, source);
			const indexIsCurrent = isIndexedPlanningInputCurrent(
				indexedSourceRevision,
				sourceFile
					? {
						modifiedTime: sourceFile.stat.mtime,
						size: sourceFile.stat.size,
					}
					: undefined,
				source.hasImage,
				Boolean(sourceArtwork),
			);
			const identity = createPhysicalPlanCacheIdentity({
				item,
				sourceFingerprint: this.itemIndex.getSourceFingerprint(source.filePath)
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
				overrideFingerprint: input.overrideFingerprint,
			});
			return {
				identity,
				indexIsCurrent,
				...(temporaryOverride && !artwork
					? { temporaryArtworkUnavailable: true }
					: {}),
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
		const queueEntryIds = new Set<string>();
		let indexIsStale = false;
		const currentPlansByEntry = new Map(
			this.currentQueuePlan
				.filter((resolved) => resolved.item && !resolved.unavailable)
				.map((resolved) => [resolved.entry.id, resolved] as const),
		);
		for (const entry of entries) {
			const source = itemsByPath.get(entry.filePath);
			if (!source) {
				continue;
			}
			queueEntryIds.add(entry.id);
			const effective = createEffectiveCardInput(source, items, entry.overrides);
			const request = this.createPhysicalPlanRequest(effective);
			if (!request.indexIsCurrent) {
				indexIsStale = true;
				continue;
			}
			const currentPlan = currentPlansByEntry.get(entry.id);
			if (currentPlan?.cacheKey === request.identity.key) {
				warmPlans.set(entry.id, {
					item: effective.item,
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
					...(currentPlan.temporaryArtworkUnavailable
						? { temporaryArtworkUnavailable: true }
						: {}),
				});
				continue;
			}
			const completed = this.physicalPlanCache.peek(request.identity);
			if (completed) {
				warmPlans.set(
					entry.id,
					this.createQueuePhysicalPlan(effective.item, request, completed),
				);
			}
		}
		if (indexIsStale) {
			this.currentQueuePlan = [];
			this.renderQueuePlanningState(entries.length, 'Updating the item index…');
			return;
		}

		if (warmPlans.size === queueEntryIds.size) {
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
			plans = new Map(warmPlans);
			for (const entry of entries) {
				if (plans.has(entry.id)) {
					continue;
				}
				if (!this.queueRequestGate.isCurrent(requestToken)) {
					break;
				}
				const source = itemsByPath.get(entry.filePath);
				if (!source) {
					continue;
				}
				const effective = createEffectiveCardInput(source, items, entry.overrides);
				const lookup = this.beginPhysicalPlanLookup(effective);
				if (!lookup.indexIsCurrent || !lookup.promise) {
					throw new ItemIndexStaleError();
				}
				plans.set(entry.id, this.createQueuePhysicalPlan(
					effective.item,
					lookup,
					await lookup.promise,
				));
			}
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
		item: ItemCardData,
		request: Pick<
			PhysicalPlanLookup,
			'identity' | 'artworkResourcePath' | 'artworkRevisionFingerprint'
			| 'temporaryArtworkUnavailable'
		>,
		plan: FittedItemCardPlan,
	): PhysicalItemPlan {
		return {
			item,
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
			...(request.temporaryArtworkUnavailable
				? { temporaryArtworkUnavailable: true }
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
			cls: `ttrpg-card-forge__queue-entry${resolved.unavailable ? ' is-unavailable' : ''}${resolved.temporaryArtworkUnavailable ? ' has-warning' : ''}`,
		});
		const details = row.createDiv({ cls: 'ttrpg-card-forge__queue-entry-details' });
		details.createDiv({
			cls: 'ttrpg-card-forge__queue-entry-name',
			text: resolved.item?.name ?? resolved.entry.filePath,
		});
		if (resolved.entry.overrides) {
			details.createSpan({ cls: 'ttrpg-card-forge__edited-badge', text: 'Edited for print' });
		}
		const metadata = resolved.unavailable
			? 'Unavailable — remove this entry to export'
			: resolved.temporaryArtworkUnavailable
				? 'Export blocked until artwork is replaced'
			: resolved.unfitPageIndexes.size > 0
				? 'Content does not fit a physical card — export blocked'
				: `${resolved.pages.length} ${resolved.pages.length === 1 ? 'card' : 'cards'} per copy · ${resolved.pages.length * resolved.entry.quantity} total`;
		details.createDiv({ cls: 'ttrpg-card-forge__queue-entry-meta', text: metadata });
		const source = this.itemIndex.getItems().find(
			(item) => item.filePath === resolved.entry.filePath,
		);
		const artworkWarning = createMissingArtworkWarning(
			Boolean(resolved.temporaryArtworkUnavailable),
			Boolean(source?.hasImage),
		);
		if (artworkWarning) {
			const panel = details.createDiv({
				cls: 'ttrpg-card-forge__queue-artwork-warning',
				attr: { role: 'alert' },
			});
			panel.createEl('strong', { text: artworkWarning.title });
			panel.createDiv({ text: artworkWarning.message });
			const recoveryActions = panel.createDiv({
				cls: 'ttrpg-card-forge__artwork-warning-actions',
			});
			const origin = resolved.entry.overrides?.artwork?.kind === 'temporary'
				? resolved.entry.overrides.artwork.origin ?? 'local'
				: 'local';
			appendQueueButton(
				recoveryActions,
				'Choose again',
				`Choose artwork again for ${resolved.item?.name ?? 'item'}`,
				() => this.editQueueEntry(resolved.entry.id, origin),
			);
			if (artworkWarning.showUseSourceArtwork) {
				appendQueueButton(
					recoveryActions,
					'Use source artwork',
					`Use source artwork for ${resolved.item?.name ?? 'item'}`,
					() => this.printQueue.updateOverrides(
						resolved.entry.id,
						resetDraftField(resolved.entry.overrides, 'artwork'),
					),
				);
			}
		}

		const controls = row.createDiv({ cls: 'ttrpg-card-forge__queue-controls' });
		appendQueueButton(controls, '−', `Decrease ${resolved.item?.name ?? 'item'} quantity`, () => this.printQueue.decrement(resolved.entry.id), resolved.entry.quantity <= 1);
		controls.createSpan({ cls: 'ttrpg-card-forge__queue-quantity', text: String(resolved.entry.quantity) });
		appendQueueButton(controls, '+', `Increase ${resolved.item?.name ?? 'item'} quantity`, () => this.printQueue.increment(resolved.entry.id));
		appendQueueButton(controls, '↑', `Move ${resolved.item?.name ?? 'item'} up`, () => this.printQueue.move(resolved.entry.id, -1), index === 0);
		appendQueueButton(controls, '↓', `Move ${resolved.item?.name ?? 'item'} down`, () => this.printQueue.move(resolved.entry.id, 1), index === this.currentQueuePlan.length - 1);
		appendQueueButton(controls, 'Duplicate', `Duplicate ${resolved.item?.name ?? 'item'} queue entry`, () => {
			if (!this.printQueue.duplicate(resolved.entry.id)) {
				new Notice('Card Forge could not safely duplicate that queue entry.');
			}
		});
		appendQueueButton(controls, 'Edit', `Edit ${resolved.item?.name ?? 'item'} print card`, () => this.editQueueEntry(resolved.entry.id));
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
		if (this.savePrintSetButton) {
			this.savePrintSetButton.disabled = this.exportInProgress || this.printQueue.getEntries().length === 0;
		}
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
			if (this.workflowMode === 'exports') {
				await this.renderExportGallery();
			}
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
		const itemsByPath = new Map(
			this.itemIndex.getItems().map((item) => [item.filePath, item]),
		);
		return this.currentQueuePlan.every((resolved) => {
			if (resolved.unavailable || !resolved.item || !resolved.cacheKey) {
				return resolved.unavailable;
			}
			const source = itemsByPath.get(resolved.entry.filePath);
			if (!source) {
				return false;
			}
			const effective = createEffectiveCardInput(
				source,
				this.itemIndex.getItems(),
				resolved.entry.overrides,
			);
			const request = this.createPhysicalPlanRequest(effective);
			return request.indexIsCurrent
				&& !request.temporaryArtworkUnavailable
				&& request.identity.key === resolved.cacheKey;
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
			this.printQueue.add(item.filePath, this.draftOverrides);
			new Notice(`Added ${item.name} to the print queue.`);
		}
	}

	private addBatchSelectionToQueue(): void {
		const selection = resolveBatchSelection(
			this.itemIndex.getItems(),
			this.selectedBatchFilePaths,
		);
		if (selection.items.length === 0) {
			new Notice(selection.missingFilePaths.length > 0
				? `${selection.missingFilePaths.length} selected ${selection.missingFilePaths.length === 1 ? 'item could' : 'items could'} not be added.`
				: 'Select at least one item to add.');
			return;
		}
		const result = this.printQueue.addMany(selection.items.map((item) => ({
			filePath: item.filePath,
		})));
		this.selectedBatchFilePaths = removeBatchSelections(
			this.selectedBatchFilePaths,
			selection.items.map((item) => item.filePath),
		);
		this.renderBrowser();
		const failedCount = selection.missingFilePaths.length + result.rejected;
		new Notice(failedCount > 0
			? `Added ${result.entries.length} cards. ${failedCount} ${failedCount === 1 ? 'item could' : 'items could'} not be added.`
			: `Added ${result.entries.length} ${result.entries.length === 1 ? 'card' : 'cards'} to the print queue.`);
	}

	private editQueueEntry(
		entryId: string,
		artworkMode?: Extract<ArtworkEditorMode, 'local' | 'https'>,
	): void {
		const entry = this.printQueue.getEntry(entryId);
		if (!entry) {
			console.error(
				'TTRPG Card Forge: refused to edit a queue entry because the entry ID was missing or ambiguous',
				entryId,
			);
			new Notice('Card Forge could not safely identify that queue entry. Reload the plugin and try again.');
			return;
		}
		if (this.searchInput) {
			this.searchInput.value = '';
		}
		this.rememberSourceNoteScroll();
		this.selectedFilePath = entry.filePath;
		this.editingQueueEntryId = entry.id;
		this.appliedOverrides = structuredClone(entry.overrides);
		this.draftOverrides = structuredClone(entry.overrides);
		this.variantRulesNotice = undefined;
		this.artworkEditorMode = artworkMode;
		this.artworkVaultPathDraft = undefined;
		this.artworkHttpsUrl = '';
		this.persistArtworkToVault = false;
		this.syncDraftTemporaryArtworkReferences();
		this.previewMode = 'edit';
		this.currentPageIndex = 0;
		this.renderBrowser();
		this.renderEditor();
		this.renderPreview();
		if (artworkMode === 'local') {
			this.editorElement
				?.querySelector<HTMLInputElement>('.ttrpg-card-forge__artwork-file-input')
				?.click();
		} else if (artworkMode === 'https') {
			this.editorElement
				?.querySelector<HTMLInputElement>('.ttrpg-card-forge__artwork-url-input')
				?.focus();
		}
	}

	private findSelectedItem(): ItemCardData | undefined {
		return this.itemIndex.getItems().find((item) => item.filePath === this.selectedFilePath);
	}

	selectItemForPreview(filePath: string): boolean {
		const item = this.itemIndex.getItems().find((candidate) => candidate.filePath === filePath);
		if (!item) {
			return false;
		}
		this.rememberSourceNoteScroll();
		this.selectedFilePath = item.filePath;
		this.resetEditorSession();
		this.previewMode = 'preview';
		this.currentPageIndex = 0;
		this.renderBrowser();
		this.renderEditor();
		this.renderPreview();
		return true;
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
		if (this.previewMode === 'source-note') {
			this.pageNavigationElement.hidden = true;
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

function formatWorkflowDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isDirectChildPath(path: string, folder: string): boolean {
	const normalizedPath = path.replace(/\\/gu, '/');
	const normalizedFolder = folder.replace(/\\/gu, '/').replace(/\/+$/gu, '');
	if (!normalizedFolder || !normalizedPath.startsWith(`${normalizedFolder}/`)) {
		return false;
	}
	return !normalizedPath.slice(normalizedFolder.length + 1).includes('/');
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

function humanizeSlug(value: string): string {
	return value
		.split('-')
		.map((part) => part ? `${part[0]?.toLocaleUpperCase()}${part.slice(1)}` : part)
		.join(' ');
}

function toTemporaryArtworkDescriptor(asset: TemporaryArtworkAsset): {
	resourcePath: string;
	filePath: string;
	modifiedTime: number;
	size: number;
	revisionFingerprint: string;
} {
	return {
		resourcePath: asset.resourcePath,
		filePath: `temporary:${asset.id}`,
		modifiedTime: 0,
		size: asset.size,
		revisionFingerprint: asset.revisionFingerprint,
	};
}

function createRuntimeId(): string {
	return window.crypto?.randomUUID?.()
		?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class ItemIndexStaleError extends Error {
	constructor() {
		super('The item index changed while physical cards were being planned.');
		this.name = 'ItemIndexStaleError';
	}
}
