import { ItemView, WorkspaceLeaf } from 'obsidian';

import type { ItemCardData } from '../models/item';
import type { ItemIndex } from '../services/item-index';

export const CARD_FORGE_VIEW_TYPE = 'ttrpg-card-forge-view';

export class CardForgeView extends ItemView {
	private searchInput: HTMLInputElement | null = null;
	private countElement: HTMLElement | null = null;
	private resultsElement: HTMLElement | null = null;
	private unsubscribeFromIndex: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly itemIndex: ItemIndex) {
		super(leaf);
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
		container.addClass('card-forge-view');

		const header = container.createDiv({ cls: 'card-forge-view__header' });
		header.createEl('h2', { text: 'TTRPG Card Forge' });
		header.createEl('p', {
			text: 'Browse structured item notes indexed from your vault.',
			cls: 'card-forge-view__subtitle',
		});

		const toolbar = container.createDiv({ cls: 'card-forge-view__toolbar' });
		this.searchInput = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search items…',
			cls: 'card-forge-view__search',
			attr: { 'aria-label': 'Search indexed items' },
		});
		this.countElement = toolbar.createDiv({ cls: 'card-forge-view__count' });
		this.resultsElement = container.createDiv({ cls: 'card-forge-results' });

		this.registerDomEvent(this.searchInput, 'input', () => this.renderResults());
		this.unsubscribeFromIndex = this.itemIndex.subscribe(() => this.renderResults());
		this.renderResults();
	}

	async onClose(): Promise<void> {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromIndex = null;
		this.searchInput = null;
		this.countElement = null;
		this.resultsElement = null;
	}

	private renderResults(): void {
		if (!this.resultsElement || !this.countElement) {
			return;
		}

		const query = this.searchInput?.value.trim().toLocaleLowerCase() ?? '';
		const allItems = this.itemIndex.getItems();
		const items = query.length === 0
			? allItems
			: allItems.filter((item) => isSearchMatch(item, query));

		this.countElement.setText(formatItemCount(items.length, allItems.length, query));
		this.resultsElement.empty();

		if (items.length === 0) {
			this.resultsElement.createDiv({
				cls: 'card-forge-results__empty',
				text: query.length > 0
					? 'No indexed items match this search.'
					: 'No items are indexed. Check the item folder in settings, then rebuild the index.',
			});
			return;
		}

		for (const item of items) {
			this.renderItem(item);
		}
	}

	private renderItem(item: ItemCardData): void {
		if (!this.resultsElement) {
			return;
		}

		const result = this.resultsElement.createDiv({ cls: 'card-forge-result' });
		const title = result.createEl('button', {
			text: item.name,
			cls: 'card-forge-result__title clickable-icon',
			attr: {
				type: 'button',
				'aria-label': `Open ${item.name}`,
			},
		});
		this.registerDomEvent(title, 'click', () => {
			void this.app.workspace.openLinkText(item.filePath, '', false);
		});

		if (item.detail) {
			result.createDiv({ text: item.detail, cls: 'card-forge-result__detail' });
		}

		const metadata = result.createDiv({ cls: 'card-forge-result__metadata' });
		if (item.rarity) {
			metadata.createSpan({ text: humanizeSlug(item.rarity) });
		}
		if (item.source) {
			metadata.createSpan({ text: item.source.toLocaleUpperCase() });
		}
		if (item.attunement) {
			metadata.createSpan({ text: 'Requires attunement' });
		}
	}
}

function isSearchMatch(item: ItemCardData, query: string): boolean {
	return [item.name, item.rarity, item.source, item.detail]
		.filter((value): value is string => Boolean(value))
		.some((value) => value.toLocaleLowerCase().includes(query));
}

function formatItemCount(visible: number, total: number, query: string): string {
	if (query.length > 0) {
		return `${visible} of ${total} items`;
	}
	return `${total} ${total === 1 ? 'item' : 'items'}`;
}

function humanizeSlug(value: string): string {
	return value
		.split('-')
		.map((part) => part.length > 0 ? `${part[0]?.toLocaleUpperCase()}${part.slice(1)}` : part)
		.join(' ');
}
