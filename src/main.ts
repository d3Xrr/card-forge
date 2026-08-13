import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';

import { ItemIndex, type ItemIndexResult } from './services/item-index';
import {
	DEFAULT_SETTINGS,
	CardForgeSettingTab,
	type CardForgeSettings,
} from './settings';
import { CARD_FORGE_VIEW_TYPE, CardForgeView } from './views/card-forge-view';

const INDEX_REBUILD_DELAY_MS = 350;

export default class TTRPGCardForgePlugin extends Plugin {
	settings: CardForgeSettings = DEFAULT_SETTINGS;
	itemIndex!: ItemIndex;
	private rebuildTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.itemIndex = new ItemIndex(this.app);

		this.registerView(
			CARD_FORGE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CardForgeView(leaf, this.itemIndex),
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
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (this.isConfiguredItemPath(file.path) || this.isConfiguredItemPath(oldPath)) {
				this.queueIndexRebuild();
			}
		}));
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (this.isConfiguredItemFile(file)) {
				this.queueIndexRebuild();
			}
		}));

		this.app.workspace.onLayoutReady(() => {
			void this.rebuildItemIndex().catch(() => undefined);
		});
	}

	onunload(): void {
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
		await this.saveData(this.settings);
		this.queueIndexRebuild();
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

	private async loadSettings(): Promise<void> {
		const savedSettings = await this.loadData() as Partial<CardForgeSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings ?? {});
	}
}
