import type { NotificationPayload } from "./types.js";

type NotificationHandler = (payload: NotificationPayload) => void;

export class NotificationBus {
	private handlers = new Set<NotificationHandler>();

	emit(payload: NotificationPayload): void {
		for (const handler of this.handlers) {
			handler(payload);
		}
	}

	subscribe(handler: NotificationHandler): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}
}

let globalBus: NotificationBus | null = null;

export function getNotificationBus(): NotificationBus {
	if (!globalBus) globalBus = new NotificationBus();
	return globalBus;
}
