import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';

import { ItemIndex, type ItemIndexResult } from './services/item-index';
import {
	deserializePrintQueue,
	PrintQueueService,
	type PrintQueueEntry,
} from './models/print-queue';
import type { ItemCardData } from './models/item';
import {
	DEFAULT_SETTINGS,
	CardForgeSettingTab,
	type CardForgeSettings,
} from './settings';
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

const INDEX_REBUILD_DELAY_MS = 350;
const QUEUE_ARTWORK_OWNER = 'print-queue';

export default class TTRPGCardForgePlugin extends Plugin {
	settings: CardForgeSettings = DEFAULT_SETTINGS;
	itemIndex!: ItemIndex;
	printQueue!: PrintQueueService;
	readonly planningPerformance = new PlanningPerformanceMonitor();
	readonly physicalPlanCache = new PhysicalPlanCache<FittedItemCardPlan>();
	readonly temporaryArtworkStore = new TemporaryArtworkStore();
	private indexedInputFingerprints = new Map<string, string>();
	private rebuildTimer: number | null = null;
	private unsubscribeFromIndex: (() => void) | null = null;
	private unsubscribeFromQueue: (() => void) | null = null;
	private removePerformanceDebugApi: (() => void) | null = null;
	private saveChain: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		const savedQueue = await this.loadPluginData();
		this.itemIndex = new ItemIndex(this.app);
		this.printQueue = new PrintQueueService(savedQueue);
		this.syncQueueTemporaryArtworkReferences();
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

		this.registerView(
			CARD_FORGE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CardForgeView(
				leaf,
				this.itemIndex,
				this.printQueue,
				() => this.settings,
				this.physicalPlanCache,
				this.planningPerformance,
				this.temporaryArtworkStore,
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
			void this.rebuildItemIndex().catch(() => undefined);
		});
	}

	onunload(): void {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromIndex = null;
		this.unsubscribeFromQueue?.();
		this.unsubscribeFromQueue = null;
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

	async activateView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(CARD_FORGE_VIEW_TYPE)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: CARD_FORGE_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
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
	}

	async updateShowCropMarks(showCropMarks: boolean): Promise<void> {
		this.settings.showCropMarks = showCropMarks;
		await this.persistPluginData();
	}

	async updateOpenPdfAfterExport(openPdfAfterExport: boolean): Promise<void> {
		this.settings.openPdfAfterExport = openPdfAfterExport;
		await this.persistPluginData();
	}

	async rebuildItemIndex(): Promise<ItemIndexResult> {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}

		try {
			return await this.itemIndex.rebuild(this.settings.itemFolder);
		} catch (error) {
			console.error('TTRPG Card Forge: item index rebuild failed', error);
			new Notice('TTRPG Card Forge could not rebuild the item index. See the developer console for details.');
			throw error;
		}
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

	private async loadPluginData(): Promise<PrintQueueEntry[]> {
		const saved = await this.loadData() as (
			Partial<CardForgeSettings> & { printQueue?: unknown }
		) | null;
		this.settings = {
			itemFolder: typeof saved?.itemFolder === 'string'
				? saved.itemFolder
				: DEFAULT_SETTINGS.itemFolder,
			pdfExportFolder: typeof saved?.pdfExportFolder === 'string'
				? saved.pdfExportFolder
				: DEFAULT_SETTINGS.pdfExportFolder,
			showCropMarks: typeof saved?.showCropMarks === 'boolean'
				? saved.showCropMarks
				: DEFAULT_SETTINGS.showCropMarks,
			openPdfAfterExport: typeof saved?.openPdfAfterExport === 'boolean'
				? saved.openPdfAfterExport
				: DEFAULT_SETTINGS.openPdfAfterExport,
		};
		return deserializePrintQueue(saved?.printQueue);
	}

	private persistPluginData(): Promise<void> {
		this.saveChain = this.saveChain.catch(() => undefined).then(() => this.saveData({
			...this.settings,
			printQueue: this.printQueue.serialize(),
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
}
