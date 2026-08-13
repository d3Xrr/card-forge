export interface ItemCardData {
	filePath: string;
	name: string;
	detail?: string;
	imagePath?: string;
	rarity?: string;
	attunement?: boolean;
	source?: string;
	damage?: string;
	properties?: string[];
	mastery?: string;
	weight?: number;
	rawTags: string[];
}
