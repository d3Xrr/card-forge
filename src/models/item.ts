export const STRUCTURED_ITEM_FIELDS = [
	'typeText',
	'rarityText',
	'attunementText',
	'damage',
	'damageTwoHanded',
	'range',
	'properties',
	'mastery',
	'cost',
	'weight',
] as const;

export type StructuredItemField = (typeof STRUCTURED_ITEM_FIELDS)[number];

export type StructuredItemFieldOrigin = 'source' | 'base' | 'override';

export interface ItemCardData {
	filePath: string;
	name: string;
	description: string;
	detail?: string;
	imagePath?: string;
	sourceText?: string;
	/** Literal print-only footer text. When present, bypass source canonicalization. */
	sourceDisplayOverride?: string;
	hasImage: boolean;
	rarity?: string;
	attunement?: boolean;
	source?: string;
	damage?: string;
	damageTwoHanded?: string;
	range?: string;
	properties?: string[];
	mastery?: string;
	cost?: string;
	weight?: number;
	rawTags: string[];
	/** Print-only display fields populated by the non-destructive editor. */
	typeText?: string;
	rarityText?: string;
	attunementText?: string;
	/**
	 * Origin of structured values when they are not direct source fields.
	 * An absent entry means the value came directly from the indexed source.
	 */
	structuredFieldOrigins?: Partial<Record<StructuredItemField, StructuredItemFieldOrigin>>;
	/** Segments are separated by explicit manual card boundaries. */
	manualRuleSegments?: string[];
}

export function getStructuredItemFieldOrigin(
	item: ItemCardData,
	field: StructuredItemField,
): StructuredItemFieldOrigin {
	return item.structuredFieldOrigins?.[field] ?? 'source';
}

export function createStructuredItemFieldOriginsSnapshot(
	item: ItemCardData,
): Record<StructuredItemField, StructuredItemFieldOrigin> {
	return Object.fromEntries(STRUCTURED_ITEM_FIELDS.map(
		(field) => [field, getStructuredItemFieldOrigin(item, field)],
	)) as Record<StructuredItemField, StructuredItemFieldOrigin>;
}
