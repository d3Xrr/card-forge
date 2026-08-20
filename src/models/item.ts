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
	/** Segments are separated by explicit manual card boundaries. */
	manualRuleSegments?: string[];
}
