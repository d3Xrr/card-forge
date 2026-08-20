export interface DebounceScheduler {
	set(callback: () => void, delayMs: number): unknown;
	clear(handle: unknown): void;
}

const DEFAULT_SCHEDULER: DebounceScheduler = {
	set: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clear: (handle) => window.clearTimeout(handle as number),
};

/** Small testable debounce primitive; UI state is deliberately not part of its key. */
export class DebouncedAction {
	private handle: unknown;

	constructor(
		private readonly delayMs: number,
		private readonly scheduler: DebounceScheduler = DEFAULT_SCHEDULER,
	) {}

	schedule(action: () => void): void {
		this.cancel();
		this.handle = this.scheduler.set(() => {
			this.handle = undefined;
			action();
		}, this.delayMs);
	}

	cancel(): void {
		if (this.handle !== undefined) {
			this.scheduler.clear(this.handle);
			this.handle = undefined;
		}
	}
}
