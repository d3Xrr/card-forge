export interface ItemCardData {
	filePath: string;
	name: string;
	description: string;
	detail?: string;
	imagePath?: string;
	sourceText?: string;
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
}
