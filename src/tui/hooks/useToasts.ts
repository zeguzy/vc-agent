import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationPayload } from "../../notifications/types.js";

const TOAST_DURATION_MS = 4000;

export function useToasts() {
	const [toast, setToast] = useState<NotificationPayload | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const pushToast = useCallback((payload: NotificationPayload) => {
		setToast(payload);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
	}, []);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	return { toast, pushToast };
}
