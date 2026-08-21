import type { PreviewMode } from './live-edit-ui';

export class SourceNoteScrollMemory {
	private readonly positions = new Map<string, number>();

	remember(filePath: string, scrollTop: number): void {
		this.positions.set(filePath, normalizeScrollTop(scrollTop));
	}

	restore(filePath: string, maximumScrollTop: number): number {
		return Math.min(
			this.positions.get(filePath) ?? 0,
			normalizeScrollTop(maximumScrollTop),
		);
	}

	has(filePath: string): boolean {
		return this.positions.has(filePath);
	}
}

export function isCurrentSourceNoteRender(
	filePath: string,
	generation: number,
	currentFilePath: string | null,
	currentGeneration: number,
	previewMode: PreviewMode,
): boolean {
	return filePath === currentFilePath
		&& generation === currentGeneration
		&& previewMode === 'source-note';
}

function normalizeScrollTop(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}
