import type { App, TFile } from 'obsidian';
import { normalizePath } from 'obsidian';

import type { ItemCardData } from '../models/item';
import { parseItemFrontmatter } from '../parsers/item-parser';

export interface ItemIndexResult {
	indexed: number;
	scanned: number;
	errors: number;
}

type IndexListener = (items: readonly ItemCardData[]) => void;

export class ItemIndex {
	private items: ItemCardData[] = [];
	private readonly listeners = new Set<IndexListener>();
	private buildNumber = 0;

	constructor(private readonly app: App) {}

	getItems(): readonly ItemCardData[] {
		return this.items;
	}

	subscribe(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async rebuild(itemFolder: string): Promise<ItemIndexResult> {
		const currentBuild = ++this.buildNumber;
		const folder = normalizePath(itemFolder.trim()).replace(/\/$/u, '');

		if (folder.length === 0) {
			this.commit(currentBuild, []);
			return { indexed: 0, scanned: 0, errors: 0 };
		}

		const files = this.app.vault.getMarkdownFiles().filter((file) =>
			isFileInFolder(file, folder),
		);
		const indexedItems: ItemCardData[] = [];
		let errors = 0;

		for (const file of files) {
			try {
				const cache = this.app.metadataCache.getFileCache(file);
				const item = parseItemFrontmatter(file.path, cache?.frontmatter);
				if (item) {
					indexedItems.push(item);
				}
			} catch (error) {
				errors += 1;
				console.warn(
					`TTRPG Card Forge: could not index ${file.path}`,
					error,
				);
			}
		}

		indexedItems.sort((left, right) =>
			left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
		);
		this.commit(currentBuild, indexedItems);

		return {
			indexed: indexedItems.length,
			scanned: files.length,
			errors,
		};
	}

	private commit(buildNumber: number, items: ItemCardData[]): void {
		if (buildNumber !== this.buildNumber) {
			return;
		}

		this.items = items;
		for (const listener of this.listeners) {
			listener(this.items);
		}
	}
}

function isFileInFolder(file: TFile, folder: string): boolean {
	return file.extension.toLocaleLowerCase() === 'md'
		&& file.path.startsWith(`${folder}/`);
}
