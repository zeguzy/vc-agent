/** Format an unknown error value into a human-readable string. */
export function formatError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
