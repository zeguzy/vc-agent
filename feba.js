/**
 * feba.js — 斐波那契数列计算
 *
 * 斐波那契数列定义：
 *   F(0) = 0, F(1) = 1
 *   F(n) = F(n-1) + F(n-2)  (n >= 2)
 *
 * 用法:
 *   bun run feba.js [n]
 *
 * 参数 n 为要计算到第几项的索引（>= 0），默认 20。
 */

/**
 * 计算第 n 项的斐波那契数。
 * 使用迭代法，时间复杂度 O(n)，空间复杂度 O(1)。
 *
 * @param {number} n - 要计算的项索引（从 0 开始）
 * @returns {number} 第 n 项的斐波那契数值
 * @throws {Error} 当 n < 0 时抛出异常
 */
function fibonacci(n) {
	// 参数校验：n 必须为非负整数
	if (n < 0) throw new Error("n must be >= 0");

	// 基础情况：F(0) = 0, F(1) = 1
	if (n <= 1) return n;

	// 迭代计算：用两个变量 prev/curr 滚动前进
	let prev = 0; // F(i-2)
	let curr = 1; // F(i-1)
	for (let i = 2; i <= n; i++) {
		const next = prev + curr; // F(i) = F(i-2) + F(i-1)
		prev = curr;              // 向前滚动：F(i-2) ← F(i-1)
		curr = next;              // 向前滚动：F(i-1) ← F(i)
	}
	return curr;
}

/**
 * 生成从 F(0) 到 F(n) 的完整斐波那契数列。
 *
 * @param {number} n - 数列的最大索引
 * @returns {number[]} 包含 F(0) ~ F(n) 的数组
 */
function fibonacciSequence(n) {
	const result = [];
	for (let i = 0; i <= n; i++) {
		result.push(fibonacci(i));
	}
	return result;
}

// ===== 命令行入口 =====

// 解析命令行参数，默认 n = 20
const args = process.argv.slice(2);
const n = args.length > 0 ? parseInt(args[0], 10) : 20;

// 输入校验
if (isNaN(n) || n < 0) {
	console.error("Usage: bun run feba.js [n]  (n >= 0)");
	process.exit(1);
}

// 输出结果
console.log(`F(${n}) = ${fibonacci(n)}`);
console.log(`Sequence: ${fibonacciSequence(n).join(", ")}`);
