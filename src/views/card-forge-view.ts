import { ItemView, WorkspaceLeaf } from 'obsidian';

import type { ItemCardData } from '../models/item';
import { ItemCardRenderer, type RenderedItemCard } from '../renderer/item-card-renderer';
import { formatLayoutName } from '../renderer/item-card-layout';
import { getArtworkResourcePath } from '../services/artwork-resolver';
import type { ItemIndex } from '../services/item-index';

export const CARD_FORGE_VIEW_TYPE = 'ttrpg-card-forge-view';

export class CardForgeView extends ItemView {
	private readonly cardRenderer = new ItemCardRenderer();
	private searchInput: HTMLInputElement | null = null;
	private totalCountElement: HTMLElement | null = null;
	private filteredCountElement: HTMLElement | null = null;
	private resultsElement: HTMLElement | null = null;
	private cardHostElement: HTMLElement | null = null;
	private diagnosticsElement: HTMLElement | null = null;
	private openSourceButton: HTMLButtonElement | null = null;
	private selectedFilePath: string | null = null;
	private unsubscribeFromIndex: (() => void) | null = null;
	private overflowFrame: number | null = null;

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
		container.addClass('ttrpg-card-forge');

		const header = container.createDiv({ cls: 'ttrpg-card-forge__header' });
		const headingGroup = header.createDiv({ cls: 'ttrpg-card-forge__heading-group' });
		headingGroup.createEl('h2', {
			text: 'TTRPG Card Forge',
			cls: 'ttrpg-card-forge__heading',
		});
		headingGroup.createDiv({
			text: 'Item card rendering preview',
			cls: 'ttrpg-card-forge__subtitle',
		});
		this.totalCountElement = header.createDiv({ cls: 'ttrpg-card-forge__total-count' });

		const workspace = container.createDiv({ cls: 'ttrpg-card-forge__workspace' });
		const browser = workspace.createEl('section', {
			cls: 'ttrpg-card-forge__browser',
			attr: { 'aria-label': 'Item browser' },
		});
		const browserToolbar = browser.createDiv({ cls: 'ttrpg-card-forge__browser-toolbar' });
		this.searchInput = browserToolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search items…',
			cls: 'ttrpg-card-forge__search',
			attr: { 'aria-label': 'Search indexed items' },
		});
		this.filteredCountElement = browserToolbar.createDiv({
			cls: 'ttrpg-card-forge__filtered-count',
		});
		this.resultsElement = browser.createDiv({
			cls: 'ttrpg-card-forge__results',
			attr: { role: 'listbox', 'aria-label': 'Indexed items' },
		});

		const preview = workspace.createEl('section', {
			cls: 'ttrpg-card-forge__preview',
			attr: { 'aria-label': 'Card preview' },
		});
		preview.createEl('h3', {
			text: 'Card preview',
			cls: 'ttrpg-card-forge__preview-heading',
		});
		this.cardHostElement = preview.createDiv({ cls: 'ttrpg-card-forge__card-host' });
		this.diagnosticsElement = preview.createDiv({ cls: 'ttrpg-card-forge__diagnostics' });
		this.openSourceButton = preview.createEl('button', {
			text: 'Open source note',
			cls: 'ttrpg-card-forge__open-source',
			attr: { type: 'button' },
		});

		this.registerDomEvent(this.searchInput, 'input', () => this.render());
		this.registerDomEvent(this.openSourceButton, 'click', () => this.openSelectedItem());
		this.unsubscribeFromIndex = this.itemIndex.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromIndex = null;
		if (this.overflowFrame !== null) {
			window.cancelAnimationFrame(this.overflowFrame);
			this.overflowFrame = null;
		}
		this.containerEl.children[1]?.removeClass('ttrpg-card-forge');
		this.searchInput = null;
		this.totalCountElement = null;
		this.filteredCountElement = null;
		this.resultsElement = null;
		this.cardHostElement = null;
		this.diagnosticsElement = null;
		this.openSourceButton = null;
	}

	private render(): void {
		if (!this.resultsElement || !this.totalCountElement || !this.filteredCountElement) {
			return;
		}

		const allItems = this.itemIndex.getItems();
		const query = this.searchInput?.value.trim().toLocaleLowerCase() ?? '';
		const visibleItems = query.length === 0
			? allItems
			: allItems.filter((item) => isSearchMatch(item, query));

		this.totalCountElement.setText(formatItemCount(allItems.length));
		this.filteredCountElement.setText(query.length > 0
			? `${visibleItems.length} results`
			: formatItemCount(visibleItems.length));

		if (!visibleItems.some((item) => item.filePath === this.selectedFilePath)) {
			this.selectedFilePath = visibleItems[0]?.filePath ?? null;
		}

		this.renderItemList(visibleItems, query);
		this.renderPreview();
	}

	private renderItemList(items: readonly ItemCardData[], query: string): void {
		if (!this.resultsElement) {
			return;
		}

		this.resultsElement.empty();
		if (items.length === 0) {
			this.resultsElement.createDiv({
				cls: 'ttrpg-card-forge__empty',
				text: query.length > 0
					? 'No indexed items match this search.'
					: 'No items are indexed. Check the item folder in settings, then rebuild the index.',
			});
			return;
		}

		for (const item of items) {
			const isSelected = item.filePath === this.selectedFilePath;
			const result = this.resultsElement.createEl('button', {
				cls: `ttrpg-card-forge__result${isSelected ? ' is-selected' : ''}`,
				attr: {
					type: 'button',
					role: 'option',
					'aria-selected': isSelected ? 'true' : 'false',
				},
			});
			result.dataset.filePath = item.filePath;
			result.createDiv({ text: item.name, cls: 'ttrpg-card-forge__result-name' });

			const resultMetadata = result.createDiv({ cls: 'ttrpg-card-forge__result-metadata' });
			if (item.rarity) {
				resultMetadata.createSpan({ text: humanizeSlug(item.rarity) });
			}
			if (item.source) {
				resultMetadata.createSpan({ text: item.source.toLocaleUpperCase() });
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
		if (this.resultsElement) {
			for (const child of Array.from(this.resultsElement.children)) {
				if (!child.instanceOf(HTMLButtonElement)) {
					continue;
				}
				const isSelected = child.dataset.filePath === filePath;
				child.toggleClass('is-selected', isSelected);
				child.setAttribute('aria-selected', isSelected ? 'true' : 'false');
			}
		}
		this.renderPreview();
	}

	private renderPreview(): void {
		if (!this.cardHostElement || !this.diagnosticsElement || !this.openSourceButton) {
			return;
		}

		if (this.overflowFrame !== null) {
			window.cancelAnimationFrame(this.overflowFrame);
			this.overflowFrame = null;
		}

		const selectedItem = this.itemIndex.getItems()
			.find((item) => item.filePath === this.selectedFilePath);
		this.cardHostElement.empty();
		this.diagnosticsElement.empty();
		this.openSourceButton.toggleAttribute('disabled', !selectedItem);

		if (!selectedItem) {
			this.cardHostElement.createDiv({
				cls: 'ttrpg-card-forge__preview-empty',
				text: 'Select an item to preview its card.',
			});
			return;
		}

		const artworkResourcePath = getArtworkResourcePath(this.app, selectedItem);
		const renderedCard = this.cardRenderer.render(
			this.cardHostElement,
			selectedItem,
			artworkResourcePath,
		);
		this.renderDiagnostics(selectedItem, renderedCard, artworkResourcePath);
	}

	private renderDiagnostics(
		item: ItemCardData,
		renderedCard: RenderedItemCard,
		artworkResourcePath?: string,
	): void {
		if (!this.diagnosticsElement) {
			return;
		}

		const layoutElement = this.diagnosticsElement.createSpan({
			text: `Layout: ${formatLayoutName(renderedCard.layout)}`,
		});
		if (item.imagePath && !artworkResourcePath) {
			this.diagnosticsElement.createSpan({ text: 'Artwork unavailable' });
		} else if (!item.imagePath) {
			this.diagnosticsElement.createSpan({ text: 'No artwork' });
		}

		this.overflowFrame = window.requestAnimationFrame(() => {
			this.overflowFrame = null;
			if (renderedCard.hasOverflow()) {
				layoutElement.addClass('is-warning');
				layoutElement.setText(`Layout: ${formatLayoutName(renderedCard.layout)} · Content needs fitting`);
			}
		});
	}

	private openSelectedItem(): void {
		const item = this.itemIndex.getItems()
			.find((candidate) => candidate.filePath === this.selectedFilePath);
		if (item) {
			this.openItem(item);
		}
	}

	private openItem(item: ItemCardData): void {
		void this.app.workspace.openLinkText(item.filePath, '', false);
	}
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
		.map((part) => part.length > 0
			? `${part[0]?.toLocaleUpperCase()}${part.slice(1)}`
			: part)
		.join(' ');
}
