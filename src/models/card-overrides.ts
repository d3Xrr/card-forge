export const MANUAL_CARD_BREAK_DELIMITER = '///CARD BREAK///';

export interface CardStatOverrides {
	damage?: string | null;
	damageTwoHanded?: string | null;
	range?: string | null;
	properties?: string[] | null;
	mastery?: string | null;
	cost?: string | null;
	weight?: number | null;
}

export type CardArtworkOverride =
	| { kind: 'none' }
	| { kind: 'vault'; path: string };

export interface CardVariantOverride {
	id: string;
}

/**
 * Persisted print-only changes. Absence means "use the indexed source value";
 * null is used where an existing optional value must be explicitly cleared.
 */
export interface CardOverrides {
	title?: string;
	typeText?: string | null;
	rarityText?: string | null;
	attunementText?: string | null;
	rulesMarkdown?: string;
	stats?: CardStatOverrides;
	artwork?: CardArtworkOverride;
	sourceText?: string | null;
	variant?: CardVariantOverride;
}
