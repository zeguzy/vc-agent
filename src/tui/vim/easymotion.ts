import type { Position, ScreenCell } from "./types.js";

const KEYSET = "fjrudkeislwoaqghtyp";

export function findTargets(model: ScreenCell[][], char: string): Position[] {
	const targets: Position[] = [];
	for (let row = 0; row < model.length; row++) {
		const line = model[row];
		for (let col = 0; col < line.length; col++) {
			if (line[col].char === char) {
				targets.push({ row, col });
			}
		}
	}
	return targets;
}

export function assignLabels(targets: Position[], cursor: Position): Map<string, Position> {
	const labels = new Map<string, Position>();
	if (targets.length === 0) return labels;

	const K = KEYSET.length;

	const sorted = [...targets].sort((a, b) => {
		const distA = Math.abs(a.row - cursor.row) + Math.abs(a.col - cursor.col);
		const distB = Math.abs(b.row - cursor.row) + Math.abs(b.col - cursor.col);
		return distA - distB;
	});

	const singleCount = Math.min(sorted.length, K);
	for (let i = 0; i < singleCount; i++) {
		labels.set(KEYSET[i], sorted[i]);
	}

	if (sorted.length <= K) return labels;

	const remaining = sorted.slice(K);
	const maxLevel1 = K * (K - 1);
	const level1Count = Math.min(remaining.length, maxLevel1);

	for (let i = 0; i < level1Count; i++) {
		const parentIdx = Math.floor(i / (K - 1));
		const childSlot = i % (K - 1);
		const childKeyIdx = childSlot >= parentIdx ? childSlot + 1 : childSlot;
		labels.set(KEYSET[parentIdx] + KEYSET[childKeyIdx], remaining[i]);
	}

	if (remaining.length > maxLevel1) {
		const level2Remaining = remaining.slice(maxLevel1);
		for (let i = 0; i < level2Remaining.length; i++) {
			const groupSize = (K - 1) * (K - 1);
			const parentIdx = Math.floor(i / groupSize);
			const rest = i % groupSize;
			const childSlot = Math.floor(rest / (K - 1));
			const grandchildSlot = rest % (K - 1);
			const childKeyIdx = childSlot >= parentIdx ? childSlot + 1 : childSlot;
			const grandKeyIdx = grandchildSlot >= parentIdx ? grandchildSlot + 1 : grandchildSlot;
			labels.set(KEYSET[parentIdx] + KEYSET[childKeyIdx] + KEYSET[grandKeyIdx], level2Remaining[i]);
		}
	}

	return labels;
}

export function resolveLabel(
	typed: string,
	labels: Map<string, Position>,
): { done: boolean; pos: Position | null } {
	if (labels.has(typed)) {
		return { done: true, pos: labels.get(typed) ?? null };
	}

	let matchCount = 0;
	let matchPos: Position | null = null;

	for (const [label, pos] of labels) {
		if (label.startsWith(typed)) {
			matchCount++;
			matchPos = pos;
		}
	}

	if (matchCount === 1) {
		return { done: true, pos: matchPos };
	}

	if (matchCount > 1) {
		return { done: false, pos: null };
	}

	return { done: true, pos: null };
}
