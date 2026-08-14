import type { App, TFile } from 'obsidian';
import { normalizePath } from 'obsidian';

import type { ItemCardData } from '../models/item';
import { isCliItem, parseItemFrontmatter } from '../parsers/item-parser';
import { resolveArtworkFile } from './artwork-resolver';
import { createSourceContentFingerprint } from './physical-plan-cache';

export interface ItemIndexResult {
	indexed: number;
	scanned: number;
	errors: number;
}

export interface IndexedSourceRevision {
	modifiedTime: number;
	size: number;
}

type IndexListener = (items: readonly ItemCardData[]) => void;

export class ItemIndex {
	private items: ItemCardData[] = [];
	private sourceFingerprints = new Map<string, string>();
	private sourceRevisions = new Map<string, IndexedSourceRevision>();
	private readonly listeners = new Set<IndexListener>();
	private buildNumber = 0;

	constructor(private readonly app: App) {}

	getItems(): readonly ItemCardData[] {
		return this.items;
	}

	getSourceFingerprint(filePath: string): string | undefined {
		return this.sourceFingerprints.get(filePath);
	}

	getSourceRevision(filePath: string): IndexedSourceRevision | undefined {
		return this.sourceRevisions.get(filePath);
	}

	subscribe(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async rebuild(itemFolder: string): Promise<ItemIndexResult> {
		const currentBuild = ++this.buildNumber;
		const folder = normalizePath(itemFolder.trim()).replace(/\/$/u, '');

		if (folder.length === 0) {
			this.commit(currentBuild, [], new Map(), new Map());
			return { indexed: 0, scanned: 0, errors: 0 };
		}

		const files = this.app.vault.getMarkdownFiles().filter((file) =>
			isFileInFolder(file, folder),
		);
		const indexedItems: ItemCardData[] = [];
		const sourceFingerprints = new Map<string, string>();
		const sourceRevisions = new Map<string, IndexedSourceRevision>();
		let errors = 0;

		for (const file of files) {
			try {
				const cache = this.app.metadataCache.getFileCache(file);
				if (!isCliItem(cache?.frontmatter)) {
					continue;
				}

				const markdown = await this.app.vault.cachedRead(file);
				const item = parseItemFrontmatter(file.path, cache?.frontmatter, markdown);
				if (item) {
					item.hasImage = resolveArtworkFile(this.app, item) !== null;
					indexedItems.push(item);
					sourceFingerprints.set(
						item.filePath,
						createSourceContentFingerprint(
							markdown,
							file.stat.mtime,
							file.stat.size,
						),
					);
					sourceRevisions.set(item.filePath, {
						modifiedTime: file.stat.mtime,
						size: file.stat.size,
					});
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
		this.commit(
			currentBuild,
			indexedItems,
			sourceFingerprints,
			sourceRevisions,
		);

		return {
			indexed: indexedItems.length,
			scanned: files.length,
			errors,
		};
	}

	private commit(
		buildNumber: number,
		items: ItemCardData[],
		sourceFingerprints: Map<string, string>,
		sourceRevisions: Map<string, IndexedSourceRevision>,
	): void {
		if (buildNumber !== this.buildNumber) {
			return;
		}

		this.items = items;
		this.sourceFingerprints = sourceFingerprints;
		this.sourceRevisions = sourceRevisions;
		for (const listener of this.listeners) {
			listener(this.items);
		}
	}
}

function isFileInFolder(file: TFile, folder: string): boolean {
	return file.extension.toLocaleLowerCase() === 'md'
		&& file.path.startsWith(`${folder}/`);
}
