import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';

import { ItemIndex, type ItemIndexResult } from './services/item-index';
import {
	PrintQueueService,
} from './models/print-queue';
import { SavedPrintSetService } from './models/saved-print-set';
import type { ItemCardData } from './models/item';
import {
	DEFAULT_SETTINGS,
	CardForgeSettingTab,
	getCardDesignDefaults,
	type CardForgeSettings,
} from './settings';
import {
	createCardDesignProfile,
	normalizeCardDesignProfile,
	type CardArtworkSize,
	type CardDensity,
	type CardTheme,
} from './models/card-design';
import { CARD_FORGE_VIEW_TYPE, CardForgeView } from './views/card-forge-view';
import { PlanningPerformanceMonitor } from './services/planning-performance';
import type { FittedItemCardPlan } from './renderer/item-card-fit-service';
import {
	createEffectiveItemFingerprint,
	PhysicalPlanCache,
} from './services/physical-plan-cache';
import { isSupportedArtworkPath } from './services/artwork-resolver';
import {
	collectTemporaryArtworkIds,
	TemporaryArtworkStore,
} from './services/temporary-artwork-store';
import { normalizeArtworkAssetFolder } from './services/artwork-importer-core';
import {
	addCurrentIndexedItemToQueue,
	resolveCurrentIndexedItem,
} from './services/current-item-workflow';
import { SavedPrintSetSession } from './services/saved-print-set-session';
import {
	normalizePrintExportSettings,
	type PrintExportSettings,
} from './models/print-export-settings';

const INDEX_REBUILD_DELAY_MS = 350;
const QUEUE_ARTWORK_OWNER = 'print-queue';
const SAVED_SET_ARTWORK_OWNER = 'saved-print-sets';

interface LoadedPluginData {
	printQueue?: unknown;
	savedPrintSets?: unknown;
	activeSavedSetId?: unknown;
}

export default class TTRPGCardForgePlugin extends Plugin {
	settings: CardForgeSettings = DEFAULT_SETTINGS;
	itemIndex!: ItemIndex;
	printQueue!: PrintQueueService;
	savedPrintSets!: SavedPrintSetService;
	readonly savedPrintSetSession = new SavedPrintSetSession();
	readonly planningPerformance = new PlanningPerformanceMonitor();
	readonly physicalPlanCache = new PhysicalPlanCache<FittedItemCardPlan>();
	readonly temporaryArtworkStore = new TemporaryArtworkStore();
	private indexedInputFingerprints = new Map<string, string>();
	private rebuildTimer: number | null = null;
	private initialIndexReady = false;
	private indexReadyPromise: Promise<ItemIndexResult> | null = null;
	private unsubscribeFromIndex: (() => void) | null = null;
	private unsubscribeFromQueue: (() => void) | null = null;
	private unsubscribeFromSavedPrintSets: (() => void) | null = null;
	private unsubscribeFromSavedPrintSetSession: (() => void) | null = null;
	private removePerformanceDebugApi: (() => void) | null = null;
	private saveChain: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		const saved = await this.loadPluginData();
		this.itemIndex = new ItemIndex(this.app);
		this.printQueue = new PrintQueueService(saved.printQueue);
		this.savedPrintSets = new SavedPrintSetService(saved.savedPrintSets);
		const activeSavedSetRestore = this.savedPrintSetSession.restore(
			saved.activeSavedSetId,
			this.savedPrintSets.getSets(),
		);
		this.syncQueueTemporaryArtworkReferences();
		this.syncSavedSetTemporaryArtworkReferences();
		this.removePerformanceDebugApi = this.planningPerformance.installDebugApi(window);
		this.unsubscribeFromIndex = this.itemIndex.subscribe((items) => {
			this.reconcilePhysicalPlanCache(items);
		});
		this.unsubscribeFromQueue = this.printQueue.subscribe(() => {
			this.syncQueueTemporaryArtworkReferences();
			void this.persistPluginData().catch((error: unknown) => {
				console.error('TTRPG Card Forge: could not persist print queue', error);
			});
		});
		this.unsubscribeFromSavedPrintSets = this.savedPrintSets.subscribe(() => {
			this.syncSavedSetTemporaryArtworkReferences();
			void this.persistPluginData().catch((error: unknown) => {
				console.error('TTRPG Card Forge: could not persist saved print sets', error);
			});
		});
		this.unsubscribeFromSavedPrintSetSession = this.savedPrintSetSession.subscribe(() => {
			void this.persistPluginData().catch((error: unknown) => {
				console.error('TTRPG Card Forge: could not persist active saved print set', error);
			});
		});
		if (
			this.printQueue.hydrationRepaired
			|| this.savedPrintSets.hydrationRepaired
			|| activeSavedSetRestore === 'invalid'
		) {
			void this.persistPluginData().catch((error: unknown) => {
				console.error('TTRPG Card Forge: could not persist repaired plugin data', error);
			});
		}

		this.registerView(
			CARD_FORGE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CardForgeView(
				leaf,
				this.itemIndex,
				this.printQueue,
				this.savedPrintSets,
				this.savedPrintSetSession,
				() => this.settings,
				this.physicalPlanCache,
				this.planningPerformance,
				this.temporaryArtworkStore,
				(settings) => this.updatePrintExportSettings(settings),
			),
		);

		this.addRibbonIcon('layers-3', 'Open TTRPG Card Forge', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-card-forge',
			name: 'Open Card Forge',
			callback: () => {
				void this.activateView();
			},
		});
		this.addCommand({
			id: 'open-current-item-in-card-forge',
			name: 'Open current item in Card Forge',
			callback: () => {
				void this.openCurrentItemInCardForge();
			},
		});
		this.addCommand({
			id: 'add-current-item-to-print-queue',
			name: 'Add current item to print queue',
			callback: () => {
				void this.addCurrentItemToPrintQueue();
			},
		});

		this.addSettingTab(new CardForgeSettingTab(this));

		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (this.isConfiguredItemFile(file)) {
				this.queueIndexRebuild();
			}
		}));
		this.registerEvent(this.app.metadataCache.on('resolved', () => {
			this.queueIndexRebuild();
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (this.isConfiguredItemPath(file.path)) {
				this.queueIndexRebuild();
			}
			if (isSupportedArtworkPath(file.path)) {
				this.invalidateArtworkAndRebuild(file.path);
			}
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (this.isConfiguredItemPath(file.path) || this.isConfiguredItemPath(oldPath)) {
				this.queueIndexRebuild();
			}
			if (isSupportedArtworkPath(oldPath)) {
				this.physicalPlanCache.invalidateArtwork(oldPath);
			}
			if (isSupportedArtworkPath(file.path)) {
				this.invalidateArtworkAndRebuild(file.path);
			} else if (isSupportedArtworkPath(oldPath)) {
				this.queueIndexRebuild();
			}
		}));
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (this.isConfiguredItemFile(file)) {
				this.queueIndexRebuild();
			}
			if (isSupportedArtworkPath(file.path)) {
				this.invalidateArtworkAndRebuild(file.path);
			}
		}));
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (this.isConfiguredItemFile(file)) {
				this.queueIndexRebuild();
			}
			if (isSupportedArtworkPath(file.path)) {
				this.invalidateArtworkAndRebuild(file.path);
			}
		}));

		this.app.workspace.onLayoutReady(() => {
			void this.ensureItemIndexReady().catch(() => undefined);
		});
	}

	onunload(): void {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromIndex = null;
		this.unsubscribeFromQueue?.();
		this.unsubscribeFromQueue = null;
		this.unsubscribeFromSavedPrintSets?.();
		this.unsubscribeFromSavedPrintSets = null;
		this.unsubscribeFromSavedPrintSetSession?.();
		this.unsubscribeFromSavedPrintSetSession = null;
		this.removePerformanceDebugApi?.();
		this.removePerformanceDebugApi = null;
		this.physicalPlanCache.clear();
		this.temporaryArtworkStore.clear();
		this.indexedInputFingerprints.clear();
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}
	}

	async activateView(): Promise<CardForgeView | undefined> {
		const existingLeaf = this.app.workspace.getLeavesOfType(CARD_FORGE_VIEW_TYPE)[0];
		const trace = this.planningPerformance.start(
			existingLeaf ? 'warm-refocus' : 'cold-open',
			'view-activation',
		);
		if (existingLeaf) {
			if (trace) {
				await trace.measureAsync(
					'viewReveal',
					() => this.app.workspace.revealLeaf(existingLeaf),
				);
				trace.finish();
			} else {
				await this.app.workspace.revealLeaf(existingLeaf);
			}
			return existingLeaf.view instanceof CardForgeView
				? existingLeaf.view
				: undefined;
		}

		const leaf = this.app.workspace.getLeaf('tab');
		if (trace) {
			await trace.measureAsync(
				'viewInitialization',
				() => leaf.setViewState({ type: CARD_FORGE_VIEW_TYPE, active: true }),
			);
			await trace.measureAsync(
				'viewReveal',
				() => this.app.workspace.revealLeaf(leaf),
			);
			trace.finish();
		} else {
			await leaf.setViewState({ type: CARD_FORGE_VIEW_TYPE, active: true });
			await this.app.workspace.revealLeaf(leaf);
		}
		return leaf.view instanceof CardForgeView ? leaf.view : undefined;
	}

	private async openCurrentItemInCardForge(): Promise<void> {
		const item = await this.resolveActiveIndexedItem();
		if (!item) {
			new Notice('Current note is not an indexed Card Forge item.');
			return;
		}
		const view = await this.activateView();
		if (!view?.selectItemForPreview(item.filePath)) {
			new Notice('TTRPG Card Forge could not open the current item.');
		}
	}

	private async addCurrentItemToPrintQueue(): Promise<void> {
		const item = await this.resolveActiveIndexedItem();
		if (!item) {
			new Notice('Current note is not an indexed Card Forge item.');
			return;
		}
		addCurrentIndexedItemToQueue(
			this.printQueue,
			item,
			createCardDesignProfile(getCardDesignDefaults(this.settings)),
		);
		new Notice(`Added ${item.name} to Card Forge print queue.`);
	}

	private async resolveActiveIndexedItem(): Promise<ItemCardData | undefined> {
		try {
			await this.ensureItemIndexReady();
		} catch {
			return undefined;
		}
		return resolveCurrentIndexedItem(
			this.itemIndex.getItems(),
			this.app.workspace.getActiveFile(),
		);
	}

	async updateItemFolder(itemFolder: string): Promise<void> {
		this.settings.itemFolder = itemFolder.trim();
		await this.persistPluginData();
		this.queueIndexRebuild();
	}

	async updatePdfExportFolder(pdfExportFolder: string): Promise<void> {
		this.settings.pdfExportFolder = pdfExportFolder.trim()
			|| DEFAULT_SETTINGS.pdfExportFolder;
		await this.persistPluginData();
		await Promise.all(
			this.app.workspace.getLeavesOfType(CARD_FORGE_VIEW_TYPE)
				.map((leaf) => leaf.view)
				.filter((view): view is CardForgeView => view instanceof CardForgeView)
				.map((view) => view.onPdfExportFolderChanged()),
		);
	}

	async updateCardForgeAssetsFolder(cardForgeAssetsFolder: string): Promise<void> {
		this.settings.cardForgeAssetsFolder = normalizeArtworkAssetFolder(cardForgeAssetsFolder);
		await this.persistPluginData();
	}

	async updateShowCropMarks(showCropMarks: boolean): Promise<void> {
		this.settings.showCropMarks = showCropMarks;
		await this.persistPluginData();
	}

	async updateOpenPdfAfterExport(openPdfAfterExport: boolean): Promise<void> {
		this.settings.openPdfAfterExport = openPdfAfterExport;
		await this.persistPluginData();
	}

	async updatePrintExportSettings(
		printExport: Readonly<PrintExportSettings>,
	): Promise<void> {
		this.settings.printExport = normalizePrintExportSettings(printExport);
		await this.persistPluginData();
	}

	async updateDefaultCardTheme(defaultCardTheme: CardTheme): Promise<void> {
		this.settings.defaultCardTheme = normalizeCardDesignProfile({
			...createCardDesignProfile(getCardDesignDefaults(this.settings)),
			theme: defaultCardTheme,
		}).theme;
		await this.persistPluginData();
		this.notifyDesignDefaultsChanged();
	}

	async updateDefaultArtworkSize(defaultArtworkSize: CardArtworkSize): Promise<void> {
		this.settings.defaultArtworkSize = normalizeCardDesignProfile({
			...createCardDesignProfile(getCardDesignDefaults(this.settings)),
			artworkSize: defaultArtworkSize,
		}).artworkSize;
		await this.persistPluginData();
		this.notifyDesignDefaultsChanged();
	}

	async updateDefaultCardDensity(defaultCardDensity: CardDensity): Promise<void> {
		this.settings.defaultCardDensity = normalizeCardDesignProfile({
			...createCardDesignProfile(getCardDesignDefaults(this.settings)),
			density: defaultCardDensity,
		}).density;
		await this.persistPluginData();
		this.notifyDesignDefaultsChanged();
	}

	async rebuildItemIndex(): Promise<ItemIndexResult> {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}

		const rebuild = this.itemIndex.rebuild(this.settings.itemFolder);
		this.indexReadyPromise = rebuild;
		try {
			const result = await rebuild;
			this.initialIndexReady = true;
			return result;
		} catch (error) {
			console.error('TTRPG Card Forge: item index rebuild failed', error);
			new Notice('TTRPG Card Forge could not rebuild the item index. See the developer console for details.');
			throw error;
		} finally {
			if (this.indexReadyPromise === rebuild) {
				this.indexReadyPromise = null;
			}
		}
	}

	private async ensureItemIndexReady(): Promise<void> {
		if (this.initialIndexReady) {
			return;
		}
		if (this.indexReadyPromise) {
			await this.indexReadyPromise;
			return;
		}
		await this.rebuildItemIndex();
	}

	private queueIndexRebuild(delay = INDEX_REBUILD_DELAY_MS): void {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
		}

		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			void this.rebuildItemIndex().catch(() => undefined);
		}, delay);
	}

	private isConfiguredItemFile(file: TAbstractFile): file is TFile {
		return file instanceof TFile
			&& file.extension.toLocaleLowerCase() === 'md'
			&& this.isConfiguredItemPath(file.path);
	}

	private isConfiguredItemPath(path: string): boolean {
		const folder = this.settings.itemFolder.trim().replaceAll('\\', '/').replace(/\/+$/u, '');
		return folder.length > 0 && path.startsWith(`${folder}/`);
	}

	private reconcilePhysicalPlanCache(items: readonly ItemCardData[]): void {
		const nextFingerprints = new Map<string, string>();
		for (const item of items) {
			const sourceFingerprint = this.itemIndex.getSourceFingerprint(item.filePath)
				?? 'source-unavailable';
			nextFingerprints.set(
				item.filePath,
				JSON.stringify([
					sourceFingerprint,
					createEffectiveItemFingerprint(item),
				]),
			);
		}

		const allPaths = new Set([
			...this.indexedInputFingerprints.keys(),
			...nextFingerprints.keys(),
		]);
		for (const filePath of allPaths) {
			if (
				this.indexedInputFingerprints.has(filePath)
				&& this.indexedInputFingerprints.get(filePath)
					!== nextFingerprints.get(filePath)
			) {
				this.physicalPlanCache.invalidateFile(filePath);
			}
		}
		this.indexedInputFingerprints = nextFingerprints;
	}

	private invalidateArtworkAndRebuild(artworkPath: string): void {
		this.physicalPlanCache.invalidateArtwork(artworkPath);
		this.queueIndexRebuild(0);
	}

	private async loadPluginData(): Promise<LoadedPluginData> {
		const saved = await this.loadData() as (
			Partial<CardForgeSettings> & LoadedPluginData
		) | null;
		const savedDesignDefaults = normalizeCardDesignProfile({
			theme: saved?.defaultCardTheme,
			artworkSize: saved?.defaultArtworkSize,
			density: saved?.defaultCardDensity,
		});
		this.settings = {
			itemFolder: typeof saved?.itemFolder === 'string'
				? saved.itemFolder
				: DEFAULT_SETTINGS.itemFolder,
			pdfExportFolder: typeof saved?.pdfExportFolder === 'string'
				? saved.pdfExportFolder
				: DEFAULT_SETTINGS.pdfExportFolder,
			cardForgeAssetsFolder: normalizeSavedArtworkAssetFolder(
				saved?.cardForgeAssetsFolder,
			),
			showCropMarks: typeof saved?.showCropMarks === 'boolean'
				? saved.showCropMarks
				: DEFAULT_SETTINGS.showCropMarks,
			openPdfAfterExport: typeof saved?.openPdfAfterExport === 'boolean'
				? saved.openPdfAfterExport
				: DEFAULT_SETTINGS.openPdfAfterExport,
			defaultCardTheme: savedDesignDefaults.theme,
			defaultArtworkSize: savedDesignDefaults.artworkSize,
			defaultCardDensity: savedDesignDefaults.density,
			printExport: normalizePrintExportSettings(saved?.printExport),
		};
		return {
			printQueue: saved?.printQueue,
			savedPrintSets: saved?.savedPrintSets,
			activeSavedSetId: saved?.activeSavedSetId,
		};
	}

	private notifyDesignDefaultsChanged(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CARD_FORGE_VIEW_TYPE)) {
			if (leaf.view instanceof CardForgeView) {
				leaf.view.onDesignDefaultsChanged();
			}
		}
	}

	private persistPluginData(): Promise<void> {
		this.saveChain = this.saveChain.catch(() => undefined).then(() => this.saveData({
			...this.settings,
			printQueue: this.printQueue.serialize(),
			savedPrintSets: this.savedPrintSets.serialize(),
			activeSavedSetId: this.savedPrintSetSession.activeSavedSetId ?? null,
		}));
		return this.saveChain;
	}

	private syncQueueTemporaryArtworkReferences(): void {
		this.temporaryArtworkStore.setOwnerReferences(
			QUEUE_ARTWORK_OWNER,
			collectTemporaryArtworkIds(
				this.printQueue.getEntries().map((entry) => entry.overrides),
			),
		);
	}

	private syncSavedSetTemporaryArtworkReferences(): void {
		this.temporaryArtworkStore.setOwnerReferences(
			SAVED_SET_ARTWORK_OWNER,
			collectTemporaryArtworkIds(
				this.savedPrintSets.getSets().flatMap((set) =>
					set.entries.map((entry) => entry.overrides),
				),
			),
		);
	}
}

function normalizeSavedArtworkAssetFolder(value: unknown): string {
	if (typeof value !== 'string') {
		return DEFAULT_SETTINGS.cardForgeAssetsFolder;
	}
	try {
		return normalizeArtworkAssetFolder(value);
	} catch {
		return DEFAULT_SETTINGS.cardForgeAssetsFolder;
	}
}
