import { randomBytes } from "node:crypto";

export type BackgroundTaskStatus = "pending" | "running" | "completed" | "error" | "cancelled";

export interface BackgroundTask {
	id: string;
	sessionId?: string;
	parentSessionId: string;
	description: string;
	prompt: string;
	agent: string;
	category?: string;
	status: BackgroundTaskStatus;
	queuedAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	result?: string;
	error?: string;
	cost?: number;
	turns?: number;
}

export type NewBackgroundTask = Omit<BackgroundTask, "id" | "status" | "queuedAt">;

function generateTaskId(): string {
	return `bg_${randomBytes(4).toString("hex")}`;
}

export class TaskRegistry {
	private readonly tasks = new Map<string, BackgroundTask>();

	register(task: NewBackgroundTask): BackgroundTask {
		const id = generateTaskId();
		const full: BackgroundTask = {
			...task,
			id,
			status: "running",
			queuedAt: new Date(),
		};
		this.tasks.set(id, full);
		return full;
	}

	get(id: string): BackgroundTask | undefined {
		return this.tasks.get(id);
	}

	complete(id: string, result: string, cost?: number, turns?: number): BackgroundTask | undefined {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		const updated: BackgroundTask = {
			...task,
			status: "completed",
			completedAt: new Date(),
			result,
			cost: cost ?? task.cost,
			turns: turns ?? task.turns,
		};
		this.tasks.set(id, updated);
		return updated;
	}

	fail(id: string, error: string): BackgroundTask | undefined {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		const updated: BackgroundTask = {
			...task,
			status: "error",
			completedAt: new Date(),
			error,
		};
		this.tasks.set(id, updated);
		return updated;
	}

	cancel(id: string): BackgroundTask | undefined {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		const updated: BackgroundTask = {
			...task,
			status: "cancelled",
			completedAt: new Date(),
		};
		this.tasks.set(id, updated);
		return updated;
	}

	list(): BackgroundTask[] {
		return [...this.tasks.values()];
	}

	listByParent(parentSessionId: string): BackgroundTask[] {
		return [...this.tasks.values()].filter((t) => t.parentSessionId === parentSessionId);
	}

	remove(id: string): void {
		this.tasks.delete(id);
	}

	dispose(): void {
		this.tasks.clear();
	}
}
