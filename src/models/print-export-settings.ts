export const PRINT_MODES = [
	'single-sided',
	'manual-duplex',
	'automatic-duplex',
] as const;
export type PrintMode = typeof PRINT_MODES[number];

export const BACK_EXPORT_MODES = ['no-backs', 'use-card-backs'] as const;
export type BackExportMode = typeof BACK_EXPORT_MODES[number];

export const DUPLEX_ORIENTATIONS = ['long-edge', 'short-edge'] as const;
export type DuplexOrientation = typeof DUPLEX_ORIENTATIONS[number];

export interface PrintExportSettings {
	printMode: PrintMode;
	backMode: BackExportMode;
	duplexOrientation: DuplexOrientation;
	/** Back-side registration correction in millimetres; positive values move right. */
	backOffsetXmm: number;
	/** Back-side registration correction in millimetres; positive values move down. */
	backOffsetYmm: number;
}

export const MAX_BACK_CALIBRATION_MM = 10;

export const DEFAULT_PRINT_EXPORT_SETTINGS: Readonly<PrintExportSettings> = Object.freeze({
	printMode: 'single-sided',
	backMode: 'no-backs',
	duplexOrientation: 'long-edge',
	backOffsetXmm: 0,
	backOffsetYmm: 0,
});

export function normalizePrintExportSettings(
	value: unknown,
	fallback: Readonly<PrintExportSettings> = DEFAULT_PRINT_EXPORT_SETTINGS,
): PrintExportSettings {
	const input = isRecord(value) ? value : {};
	return {
		printMode: normalizeEnum(input.printMode, PRINT_MODES, fallback.printMode),
		backMode: normalizeEnum(input.backMode, BACK_EXPORT_MODES, fallback.backMode),
		duplexOrientation: normalizeEnum(
			input.duplexOrientation,
			DUPLEX_ORIENTATIONS,
			fallback.duplexOrientation,
		),
		backOffsetXmm: normalizeOffset(input.backOffsetXmm, fallback.backOffsetXmm),
		backOffsetYmm: normalizeOffset(input.backOffsetYmm, fallback.backOffsetYmm),
	};
}

export function arePrintExportSettingsEqual(
	left: unknown,
	right: unknown,
): boolean {
	return JSON.stringify(normalizePrintExportSettings(left))
		=== JSON.stringify(normalizePrintExportSettings(right));
}

function normalizeOffset(value: unknown, fallback: number): number {
	const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	return Math.round(Math.min(
		MAX_BACK_CALIBRATION_MM,
		Math.max(-MAX_BACK_CALIBRATION_MM, number),
	) * 100) / 100;
}

function normalizeEnum<T extends string>(
	value: unknown,
	values: readonly T[],
	fallback: T,
): T {
	return typeof value === 'string' && values.includes(value as T)
		? value as T
		: fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
