import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { resolveModel } from "../agent/session.js";
import type { Config } from "../config.js";
import type { AgentConfig } from "./types.js";

type ResolvedModel = ReturnType<typeof resolveModel>;

export interface ResolveSubagentModelOptions {
	agent: AgentConfig;
	config?: Config;
	modelRegistry: ModelRegistry;
	parentModel?: ResolvedModel;
	extraFallback?: string;
}

export function resolveSubagentModel(opts: ResolveSubagentModelOptions): ResolvedModel {
	const { agent, config, modelRegistry, parentModel } = opts;
	const sub = config?.subagents;

	// ① per-agent override
	if (sub?.models?.[agent.name]) {
		const r = resolveModel(modelRegistry, sub.models[agent.name]);
		if (r) return r;
	}

	// ② tier mapping
	if (agent.tier && sub?.modelTiers?.[agent.tier]) {
		const r = resolveModel(modelRegistry, sub.modelTiers[agent.tier]);
		if (r) return r;
	}

	// ③ parentModel — already resolved, skip resolveModel entirely
	if (parentModel) return parentModel;

	// ④ agent.model — frontmatter string, risky (may match wrong provider)
	if (agent.model) {
		const r = resolveModel(modelRegistry, agent.model);
		if (r) return r;
	}

	// ⑤ extraFallback — caller-provided (e.g., worker's defaultWorkerModel)
	if (opts.extraFallback) {
		const r = resolveModel(modelRegistry, opts.extraFallback);
		if (r) return r;
	}

	// ⑥ config.subagents.fallback
	if (sub?.fallback) {
		const r = resolveModel(modelRegistry, sub.fallback);
		if (r) return r;
	}

	// ⑦ config.model — global default
	if (config?.model) {
		const r = resolveModel(modelRegistry, config.model);
		if (r) return r;
	}

	return undefined;
}

export function buildNoModelError(agent: AgentConfig): string {
	return `subagent "${agent.name}": no model resolved (tier=${agent.tier ?? "none"}, agent.model=${agent.model ?? "none"})`;
}
