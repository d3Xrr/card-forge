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

interface ParsedMarkdownTable {
	block: Extract<MarkdownBlock, { type: 'table' }>;
	nextIndex: number;
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
		if (isStandaloneObsidianBlockId(line)) {
			index += 1;
			continue;
		}

		const heading = parseDescriptionHeading(line);
		if (heading) {
			blocks.push({ type: 'heading', level: heading.level, markdown: heading.text });
			index += 1;
			continue;
		}

		const table = parseMarkdownTable(lines, index);
		if (table) {
			blocks.push(table.block);
			index = table.nextIndex;
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
				|| isStandaloneObsidianBlockId(paragraphLine)
				|| parseDescriptionHeading(paragraphLine) !== null
				|| parseMarkdownTable(lines, index) !== null
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
			case 'table':
				return serializeMarkdownTable(block);
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
	if (block.type === 'unordered-list' || block.type === 'ordered-list') {
		return { ...block, items: [...block.items] };
	}
	if (block.type === 'table') {
		return {
			...block,
			headers: [...block.headers],
			rows: block.rows.map((row) => [...row]),
		};
	}
	return { ...block };
}

export function isStandaloneObsidianBlockId(line: string): boolean {
	return /^\s*\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/u.test(line);
}

function parseMarkdownTable(
	lines: readonly string[],
	startIndex: number,
): ParsedMarkdownTable | null {
	const headerLine = lines[startIndex];
	const separatorLine = lines[startIndex + 1];
	if (!headerLine || !separatorLine || !headerLine.includes('|')) {
		return null;
	}

	const headers = splitMarkdownTableRow(headerLine);
	const separators = splitMarkdownTableRow(separatorLine);
	if (
		headers.length === 0
		|| separators.length !== headers.length
		|| !separators.every((cell) => /^:?-{3,}:?$/u.test(cell))
	) {
		return null;
	}

	const rows: string[][] = [];
	let index = startIndex + 2;
	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (line.trim().length === 0 || isStandaloneObsidianBlockId(line) || !line.includes('|')) {
			break;
		}
		const cells = splitMarkdownTableRow(line);
		if (cells.length === 0) {
			break;
		}
		rows.push(normalizeTableRow(cells, headers.length));
		index += 1;
	}

	return {
		block: { type: 'table', headers, rows },
		nextIndex: index,
	};
}

function splitMarkdownTableRow(line: string): string[] {
	let content = line.trim();
	if (content.startsWith('|')) {
		content = content.slice(1);
	}
	if (content.endsWith('|') && !content.endsWith('\\|')) {
		content = content.slice(0, -1);
	}

	const cells: string[] = [];
	let current = '';
	for (let index = 0; index < content.length; index += 1) {
		const character = content[index];
		if (character === '\\' && content[index + 1] === '|') {
			current += '|';
			index += 1;
			continue;
		}
		if (character === '|') {
			cells.push(current.trim());
			current = '';
			continue;
		}
		current += character;
	}
	cells.push(current.trim());
	return cells;
}

function normalizeTableRow(cells: readonly string[], columnCount: number): string[] {
	return Array.from(
		{ length: columnCount },
		(_, index) => cells[index] ?? '',
	);
}

function serializeMarkdownTable(
	block: Extract<MarkdownBlock, { type: 'table' }>,
): string {
	const row = (cells: readonly string[]): string =>
		`| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`;
	return [
		row(block.headers),
		row(block.headers.map(() => '---')),
		...block.rows.map(row),
	].join('\n');
}

function matchUnorderedListItem(line: string): string | null {
	return line.match(/^\s*[-+*]\s+(.+)$/u)?.[1] ?? null;
}

function matchOrderedListItem(line: string): string | null {
	return line.match(/^\s*\d+[.)]\s+(.+)$/u)?.[1] ?? null;
}
