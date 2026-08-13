export interface ParsedItemDescription {
	description: string;
	sourceText?: string;
}

const SUMMARY_LABELS = new Set([
	'ac',
	'armor class',
	'cost',
	'damage',
	'damage 2h',
	'damage 2-handed',
	'damage two-handed',
	'mastery',
	'one-handed',
	'properties',
	'range',
	'strength',
	'type',
	'two-handed',
	'value',
	'weight',
]);

export function parseItemDescription(
	markdown: string,
	itemDetail?: string,
): ParsedItemDescription {
	let lines = stripFrontmatter(markdown).replaceAll('\r\n', '\n').split('\n');
	lines = trimEmptyLines(lines);

	if (lines[0]?.match(/^#\s+/u)) {
		lines.shift();
		lines = trimLeadingEmptyLines(lines);
	}

	if (itemDetail && lines[0] && isMatchingDetailLine(lines[0], itemDetail)) {
		lines.shift();
	}

	lines = stripCliSummaryPreamble(lines);
	const sourceResult = stripSourceFooter(lines);
	lines = sourceResult.lines;

	const description = collapseEmptyLines(lines)
		.map((line) => stripMarkdownLinks(line).trimEnd())
		.join('\n')
		.trim();

	return {
		description,
		...(sourceResult.sourceText ? { sourceText: sourceResult.sourceText } : {}),
	};
}

export function stripMarkdownLinks(markdown: string): string {
	let result = '';
	let index = 0;

	while (index < markdown.length) {
		const isImage = markdown[index] === '!' && markdown[index + 1] === '[';
		const linkStart = isImage ? index + 1 : index;

		if (markdown[linkStart] === '[' && markdown[linkStart + 1] === '[') {
			const wikiEnd = markdown.indexOf(']]', linkStart + 2);
			if (wikiEnd !== -1) {
				const target = markdown.slice(linkStart + 2, wikiEnd);
				result += isImage ? '' : wikiLinkLabel(target);
				index = wikiEnd + 2;
				continue;
			}
		}

		if (markdown[linkStart] === '[') {
			const labelEnd = findUnescaped(markdown, ']', linkStart + 1);
			if (labelEnd !== -1 && markdown[labelEnd + 1] === '(') {
				const destinationEnd = findClosingParenthesis(markdown, labelEnd + 1);
				if (destinationEnd !== -1) {
					result += isImage ? '' : markdown.slice(linkStart + 1, labelEnd);
					index = destinationEnd + 1;
					continue;
				}
			}
		}

		result += markdown[index];
		index += 1;
	}

	return result;
}

function stripFrontmatter(markdown: string): string {
	const normalized = markdown.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n');
	const lines = normalized.split('\n');
	if (lines[0]?.trim() !== '---') {
		return normalized;
	}

	const closingIndex = lines.findIndex((line, index) =>
		index > 0 && (line.trim() === '---' || line.trim() === '...'),
	);
	return closingIndex === -1 ? normalized : lines.slice(closingIndex + 1).join('\n');
}

function isMatchingDetailLine(line: string, itemDetail: string): boolean {
	const trimmed = line.trim();
	const isEmphasized = (trimmed.startsWith('*') && trimmed.endsWith('*'))
		|| (trimmed.startsWith('_') && trimmed.endsWith('_'));
	if (!isEmphasized) {
		return false;
	}

	return comparisonText(trimmed) === comparisonText(itemDetail);
}

function comparisonText(value: string): string {
	return stripMarkdownLinks(value)
		.replaceAll('*', '')
		.replaceAll('_', '')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLocaleLowerCase();
}

function stripCliSummaryPreamble(lines: string[]): string[] {
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (line.trim().length === 0 || isStandaloneImage(line) || isSummaryMetadataLine(line)) {
			index += 1;
			continue;
		}
		break;
	}

	return trimLeadingEmptyLines(lines.slice(index));
}

function isStandaloneImage(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith('![')
		&& stripMarkdownLinks(trimmed).trim().length === 0;
}

function isSummaryMetadataLine(line: string): boolean {
	const bulletMatch = line.match(/^\s*[-+*]\s+(.+)$/u);
	if (!bulletMatch?.[1]) {
		return false;
	}

	const text = bulletMatch[1]
		.replace(/^\*\*([^*]+)\*\*/u, '$1')
		.replace(/^__([^_]+)__/u, '$1');
	const separatorIndex = text.indexOf(':');
	if (separatorIndex === -1) {
		return false;
	}

	const label = text.slice(0, separatorIndex)
		.replace(/[()]/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLocaleLowerCase();
	return SUMMARY_LABELS.has(label);
}

function stripSourceFooter(lines: string[]): {
	lines: string[];
	sourceText?: string;
} {
	const trimmedLines = trimEmptyLines(lines);
	const lastLine = trimmedLines.at(-1);
	if (!lastLine) {
		return { lines: trimmedLines };
	}

	const plainLine = unwrapOuterEmphasis(lastLine);
	const sourceMatch = plainLine.match(/^Source:\s*(.+)$/iu);
	if (!sourceMatch?.[1]) {
		return { lines: trimmedLines };
	}

	const sourceText = stripMarkdownLinks(sourceMatch[1])
		.replace(/[*_`]/gu, '')
		.trim();
	return {
		lines: trimEmptyLines(trimmedLines.slice(0, -1)),
		...(sourceText ? { sourceText } : {}),
	};
}

function unwrapOuterEmphasis(value: string): string {
	let unwrapped = value.trim();
	for (const marker of ['**', '__', '*', '_']) {
		if (unwrapped.startsWith(marker) && unwrapped.endsWith(marker)) {
			unwrapped = unwrapped.slice(marker.length, -marker.length).trim();
			break;
		}
	}
	return unwrapped;
}

function trimEmptyLines(lines: string[]): string[] {
	return trimTrailingEmptyLines(trimLeadingEmptyLines(lines));
}

function trimLeadingEmptyLines(lines: string[]): string[] {
	const firstContent = lines.findIndex((line) => line.trim().length > 0);
	return firstContent === -1 ? [] : lines.slice(firstContent);
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let endIndex = lines.length;
	while (endIndex > 0 && lines[endIndex - 1]?.trim().length === 0) {
		endIndex -= 1;
	}
	return lines.slice(0, endIndex);
}

function collapseEmptyLines(lines: string[]): string[] {
	const collapsed: string[] = [];
	for (const line of trimEmptyLines(lines)) {
		if (line.trim().length === 0 && collapsed.at(-1)?.trim().length === 0) {
			continue;
		}
		collapsed.push(line);
	}
	return collapsed;
}

function findUnescaped(value: string, character: string, start: number): number {
	for (let index = start; index < value.length; index += 1) {
		if (value[index] === character && value[index - 1] !== '\\') {
			return index;
		}
	}
	return -1;
}

function findClosingParenthesis(value: string, openingIndex: number): number {
	let depth = 0;
	for (let index = openingIndex; index < value.length; index += 1) {
		if (value[index] === '(' && value[index - 1] !== '\\') {
			depth += 1;
		} else if (value[index] === ')' && value[index - 1] !== '\\') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function wikiLinkLabel(target: string): string {
	const alias = target.split('|').at(-1)?.trim() ?? target;
	const withoutHeading = alias.split('#')[0] ?? alias;
	const fileName = withoutHeading.replaceAll('\\', '/').split('/').at(-1) ?? withoutHeading;
	return fileName.replace(/\.md$/iu, '');
}
