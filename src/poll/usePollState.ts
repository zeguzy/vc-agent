import { useEffect, useState } from "react";
import type { PollManager } from "./manager.js";

export function usePollState<T>(key: string, manager: PollManager): T | undefined {
	const [value, setValue] = useState<T | undefined>(undefined);

	useEffect(() => {
		const unsubscribe = manager.subscribe<T>(key, setValue);
		return unsubscribe;
	}, [key, manager]);

	return value;
}
