import {
	Notice,
	PluginSettingTab,
	Setting,
	type SettingDefinitionItem,
} from 'obsidian';

import type TTRPGCardForgePlugin from './main';
import { DEFAULT_PDF_EXPORT_FOLDER } from './export/vault-pdf-storage';
import { CARD_FORGE_ASSET_FOLDER } from './services/artwork-importer-core';

export interface CardForgeSettings {
	itemFolder: string;
	pdfExportFolder: string;
	cardForgeAssetsFolder: string;
	showCropMarks: boolean;
	openPdfAfterExport: boolean;
}

export const DEFAULT_SETTINGS: CardForgeSettings = {
	itemFolder: '2. Mechanics/items',
	pdfExportFolder: DEFAULT_PDF_EXPORT_FOLDER,
	cardForgeAssetsFolder: CARD_FORGE_ASSET_FOLDER,
	showCropMarks: true,
	openPdfAfterExport: false,
};

export class CardForgeSettingTab extends PluginSettingTab {
	constructor(private readonly plugin: TTRPGCardForgePlugin) {
		super(plugin.app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Item folder')
			.setDesc('Vault-relative folder containing TTRPG CLI item notes.')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.itemFolder)
				.setValue(this.plugin.settings.itemFolder)
				.onChange(async (value) => {
					await this.plugin.updateItemFolder(value);
				}));

		new Setting(containerEl)
			.setName('PDF export folder')
			.setDesc('Vault-relative folder where generated PDF files are saved.')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.pdfExportFolder)
				.setValue(this.plugin.settings.pdfExportFolder)
				.onChange(async (value) => {
					await this.plugin.updatePdfExportFolder(value);
				}));

		const assetsFolderSetting = new Setting(containerEl)
			.setName('Card Forge assets folder')
			.setDesc('Vault-relative folder used for newly persisted Card Forge artwork.');
		assetsFolderSetting.addText((text) => text
			.setPlaceholder(DEFAULT_SETTINGS.cardForgeAssetsFolder)
			.setValue(this.plugin.settings.cardForgeAssetsFolder)
			.onChange(async (value) => {
				try {
					await this.plugin.updateCardForgeAssetsFolder(value);
					assetsFolderSetting.settingEl.removeClass('is-invalid');
					text.inputEl.removeAttribute('aria-invalid');
					assetsFolderSetting.setDesc(
						'Vault-relative folder used for newly persisted Card Forge artwork.',
					);
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Invalid vault folder.';
					assetsFolderSetting.settingEl.addClass('is-invalid');
					text.inputEl.setAttribute('aria-invalid', 'true');
					assetsFolderSetting.setDesc(message);
				}
			}));

		new Setting(containerEl)
			.setName('Show crop marks')
			.setDesc('Draw thin cut marks outside each physical card. No bleed is added.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.showCropMarks)
				.onChange(async (value) => {
					await this.plugin.updateShowCropMarks(value);
				}));

		new Setting(containerEl)
			.setName('Open PDF after export')
			.setDesc('Open the newly generated PDF in an Obsidian tab after saving it.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.openPdfAfterExport)
				.onChange(async (value) => {
					await this.plugin.updateOpenPdfAfterExport(value);
				}));

		const rebuildSetting = new Setting(containerEl)
			.setName('Rebuild item index')
			.setDesc('Rescan the configured folder using Obsidian’s metadata cache.');
		this.addRebuildButton(rebuildSetting);
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof CardForgeSettings>[] {
		return [
			{
				name: 'Item folder',
				desc: 'Vault-relative folder containing TTRPG CLI item notes.',
				control: {
					type: 'folder',
					key: 'itemFolder',
					defaultValue: DEFAULT_SETTINGS.itemFolder,
					placeholder: DEFAULT_SETTINGS.itemFolder,
				},
			},
			{
				name: 'PDF export folder',
				desc: 'Vault-relative folder where generated PDF files are saved.',
				control: {
					type: 'folder',
					key: 'pdfExportFolder',
					defaultValue: DEFAULT_SETTINGS.pdfExportFolder,
					placeholder: DEFAULT_SETTINGS.pdfExportFolder,
				},
			},
			{
				name: 'Card Forge assets folder',
				desc: 'Vault-relative folder used for newly persisted Card Forge artwork.',
				control: {
					type: 'folder',
					key: 'cardForgeAssetsFolder',
					defaultValue: DEFAULT_SETTINGS.cardForgeAssetsFolder,
					placeholder: DEFAULT_SETTINGS.cardForgeAssetsFolder,
				},
			},
			{
				name: 'Show crop marks',
				desc: 'Draw thin cut marks outside each physical card. No bleed is added.',
				control: {
					type: 'toggle',
					key: 'showCropMarks',
					defaultValue: DEFAULT_SETTINGS.showCropMarks,
				},
			},
			{
				name: 'Open PDF after export',
				desc: 'Open the newly generated PDF in Obsidian after saving it.',
				control: {
					type: 'toggle',
					key: 'openPdfAfterExport',
					defaultValue: DEFAULT_SETTINGS.openPdfAfterExport,
				},
			},
			{
				name: 'Rebuild item index',
				desc: 'Rescan the configured folder using Obsidian’s metadata cache.',
				render: (setting) => this.addRebuildButton(setting),
			},
		];
	}

	getControlValue(key: string): unknown {
		return key in this.plugin.settings
			? this.plugin.settings[key as keyof CardForgeSettings]
			: undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'itemFolder' && typeof value === 'string') {
			await this.plugin.updateItemFolder(value);
		} else if (key === 'pdfExportFolder' && typeof value === 'string') {
			await this.plugin.updatePdfExportFolder(value);
		} else if (key === 'cardForgeAssetsFolder' && typeof value === 'string') {
			await this.plugin.updateCardForgeAssetsFolder(value);
		} else if (key === 'showCropMarks' && typeof value === 'boolean') {
			await this.plugin.updateShowCropMarks(value);
		} else if (key === 'openPdfAfterExport' && typeof value === 'boolean') {
			await this.plugin.updateOpenPdfAfterExport(value);
		}
	}

	private addRebuildButton(setting: Setting): void {
		setting.addButton((button) => button
			.setButtonText('Rebuild item index')
			.setCta()
			.onClick(async () => {
				button.setDisabled(true);
				button.setButtonText('Rebuilding…');
				try {
					const result = await this.plugin.rebuildItemIndex();
					new Notice(`TTRPG Card Forge indexed ${result.indexed} items.`);
				} finally {
					button.setDisabled(false);
					button.setButtonText('Rebuild item index');
				}
			}));
	}
}
