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
	properties?: string[];
	mastery?: string;
	weight?: number;
	rawTags: string[];
}
