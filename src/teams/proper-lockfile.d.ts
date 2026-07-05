declare module "proper-lockfile" {
	interface LockOptions {
		stale?: number;
		update?: number;
		retries?: number;
		retryWait?: number;
	}
	function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
	export default { lock };
}
