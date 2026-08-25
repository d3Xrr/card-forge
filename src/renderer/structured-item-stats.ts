import {
	getStructuredItemFieldOrigin,
	type ItemCardData,
} from '../models/item';
import {
	isCardDesignFieldVisible,
	LEGACY_CARD_DESIGN_PROFILE,
	type CardDesignProfile,
} from '../models/card-design';
import type {
	ItemCardLayout,
	ItemStatsPresentation,
} from '../models/item-card-page';

export interface ItemStats {
	damage?: string;
	damageTwoHanded?: string;
	range?: string;
	properties: string[];
	mastery?: string;
	cost?: string;
	weight?: number;
}

export interface ItemStatRow {
	label: string;
	values: string[];
}

export type CompactStatsLayout = 'grid' | 'stacked';

const COMPACT_ATOMIC_VALUE_MAX_LENGTH = 26;

export function getItemStats(
	item: ItemCardData,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): ItemStats {
	return {
		...(item.damage && isCardDesignFieldVisible(item, 'damage', design)
			? { damage: item.damage }
			: {}),
		...(item.damageTwoHanded && isCardDesignFieldVisible(item, 'damageTwoHanded', design)
			? { damageTwoHanded: item.damageTwoHanded }
			: {}),
		...(item.range && isCardDesignFieldVisible(item, 'range', design)
			? { range: item.range }
			: {}),
		properties: isCardDesignFieldVisible(item, 'properties', design)
			? [...(item.properties ?? [])]
			: [],
		...(item.mastery && isCardDesignFieldVisible(item, 'mastery', design)
			? { mastery: item.mastery }
			: {}),
		...(item.cost && isCardDesignFieldVisible(item, 'cost', design)
			? { cost: item.cost }
			: {}),
		...(item.weight !== undefined && isCardDesignFieldVisible(item, 'weight', design)
			? { weight: item.weight }
			: {}),
	};
}

export function shouldRenderStructuredItemField(
	item: ItemCardData,
	field: 'cost',
): boolean {
	return getStructuredItemFieldOrigin(item, field) !== 'base';
}

export function hasMeaningfulItemStats(
	item: ItemCardData,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): boolean {
	const stats = getItemStats(item, design);
	return Boolean(
		stats.damage
		|| stats.damageTwoHanded
		|| stats.range
		|| stats.properties.length > 0
		|| stats.mastery
		|| stats.cost
		|| stats.weight !== undefined,
	);
}

export function buildItemStatRows(
	item: ItemCardData,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): ItemStatRow[] {
	const stats = getItemStats(item, design);
	const rows: ItemStatRow[] = [];
	if (stats.damage || stats.damageTwoHanded) {
		const values: string[] = [];
		if (stats.damageTwoHanded) {
			if (stats.damage) {
				values.push(`One-handed: ${stats.damage}`);
			}
			values.push(`Two-handed: ${stats.damageTwoHanded}`);
		} else if (stats.damage) {
			values.push(stats.damage);
		}
		rows.push({ label: 'Damage', values });
	}
	if (stats.properties.length > 0) {
		rows.push({ label: 'Properties', values: [stats.properties.join(' · ')] });
	}
	if (stats.mastery) {
		rows.push({ label: 'Mastery', values: [stats.mastery] });
	}
	if (stats.range) {
		rows.push({ label: 'Range', values: [stats.range] });
	}
	if (stats.weight !== undefined) {
		rows.push({ label: 'Weight', values: [formatItemWeight(stats.weight)] });
	}
	if (stats.cost) {
		rows.push({ label: 'Cost', values: [stats.cost] });
	}
	return rows;
}

export function estimateItemStatsLoad(
	item: ItemCardData,
	presentation: ItemStatsPresentation,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): number {
	if (presentation === 'compact') {
		const rows = buildItemStatRows(item, design);
		const rowUnits = rows.reduce((total, row) =>
			total + (row.label === 'Properties' || row.values.length > 1 ? 1 : 0.5), 0);
		return rowUnits * 1.15;
	}
	return buildItemStatRows(item, design).reduce(
		(total, row) => total + 1.15 + Math.max(0, row.values.length - 1) * 0.8,
		0,
	);
}

export function renderItemStats(
	container: HTMLElement,
	item: ItemCardData,
	presentation: ItemStatsPresentation,
	cardLayout: ItemCardLayout,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): void {
	const compactLayout = selectCompactStatsLayout(presentation, cardLayout);
	const stats = container.createDiv({
		cls: [
			'ttrpg-card-forge-card__stats',
			`ttrpg-card-forge-card__stats--${presentation}`,
			...(compactLayout ? [`ttrpg-card-forge-card__stats--${compactLayout}`] : []),
		].join(' '),
	});
	for (const row of buildItemStatRows(item, design)) {
		const stat = stats.createDiv({ cls: 'ttrpg-card-forge-card__stat' });
		stat.dataset.stat = row.label.toLocaleLowerCase();
		stat.toggleClass('is-multiline', row.values.length > 1);
		stat.createDiv({ cls: 'ttrpg-card-forge-card__stat-label', text: row.label });
		const values = stat.createDiv({ cls: 'ttrpg-card-forge-card__stat-values' });
		for (const value of row.values) {
			const valueElement = values.createDiv({
				cls: 'ttrpg-card-forge-card__stat-value',
				text: value,
			});
			valueElement.toggleClass(
				'is-atomic',
				presentation === 'compact' && isCompactAtomicStatValue(row.label, value),
			);
		}
	}
}

export function selectCompactStatsLayout(
	presentation: ItemStatsPresentation,
	cardLayout: ItemCardLayout,
): CompactStatsLayout | undefined {
	if (presentation !== 'compact') {
		return undefined;
	}
	return cardLayout === 'portrait' ? 'stacked' : 'grid';
}

export function isCompactAtomicStatValue(label: string, value: string): boolean {
	const normalized = value.trim();
	if (normalized.length === 0 || normalized.length > COMPACT_ATOMIC_VALUE_MAX_LENGTH) {
		return false;
	}
	if (label === 'Damage') {
		return /^\d+d\d+(?:\s*[+-]\s*\d+)?\s+[\p{L}-]+$/iu.test(normalized);
	}
	return label === 'Properties'
		|| label === 'Mastery'
		|| label === 'Range'
		|| label === 'Weight'
		|| label === 'Cost';
}

export function formatItemWeight(weight: number): string {
	return `${Number.isInteger(weight) ? weight.toFixed(0) : String(weight)} lb.`;
}
