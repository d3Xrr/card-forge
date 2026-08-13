import {
	parseSemanticMarkdown,
} from './semantic-markdown';
import type { MarkdownBlock } from '../models/item-card-page';

export { parseDescriptionHeading } from './semantic-markdown';

export function renderSafeMarkdown(markdown: string, container: HTMLElement): void {
	renderSafeMarkdownBlocks(parseSemanticMarkdown(markdown), container);
}

export function renderSafeMarkdownBlocks(
	blocks: readonly MarkdownBlock[],
	container: HTMLElement,
): void {
	container.replaceChildren();
	for (const block of blocks) {
		switch (block.type) {
			case 'heading':
				renderHeading(block, container);
				break;
			case 'unordered-list':
			case 'ordered-list':
				renderList(block, container);
				break;
			case 'paragraph':
				renderParagraph(block.markdown, container);
				break;
		}
	}
}

function renderHeading(
	block: Extract<MarkdownBlock, { type: 'heading' }>,
	container: HTMLElement,
): void {
	const tagName = block.level === 2 ? 'h4' : 'h5';
	const element = appendElement(
		container,
		tagName,
		'ttrpg-card-forge-card__section-heading',
	);
	element.dataset.sourceLevel = String(block.level);
	renderInlineMarkdown(block.markdown, element);
}

function renderList(
	block: Extract<MarkdownBlock, { type: 'unordered-list' | 'ordered-list' }>,
	container: HTMLElement,
): void {
	const list = appendElement(
		container,
		block.type === 'ordered-list' ? 'ol' : 'ul',
		'ttrpg-card-forge-card__list',
	);
	for (const item of block.items) {
		const listItem = appendElement(list, 'li');
		renderInlineMarkdown(item, listItem);
	}
}

function renderParagraph(markdown: string, container: HTMLElement): void {
	const paragraph = appendElement(container, 'p', 'ttrpg-card-forge-card__paragraph');
	const lines = markdown.split('\n');
	for (const [index, line] of lines.entries()) {
		if (index > 0) {
			paragraph.createEl('br');
		}
		renderInlineMarkdown(line, paragraph);
	}
}

function renderInlineMarkdown(markdown: string, container: HTMLElement): void {
	const tokenPattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/u;
	let remaining = markdown;

	while (remaining.length > 0) {
		const match = tokenPattern.exec(remaining);
		if (!match || match.index === undefined || !match[0]) {
			container.append(document.createTextNode(remaining));
			break;
		}

		if (match.index > 0) {
			container.append(document.createTextNode(remaining.slice(0, match.index)));
		}

		const token = match[0];
		if (token.startsWith('`')) {
			appendElement(container, 'code', undefined, token.slice(1, -1));
		} else if (token.startsWith('**') || token.startsWith('__')) {
			appendElement(container, 'strong', undefined, token.slice(2, -2));
		} else {
			appendElement(container, 'em', undefined, token.slice(1, -1));
		}

		remaining = remaining.slice(match.index + token.length);
	}
}

function appendElement<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tagName: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const element = parent.createEl(tagName);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}
