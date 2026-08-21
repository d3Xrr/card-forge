export const PLANNING_PERFORMANCE_STORAGE_KEY = 'ttrpg-card-forge:performance';
export const PLANNING_PERFORMANCE_GLOBAL = '__ttrpgCardForgePerformance';

export type PlanningPerformanceStage =
	| 'itemDataResolution'
	| 'semanticParsing'
	| 'artworkResolution'
	| 'artworkBoundsAnalysis'
	| 'initialPlanning'
	| 'candidateGeneration'
	| 'domFitMeasurement'
	| 'paginationCompaction'
	| 'finalCanonicalValidation'
	| 'previewRendering'
	| 'viewInitialization'
	| 'viewReveal';

export type PlanningCacheStatus = 'miss' | 'pending' | 'hit';

export interface PlanningPerformanceRecord {
	itemName: string;
	operation: 'physical-plan' | 'preview-render' | 'view-activation';
	cacheStatus?: PlanningCacheStatus;
	totalMs: number;
	pageCount?: number;
	planSignature?: string;
	stages: Partial<Record<PlanningPerformanceStage, number>>;
	counters: Record<string, number>;
	timestamp: number;
}

export interface PlanningPerformanceSummary {
	itemName: string;
	operation: PlanningPerformanceRecord['operation'];
	cacheStatus?: PlanningCacheStatus;
	samples: number;
	averageMs: number;
	minimumMs: number;
	maximumMs: number;
}

export interface PlanningPerformanceDebugApi {
	enable: () => void;
	disable: () => void;
	clear: () => void;
	records: () => PlanningPerformanceRecord[];
	summary: () => PlanningPerformanceSummary[];
}

const MAX_PERFORMANCE_RECORDS = 128;

export class PlanningPerformanceMonitor {
	private readonly performanceRecords: PlanningPerformanceRecord[] = [];

	start(
		itemName: string,
		operation: PlanningPerformanceRecord['operation'],
	): PlanningPerformanceTrace | undefined {
		return this.isEnabled()
			? new PlanningPerformanceTrace(this, itemName, operation)
			: undefined;
	}

	installDebugApi(target: Window): () => void {
		const api: PlanningPerformanceDebugApi = {
			enable: () => target.localStorage.setItem(PLANNING_PERFORMANCE_STORAGE_KEY, '1'),
			disable: () => target.localStorage.removeItem(PLANNING_PERFORMANCE_STORAGE_KEY),
			clear: () => this.clear(),
			records: () => this.getRecords(),
			summary: () => this.summarize(),
		};
		const debugTarget = target as unknown as Record<string, unknown>;
		debugTarget[PLANNING_PERFORMANCE_GLOBAL] = api;
		return () => {
			if (debugTarget[PLANNING_PERFORMANCE_GLOBAL] === api) {
				delete debugTarget[PLANNING_PERFORMANCE_GLOBAL];
			}
		};
	}

	getRecords(): PlanningPerformanceRecord[] {
		return this.performanceRecords.map((record) => ({
			...record,
			stages: { ...record.stages },
			counters: { ...record.counters },
		}));
	}

	summarize(): PlanningPerformanceSummary[] {
		const groups = new Map<string, PlanningPerformanceRecord[]>();
		for (const record of this.performanceRecords) {
			const key = JSON.stringify([
				record.itemName,
				record.operation,
				record.cacheStatus,
			]);
			const group = groups.get(key) ?? [];
			group.push(record);
			groups.set(key, group);
		}

		return [...groups.values()].map((records) => {
			const first = records[0];
			if (!first) {
				throw new Error('Performance summary group cannot be empty.');
			}
			const durations = records.map((record) => record.totalMs);
			return {
				itemName: first.itemName,
				operation: first.operation,
				...(first.cacheStatus ? { cacheStatus: first.cacheStatus } : {}),
				samples: records.length,
				averageMs: roundMilliseconds(
					durations.reduce((total, duration) => total + duration, 0)
					/ durations.length,
				),
				minimumMs: roundMilliseconds(Math.min(...durations)),
				maximumMs: roundMilliseconds(Math.max(...durations)),
			};
		});
	}

	clear(): void {
		this.performanceRecords.splice(0);
	}

	record(record: PlanningPerformanceRecord): void {
		this.performanceRecords.push(record);
		while (this.performanceRecords.length > MAX_PERFORMANCE_RECORDS) {
			this.performanceRecords.shift();
		}
		console.debug('TTRPG Card Forge performance', record);
	}

	private isEnabled(): boolean {
		try {
			return typeof window !== 'undefined'
				&& window.localStorage.getItem(PLANNING_PERFORMANCE_STORAGE_KEY) === '1';
		} catch {
			return false;
		}
	}
}

export class PlanningPerformanceTrace {
	private readonly startedAt = performanceNow();
	private readonly stages: Partial<Record<PlanningPerformanceStage, number>> = {};
	private readonly counters: Record<string, number> = {};
	private finished = false;

	constructor(
		private readonly monitor: PlanningPerformanceMonitor,
		private readonly itemName: string,
		private readonly operation: PlanningPerformanceRecord['operation'],
	) {}

	measure<T>(stage: PlanningPerformanceStage, operation: () => T): T {
		const startedAt = performanceNow();
		try {
			return operation();
		} finally {
			this.addDuration(stage, performanceNow() - startedAt);
		}
	}

	async measureAsync<T>(
		stage: PlanningPerformanceStage,
		operation: () => Promise<T>,
	): Promise<T> {
		const startedAt = performanceNow();
		try {
			return await operation();
		} finally {
			this.addDuration(stage, performanceNow() - startedAt);
		}
	}

	addDuration(stage: PlanningPerformanceStage, durationMs: number): void {
		this.stages[stage] = (this.stages[stage] ?? 0) + durationMs;
	}

	increment(counter: string, amount = 1): void {
		this.counters[counter] = (this.counters[counter] ?? 0) + amount;
	}

	finish(options: {
		cacheStatus?: PlanningCacheStatus;
		pageCount?: number;
		planSignature?: string;
	} = {}): void {
		if (this.finished) {
			return;
		}
		this.finished = true;
		this.monitor.record({
			itemName: this.itemName,
			operation: this.operation,
			...options,
			totalMs: roundMilliseconds(performanceNow() - this.startedAt),
			stages: Object.fromEntries(Object.entries(this.stages).map(
				([stage, duration]) => [stage, roundMilliseconds(duration)],
			)),
			counters: { ...this.counters },
			timestamp: Date.now(),
		});
	}
}

function performanceNow(): number {
	return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function roundMilliseconds(milliseconds: number): number {
	return Math.round(milliseconds * 100) / 100;
}
