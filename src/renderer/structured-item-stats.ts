import type { ItemCardData } from '../models/item';
import type { ItemStatsPresentation } from '../models/item-card-page';

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

const COMPACT_ATOMIC_VALUE_MAX_LENGTH = 26;

export function getItemStats(item: ItemCardData): ItemStats {
	return {
		...(item.damage ? { damage: item.damage } : {}),
		...(item.damageTwoHanded ? { damageTwoHanded: item.damageTwoHanded } : {}),
		...(item.range ? { range: item.range } : {}),
		properties: [...(item.properties ?? [])],
		...(item.mastery ? { mastery: item.mastery } : {}),
		...(item.cost ? { cost: item.cost } : {}),
		...(item.weight !== undefined ? { weight: item.weight } : {}),
	};
}

export function hasMeaningfulItemStats(item: ItemCardData): boolean {
	const stats = getItemStats(item);
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

export function buildItemStatRows(item: ItemCardData): ItemStatRow[] {
	const stats = getItemStats(item);
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
): number {
	if (presentation === 'compact') {
		const rows = buildItemStatRows(item);
		const rowUnits = rows.reduce((total, row) =>
			total + (row.label === 'Properties' || row.values.length > 1 ? 1 : 0.5), 0);
		return rowUnits * 1.15;
	}
	return buildItemStatRows(item).reduce(
		(total, row) => total + 1.15 + Math.max(0, row.values.length - 1) * 0.8,
		0,
	);
}

export function renderItemStats(
	container: HTMLElement,
	item: ItemCardData,
	presentation: ItemStatsPresentation,
): void {
	const stats = container.createDiv({
		cls: `ttrpg-card-forge-card__stats ttrpg-card-forge-card__stats--${presentation}`,
	});
	for (const row of buildItemStatRows(item)) {
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
