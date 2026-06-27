type Subscriber<T> = (value: T) => void;

interface PollTask<T> {
	fetch: () => T;
	intervalMs: number;
	timer: ReturnType<typeof setInterval> | null;
	lastValue: T | undefined;
	subscribers: Set<Subscriber<T>>;
}

export class PollManager {
	private tasks = new Map<string, PollTask<unknown>>();
	private pendingSubscribers = new Map<string, Set<Subscriber<unknown>>>();

	register<T>(key: string, fetch: () => T, intervalMs: number): void {
		const pending = this.pendingSubscribers.get(key);
		this.unregister(key);

		const task: PollTask<T> = {
			fetch,
			intervalMs,
			timer: null,
			lastValue: undefined,
			subscribers: new Set(),
		};

		if (pending) {
			for (const fn of pending) {
				task.subscribers.add(fn as Subscriber<T>);
			}
			this.pendingSubscribers.delete(key);
		}

		const run = () => {
			try {
				const value = fetch();
				if (value !== task.lastValue) {
					task.lastValue = value;
					for (const fn of task.subscribers) {
						fn(value);
					}
				}
			} catch {
				// keep lastValue unchanged on error
			}
		};

		run();
		task.timer = setInterval(run, intervalMs);
		this.tasks.set(key, task as PollTask<unknown>);
	}

	unregister(key: string): void {
		const task = this.tasks.get(key);
		if (task) {
			if (task.timer !== null) clearInterval(task.timer);
			task.subscribers.clear();
			this.tasks.delete(key);
		}
		this.pendingSubscribers.delete(key);
	}

	subscribe<T>(key: string, fn: Subscriber<T>): () => void {
		const task = this.tasks.get(key);
		if (task) {
			task.subscribers.add(fn as Subscriber<unknown>);
			if (task.lastValue !== undefined) {
				fn(task.lastValue as T);
			}
			return () => {
				task.subscribers.delete(fn as Subscriber<unknown>);
			};
		}

		let pending = this.pendingSubscribers.get(key);
		if (!pending) {
			pending = new Set();
			this.pendingSubscribers.set(key, pending);
		}
		pending.add(fn as Subscriber<unknown>);
		return () => {
			pending?.delete(fn as Subscriber<unknown>);
		};
	}

	destroy(): void {
		for (const key of this.tasks.keys()) {
			this.unregister(key);
		}
		for (const key of this.pendingSubscribers.keys()) {
			this.pendingSubscribers.delete(key);
		}
	}
}
