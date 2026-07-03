import { useEffect, useState } from "react";

export function useTerminalWidth(): number {
	const [width, setWidth] = useState(() => process.stdout.columns ?? 80);
	useEffect(() => {
		const handler = () => setWidth(process.stdout.columns ?? 80);
		process.stdout.on("resize", handler);
		return () => {
			process.stdout.off("resize", handler);
		};
	}, []);
	return width;
}
