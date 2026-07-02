import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationPayload } from "../../notifications/types.js";

export function useToasts(durationMs: number) {
	const [toast, setToast] = useState<NotificationPayload | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const pushToast = useCallback(
		(payload: NotificationPayload) => {
			setToast(payload);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setToast(null), durationMs);
		},
		[durationMs],
	);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	return { toast, pushToast };
}
