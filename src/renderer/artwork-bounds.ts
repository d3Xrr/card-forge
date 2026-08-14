export interface PixelBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface VisibleArtworkBounds extends PixelBounds {
	sourceWidth: number;
	sourceHeight: number;
}

const MAX_ANALYSIS_DIMENSION = 512;
const MAX_DISPLAY_DIMENSION = 1600;
const ANALYSIS_PADDING_PIXELS = 1;
export const DEFAULT_ARTWORK_BOUNDS_CACHE_CAPACITY = 128;

export class ArtworkBoundsCache<T> {
	private readonly values = new Map<string, Promise<T>>();

	constructor(
		readonly capacity = DEFAULT_ARTWORK_BOUNDS_CACHE_CAPACITY,
	) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError('Artwork bounds cache capacity must be a positive integer.');
		}
	}

	getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
		const existing = this.values.get(key);
		if (existing) {
			this.values.delete(key);
			this.values.set(key, existing);
			return existing;
		}
		const value = factory();
		this.values.set(key, value);
		while (this.values.size > this.capacity) {
			const oldestKey = this.values.keys().next().value;
			if (oldestKey === undefined) {
				break;
			}
			this.values.delete(oldestKey);
		}
		return value;
	}

	get size(): number {
		return this.values.size;
	}
}

export class ArtworkBoundsService {
	private readonly cache = new ArtworkBoundsCache<VisibleArtworkBounds | undefined>();

	getBounds(
		image: HTMLImageElement,
		artworkPath: string,
		artworkRevisionFingerprint?: string,
	): Promise<VisibleArtworkBounds | undefined> {
		if (/\.gif(?:[?#]|$)/iu.test(artworkPath)) {
			return Promise.resolve(undefined);
		}
		return this.cache.getOrCreate(
			createArtworkBoundsCacheKey(
				artworkPath,
				artworkRevisionFingerprint,
			),
			async () => {
				try {
					return await this.analyzeImage(image);
				} catch {
					return undefined;
				}
			},
		);
	}

	applyVisibleBounds(
		image: HTMLImageElement,
		artwork: HTMLElement,
		bounds: VisibleArtworkBounds | undefined,
	): boolean {
		if (!bounds || isFullArtworkBounds(bounds)) {
			return false;
		}

		const scale = Math.min(
			1,
			MAX_DISPLAY_DIMENSION / Math.max(bounds.width, bounds.height),
		);
		const canvas = artwork.createEl('canvas', {
			cls: 'ttrpg-card-forge-card__normalized-artwork',
			attr: {
				role: 'img',
				'aria-label': image.alt,
			},
		});
		canvas.width = Math.max(1, Math.round(bounds.width * scale));
		canvas.height = Math.max(1, Math.round(bounds.height * scale));
		const context = canvas.getContext('2d');
		if (!context) {
			canvas.remove();
			return false;
		}

		try {
			context.drawImage(
				image,
				bounds.x,
				bounds.y,
				bounds.width,
				bounds.height,
				0,
				0,
				canvas.width,
				canvas.height,
			);
			image.hidden = true;
			return true;
		} catch {
			canvas.remove();
			return false;
		}
	}

	private async analyzeImage(
		image: HTMLImageElement,
	): Promise<VisibleArtworkBounds | undefined> {
		const sourceWidth = image.naturalWidth;
		const sourceHeight = image.naturalHeight;
		if (sourceWidth <= 0 || sourceHeight <= 0) {
			return undefined;
		}

		const scale = Math.min(
			1,
			MAX_ANALYSIS_DIMENSION / Math.max(sourceWidth, sourceHeight),
		);
		const analysisWidth = Math.max(1, Math.round(sourceWidth * scale));
		const analysisHeight = Math.max(1, Math.round(sourceHeight * scale));
		const canvas = image.ownerDocument.body.createEl('canvas', {
			cls: 'ttrpg-card-forge__artwork-analysis',
			attr: { 'aria-hidden': 'true' },
		});
		canvas.width = analysisWidth;
		canvas.height = analysisHeight;

		try {
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) {
				return undefined;
			}
			context.clearRect(0, 0, analysisWidth, analysisHeight);
			context.drawImage(image, 0, 0, analysisWidth, analysisHeight);
			const imageData = context.getImageData(0, 0, analysisWidth, analysisHeight);
			const analysisBounds = calculateVisibleAlphaBounds(
				imageData.data,
				analysisWidth,
				analysisHeight,
			);
			return analysisBounds
				? projectAnalysisBounds(
					analysisBounds,
					analysisWidth,
					analysisHeight,
					sourceWidth,
					sourceHeight,
				)
				: undefined;
		} catch {
			return undefined;
		} finally {
			canvas.remove();
		}
	}
}

export function createArtworkBoundsCacheKey(
	resourcePath: string,
	artworkRevisionFingerprint?: string,
): string {
	return JSON.stringify({
		resourcePath,
		artworkRevisionFingerprint: artworkRevisionFingerprint ?? null,
	});
}

export function calculateVisibleAlphaBounds(
	rgba: ArrayLike<number>,
	width: number,
	height: number,
	alphaThreshold = 1,
): PixelBounds | undefined {
	if (
		!Number.isInteger(width)
		|| !Number.isInteger(height)
		|| width <= 0
		|| height <= 0
		|| rgba.length < width * height * 4
	) {
		return undefined;
	}

	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const alpha = rgba[(y * width + x) * 4 + 3] ?? 0;
			if (alpha < alphaThreshold) {
				continue;
			}
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}

	return maxX < minX || maxY < minY
		? undefined
		: {
			x: minX,
			y: minY,
			width: maxX - minX + 1,
			height: maxY - minY + 1,
		};
}

export function projectAnalysisBounds(
	bounds: PixelBounds,
	analysisWidth: number,
	analysisHeight: number,
	sourceWidth: number,
	sourceHeight: number,
): VisibleArtworkBounds {
	const left = Math.max(
		0,
		Math.floor((bounds.x - ANALYSIS_PADDING_PIXELS) * sourceWidth / analysisWidth),
	);
	const top = Math.max(
		0,
		Math.floor((bounds.y - ANALYSIS_PADDING_PIXELS) * sourceHeight / analysisHeight),
	);
	const right = Math.min(
		sourceWidth,
		Math.ceil(
			(bounds.x + bounds.width + ANALYSIS_PADDING_PIXELS)
			* sourceWidth / analysisWidth,
		),
	);
	const bottom = Math.min(
		sourceHeight,
		Math.ceil(
			(bounds.y + bounds.height + ANALYSIS_PADDING_PIXELS)
			* sourceHeight / analysisHeight,
		),
	);
	return {
		x: left,
		y: top,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
		sourceWidth,
		sourceHeight,
	};
}

function isFullArtworkBounds(bounds: VisibleArtworkBounds): boolean {
	return bounds.x === 0
		&& bounds.y === 0
		&& bounds.width === bounds.sourceWidth
		&& bounds.height === bounds.sourceHeight;
}
