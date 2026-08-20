export type SourceDisplayMode = 'card' | 'compact';

interface KnownSource {
	card: string;
	compact: string;
}

const KNOWN_SOURCE_IDENTIFIERS: Record<string, KnownSource> = {
	dmg: { card: 'DMG', compact: 'DMG' },
	monstersofdrakkenheim: { card: 'Monsters of Drakkenheim', compact: 'MoD' },
	phb: { card: 'PHB', compact: 'PHB' },
	tce: { card: 'TCE', compact: 'TCE' },
	xdmg: { card: "DMG '24", compact: "DMG '24" },
	xphb: { card: "PHB '24", compact: "PHB '24" },
};

export function formatSourceDisplay(
	source?: string,
	sourceText?: string,
	mode: SourceDisplayMode = 'card',
): string | undefined {
	const parsedSourceText = sourceText ? parseSourceText(sourceText) : undefined;
	const knownSource = findKnownSource(source, parsedSourceText?.title);
	const title = knownSource?.[mode]
		?? parsedSourceText?.title
		?? readableSourceIdentifier(source);

	if (!title) {
		return undefined;
	}

	return mode === 'card' && parsedSourceText?.page
		? `${title} · ${parsedSourceText.page}`
		: title;
}

/** Explicit print text is literal; absence falls back to canonical formatting. */
export function resolveSourceDisplay(
	source: string | undefined,
	sourceText: string | undefined,
	explicitOverride: string | undefined,
): string | undefined {
	return explicitOverride !== undefined
		? explicitOverride
		: formatSourceDisplay(source, sourceText);
}

function parseSourceText(sourceText: string): { title?: string; page?: string } {
	const normalized = sourceText.replace(/\s+/gu, ' ').trim();
	const pageMatch = /\b(pp?)\.\s*(\d+(?:\s*[-–—]\s*\d+)?)\b/iu.exec(normalized);
	const rawTitle = pageMatch?.index === undefined
		? normalized
		: normalized.slice(0, pageMatch.index);
	const title = rawTitle.replace(/[\s,;:.-]+$/gu, '').trim();
	const page = pageMatch?.[1] && pageMatch[2]
		? `${pageMatch[1].toLocaleLowerCase()}. ${pageMatch[2].replace(/\s+/gu, '')}`
		: undefined;

	return {
		...(title ? { title } : {}),
		...(page ? { page } : {}),
	};
}

function findKnownSource(source?: string, sourceTitle?: string): KnownSource | undefined {
	const normalizedIdentifier = source?.replace(/[^a-z0-9]/giu, '').toLocaleLowerCase();
	if (normalizedIdentifier && KNOWN_SOURCE_IDENTIFIERS[normalizedIdentifier]) {
		return KNOWN_SOURCE_IDENTIFIERS[normalizedIdentifier];
	}

	if (!sourceTitle) {
		return undefined;
	}

	const normalizedTitle = sourceTitle
		.replace(/[’]/gu, "'")
		.replace(/[^a-z0-9]/giu, '')
		.toLocaleLowerCase();
	if (normalizedTitle === 'monstersofdrakkenheim') {
		return KNOWN_SOURCE_IDENTIFIERS.monstersofdrakkenheim;
	}
	if (normalizedTitle === 'dungeonmastersguide2024') {
		return KNOWN_SOURCE_IDENTIFIERS.xdmg;
	}
	if (normalizedTitle === 'playershandbook2024') {
		return KNOWN_SOURCE_IDENTIFIERS.xphb;
	}
	return undefined;
}

function readableSourceIdentifier(source?: string): string | undefined {
	const trimmed = source?.trim();
	if (!trimmed) {
		return undefined;
	}

	const words = trimmed
		.replace(/([a-z])([A-Z])/gu, '$1 $2')
		.split(/[-_\s]+/u)
		.filter((word) => word.length > 0);
	if (words.length === 0) {
		return undefined;
	}

	return words.map((word) =>
		word.length <= 4 && word === word.toLocaleUpperCase()
			? word
			: `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1).toLocaleLowerCase()}`,
	).join(' ');
}
