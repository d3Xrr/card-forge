import type { MarkdownBlock } from '../models/item-card-page';

export type { MarkdownBlock } from '../models/item-card-page';

export interface DescriptionHeading {
	level: 2 | 3;
	text: string;
}

export interface ItemDescriptionSections {
	main: MarkdownBlock[];
	crafting: MarkdownBlock[];
}

export function parseSemanticMarkdown(markdown: string): MarkdownBlock[] {
	const lines = markdown.replaceAll('\r\n', '\n').split('\n');
	const blocks: MarkdownBlock[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (line.trim().length === 0) {
			index += 1;
			continue;
		}

		const heading = parseDescriptionHeading(line);
		if (heading) {
			blocks.push({ type: 'heading', level: heading.level, markdown: heading.text });
			index += 1;
			continue;
		}

		const unorderedItem = matchUnorderedListItem(line);
		if (unorderedItem !== null) {
			const items: string[] = [];
			while (index < lines.length) {
				const item = matchUnorderedListItem(lines[index] ?? '');
				if (item === null) {
					break;
				}
				items.push(item);
				index += 1;
			}
			blocks.push({ type: 'unordered-list', items });
			continue;
		}

		const orderedItem = matchOrderedListItem(line);
		if (orderedItem !== null) {
			const items: string[] = [];
			while (index < lines.length) {
				const item = matchOrderedListItem(lines[index] ?? '');
				if (item === null) {
					break;
				}
				items.push(item);
				index += 1;
			}
			blocks.push({ type: 'ordered-list', items });
			continue;
		}

		const paragraphLines: string[] = [];
		while (index < lines.length) {
			const paragraphLine = lines[index] ?? '';
			if (
				paragraphLine.trim().length === 0
				|| parseDescriptionHeading(paragraphLine) !== null
				|| matchUnorderedListItem(paragraphLine) !== null
				|| matchOrderedListItem(paragraphLine) !== null
			) {
				break;
			}
			paragraphLines.push(paragraphLine.trim());
			index += 1;
		}
		blocks.push({ type: 'paragraph', markdown: paragraphLines.join('\n') });
	}

	return blocks;
}

export function partitionCraftingSection(blocks: readonly MarkdownBlock[]): ItemDescriptionSections {
	const main: MarkdownBlock[] = [];
	const crafting: MarkdownBlock[] = [];
	let inCraftingSection = false;

	for (const block of blocks) {
		if (block.type === 'heading' && block.level === 2) {
			inCraftingSection = block.markdown.trim().toLocaleLowerCase() === 'crafting';
		}
		(inCraftingSection ? crafting : main).push(cloneMarkdownBlock(block));
	}

	return { main, crafting };
}

export function serializeSemanticMarkdown(blocks: readonly MarkdownBlock[]): string {
	return blocks.map((block) => {
		switch (block.type) {
			case 'heading':
				return `${'#'.repeat(block.level)} ${block.markdown}`;
			case 'unordered-list':
				return block.items.map((item) => `- ${item}`).join('\n');
			case 'ordered-list':
				return block.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
			case 'paragraph':
				return block.markdown;
		}
	}).join('\n\n');
}

export function parseDescriptionHeading(line: string): DescriptionHeading | null {
	const match = line.match(/^\s*(#{2,3})\s+(.+?)\s*#*\s*$/u);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	const text = match[2].trim();
	if (text.length === 0) {
		return null;
	}

	return {
		level: match[1].length as 2 | 3,
		text,
	};
}

export function cloneMarkdownBlock(block: MarkdownBlock): MarkdownBlock {
	return block.type === 'unordered-list' || block.type === 'ordered-list'
		? { ...block, items: [...block.items] }
		: { ...block };
}

function matchUnorderedListItem(line: string): string | null {
	return line.match(/^\s*[-+*]\s+(.+)$/u)?.[1] ?? null;
}

function matchOrderedListItem(line: string): string | null {
	return line.match(/^\s*\d+[.)]\s+(.+)$/u)?.[1] ?? null;
}
