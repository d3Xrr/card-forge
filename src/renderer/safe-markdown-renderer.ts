export function renderSafeMarkdown(markdown: string, container: HTMLElement): void {
	container.replaceChildren();
	const lines = markdown.replaceAll('\r\n', '\n').split('\n');
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (line.trim().length === 0) {
			index += 1;
			continue;
		}

		const unorderedMatch = matchUnorderedListItem(line);
		if (unorderedMatch) {
			const list = appendElement(container, 'ul', 'ttrpg-card-forge-card__list');
			while (index < lines.length) {
				const itemText = matchUnorderedListItem(lines[index] ?? '');
				if (itemText === null) {
					break;
				}
				const listItem = appendElement(list, 'li');
				renderInlineMarkdown(itemText, listItem);
				index += 1;
			}
			continue;
		}

		const orderedMatch = matchOrderedListItem(line);
		if (orderedMatch) {
			const list = appendElement(container, 'ol', 'ttrpg-card-forge-card__list');
			while (index < lines.length) {
				const itemText = matchOrderedListItem(lines[index] ?? '');
				if (itemText === null) {
					break;
				}
				const listItem = appendElement(list, 'li');
				renderInlineMarkdown(itemText, listItem);
				index += 1;
			}
			continue;
		}

		const paragraph = appendElement(container, 'p', 'ttrpg-card-forge-card__paragraph');
		let paragraphLineCount = 0;
		while (index < lines.length) {
			const paragraphLine = lines[index] ?? '';
			if (
				paragraphLine.trim().length === 0
				|| matchUnorderedListItem(paragraphLine) !== null
				|| matchOrderedListItem(paragraphLine) !== null
			) {
				break;
			}

			if (paragraphLineCount > 0) {
				paragraph.createEl('br');
			}
			renderInlineMarkdown(paragraphLine.trim(), paragraph);
			paragraphLineCount += 1;
			index += 1;
		}
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

function matchUnorderedListItem(line: string): string | null {
	return line.match(/^\s*[-+*]\s+(.+)$/u)?.[1] ?? null;
}

function matchOrderedListItem(line: string): string | null {
	return line.match(/^\s*\d+[.)]\s+(.+)$/u)?.[1] ?? null;
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
