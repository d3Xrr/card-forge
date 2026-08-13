import {
	Notice,
	PluginSettingTab,
	Setting,
	type SettingDefinitionItem,
} from 'obsidian';

import type TTRPGCardForgePlugin from './main';

export interface CardForgeSettings {
	itemFolder: string;
}

export const DEFAULT_SETTINGS: CardForgeSettings = {
	itemFolder: '2. Mechanics/items',
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

		const rebuildSetting = new Setting(containerEl)
			.setName('Rebuild item index')
			.setDesc('Rescan the configured folder using Obsidian’s metadata cache.');
		this.addRebuildButton(rebuildSetting);
	}

	getSettingDefinitions(): SettingDefinitionItem<'itemFolder'>[] {
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
				name: 'Rebuild item index',
				desc: 'Rescan the configured folder using Obsidian’s metadata cache.',
				render: (setting) => this.addRebuildButton(setting),
			},
		];
	}

	getControlValue(key: string): unknown {
		return key === 'itemFolder' ? this.plugin.settings.itemFolder : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'itemFolder' && typeof value === 'string') {
			await this.plugin.updateItemFolder(value);
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
