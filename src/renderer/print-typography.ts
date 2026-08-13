import { PHYSICAL_CARD_PROFILE } from '../models/physical-card-profile';

export interface PrintTypeScale {
	targetPoints: number;
	minimumPoints: number;
}

export interface PrintTypographyProfile {
	title: PrintTypeScale;
	continuationTitle: PrintTypeScale;
	subtitle: PrintTypeScale;
	continuationSubtitle: PrintTypeScale;
	body: PrintTypeScale;
	stats: PrintTypeScale;
	statLabel: PrintTypeScale;
	source: PrintTypeScale;
	pageNumber: PrintTypeScale;
}

export const PRINT_TYPOGRAPHY: Readonly<PrintTypographyProfile> = Object.freeze({
	title: Object.freeze({ targetPoints: 15.5, minimumPoints: 14 }),
	continuationTitle: Object.freeze({ targetPoints: 12.5, minimumPoints: 11 }),
	subtitle: Object.freeze({ targetPoints: 8.25, minimumPoints: 8 }),
	continuationSubtitle: Object.freeze({ targetPoints: 7.5, minimumPoints: 7.5 }),
	body: Object.freeze({ targetPoints: 10, minimumPoints: 7 }),
	stats: Object.freeze({ targetPoints: 8.25, minimumPoints: 8 }),
	statLabel: Object.freeze({ targetPoints: 7.5, minimumPoints: 7.5 }),
	source: Object.freeze({ targetPoints: 7.5, minimumPoints: 7.5 }),
	pageNumber: Object.freeze({ targetPoints: 7.5, minimumPoints: 7.5 }),
});

export function printPointsToCardWidthCqw(points: number): number {
	const millimeters = points * 25.4 / 72;
	return millimeters / PHYSICAL_CARD_PROFILE.widthMm * 100;
}

export function formatPrintPointsAsCqw(points: number): string {
	return `${roundUpCqw(printPointsToCardWidthCqw(points))}cqw`;
}

function roundUpCqw(cqw: number): number {
	return Math.ceil(cqw * 1000) / 1000;
}
