import type { ItemCardData } from './item';

export type ArtworkOrientation = 'portrait' | 'landscape' | 'square';

export type ItemCardLayout = 'image' | 'portrait' | 'compact' | 'text';

export type MarkdownBlock =
	| MarkdownParagraphBlock
	| MarkdownHeadingBlock
	| MarkdownListBlock
	| MarkdownTableBlock;

export interface MarkdownParagraphBlock {
	type: 'paragraph';
	markdown: string;
}

export interface MarkdownHeadingBlock {
	type: 'heading';
	level: 2 | 3;
	markdown: string;
}

export interface MarkdownListBlock {
	type: 'unordered-list' | 'ordered-list';
	items: string[];
}

export interface MarkdownTableBlock {
	type: 'table';
	headers: string[];
	rows: string[][];
}

export type ItemStatsPresentation = 'compact' | 'full';

export type ItemCardPageKind = 'primary' | 'continuation' | 'crafting';

export interface ItemCardPage {
	item: ItemCardData;
	pageIndex: number;
	pageCount: number;
	kind: ItemCardPageKind;
	title: string;
	blocks: MarkdownBlock[];
	layout: ItemCardLayout;
	bodyFontPoints?: number;
	showArtwork: boolean;
	showStats: boolean;
	statsPresentation?: ItemStatsPresentation;
	showSource: boolean;
	artworkOrientation?: ArtworkOrientation;
	hasUnsplitOverflow: boolean;
}
