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

export function buildCompactItemStatLines(item: ItemCardData): string[] {
	const stats = getItemStats(item);
	const primary: string[] = [];
	const secondary: string[] = [];
	if (stats.damage) {
		primary.push(stats.damageTwoHanded
			? `1H ${stats.damage}`
			: stats.damage);
	}
	if (stats.damageTwoHanded) {
		primary.push(`2H ${stats.damageTwoHanded}`);
	}
	primary.push(...stats.properties);
	if (stats.mastery) {
		primary.push(`Mastery: ${stats.mastery}`);
	}
	if (stats.range) {
		secondary.push(`Range ${stats.range}`);
	}
	if (stats.weight !== undefined) {
		secondary.push(formatItemWeight(stats.weight));
	}
	if (stats.cost) {
		secondary.push(stats.cost);
	}
	return [primary.join(' · '), secondary.join(' · ')].filter((line) => line.length > 0);
}

export function estimateItemStatsLoad(
	item: ItemCardData,
	presentation: ItemStatsPresentation,
): number {
	if (presentation === 'compact') {
		return buildCompactItemStatLines(item).length * 1.35;
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
	if (presentation === 'compact') {
		renderCompactStats(container, item);
		return;
	}

	const stats = container.createDiv({ cls: 'ttrpg-card-forge-card__stats' });
	for (const row of buildItemStatRows(item)) {
		const stat = stats.createDiv({ cls: 'ttrpg-card-forge-card__stat' });
		stat.createDiv({ cls: 'ttrpg-card-forge-card__stat-label', text: row.label });
		const values = stat.createDiv({ cls: 'ttrpg-card-forge-card__stat-values' });
		for (const value of row.values) {
			values.createDiv({ text: value });
		}
	}
}

export function formatItemWeight(weight: number): string {
	return `${Number.isInteger(weight) ? weight.toFixed(0) : String(weight)} lb.`;
}

function renderCompactStats(container: HTMLElement, item: ItemCardData): void {
	const lines = buildCompactItemStatLines(item);
	if (lines.length === 0) {
		return;
	}
	const stats = container.createDiv({ cls: 'ttrpg-card-forge-card__metrics' });
	for (const line of lines) {
		stats.createDiv({ text: line });
	}
}
