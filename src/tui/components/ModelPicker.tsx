import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useMemo, useRef, useState } from "react";
import { type Config, writeConfig } from "../../config.js";
import type { SettingContext } from "../../settings/types.js";
import { colors } from "../theme.js";

interface ModelPickerProps {
	config: Config;
	ctx: SettingContext;
	onApply: (modelId: string) => void;
	onCancel: () => void;
}

type Phase = "provider" | "apikey" | "model";

export function ModelPicker({ config, ctx, onApply, onCancel }: ModelPickerProps) {
	const [phase, setPhase] = useState<Phase>("provider");
	const [query, setQuery] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [provider, setProvider] = useState<string | null>(null);

	const configRef = useRef(config);
	configRef.current = config;
	const onApplyRef = useRef(onApply);
	onApplyRef.current = onApply;
	const onCancelRef = useRef(onCancel);
	onCancelRef.current = onCancel;
	const searchRef = useRef<TextareaRenderable | null>(null);
	const apiKeyRef = useRef<TextareaRenderable | null>(null);

	const providers = useMemo(() => {
		const set = new Set<string>();
		for (const m of ctx.modelRegistry.getAll()) set.add(m.provider);
		return Array.from(set).sort();
	}, [ctx.modelRegistry]);

	const providerFiltered = useMemo(() => {
		const q = query.toLowerCase();
		return providers.filter((p) => p.toLowerCase().includes(q));
	}, [providers, query]);

	const models = useMemo(() => {
		if (!provider) return [];
		const q = query.toLowerCase();
		return ctx.modelRegistry
			.getAll()
			.filter(
				(m) =>
					m.provider === provider &&
					(m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)),
			);
	}, [ctx.modelRegistry, provider, query]);

	const hasKey = (p: string) => ctx.authStorage.hasAuth(p);

	const syncQuery = () => {
		setQuery(searchRef.current?.plainText ?? "");
		setSelectedIdx(0);
	};

	const submitApiKey = () => {
		if (!provider) return;
		const trimmed = (apiKeyRef.current?.plainText ?? "").trim();
		if (!trimmed) return;
		ctx.authStorage.setRuntimeApiKey(provider, trimmed);
		const prev = configRef.current.providers?.[provider] ?? {};
		const newConfig: Config = {
			...configRef.current,
			providers: { ...configRef.current.providers, [provider]: { ...prev, apiKey: trimmed } },
		};
		try {
			writeConfig(ctx.cwd, newConfig, "project");
		} catch {}
		setPhase("model");
		setQuery("");
		setSelectedIdx(0);
	};

	const handleSearchKey = (key: KeyEvent) => {
		if (phase === "provider") {
			if (key.name === "up") {
				setSelectedIdx((i) => Math.max(0, i - 1));
			} else if (key.name === "down") {
				setSelectedIdx((i) => Math.min(providerFiltered.length - 1, i + 1));
			} else if (key.name === "return") {
				const p = providerFiltered[selectedIdx];
				if (!p) return;
				setProvider(p);
				setQuery("");
				setSelectedIdx(0);
				setPhase(hasKey(p) ? "model" : "apikey");
			} else if (key.name === "escape") {
				onCancelRef.current();
			}
		} else if (phase === "model") {
			if (key.name === "up") {
				setSelectedIdx((i) => Math.max(0, i - 1));
			} else if (key.name === "down") {
				setSelectedIdx((i) => Math.min(models.length - 1, i + 1));
			} else if (key.name === "return") {
				const m = models[selectedIdx];
				if (m) onApplyRef.current(`${m.provider}:${m.id}`);
			} else if (key.name === "escape") {
				setPhase("provider");
				setQuery("");
				setSelectedIdx(0);
			}
		}
	};

	const handleApiKeyKey = (key: KeyEvent) => {
		if (key.name === "escape") {
			setPhase("provider");
			setQuery("");
			setSelectedIdx(0);
		}
	};

	const renderRow = (i: number) => {
		const isSel = i === selectedIdx;
		if (phase === "provider") {
			const p = providerFiltered[i];
			if (!p) return null;
			return (
				<text key={i} fg={isSel ? colors.secondary : colors.textMuted}>
					{isSel ? "▶ " : "  "}
					{p} {hasKey(p) ? "✓" : "✗"}
				</text>
			);
		}
		const m = models[i];
		if (!m) return null;
		const caps: string[] = [];
		if (m.reasoning) caps.push("reasoning");
		if (m.input?.includes("image")) caps.push("vision");
		return (
			<text key={i} fg={isSel ? colors.secondary : colors.textMuted}>
				{isSel ? "▶ " : "  "}
				{m.id}
				{caps.length ? `  (${caps.join(",")})` : ""}
			</text>
		);
	};

	const rowCount = phase === "provider" ? providerFiltered.length : models.length;
	const visible = Math.min(rowCount, 12);

	return (
		<box flexDirection="column" paddingLeft={1}>
			{phase === "apikey" ? (
				<box flexDirection="column">
					<text fg={colors.primary}>Configure {provider}</text>
					<text fg={colors.textMuted}>Paste API key — saved to .openagent/config.json</text>
					<box
						borderStyle="rounded"
						border={["top", "right", "bottom", "left"]}
						borderColor={colors.borderActive}
						backgroundColor={colors.background}
						flexDirection="row"
						paddingLeft={1}
						paddingRight={1}
					>
						<text fg={colors.secondary}>🔑 </text>
						<textarea
							ref={apiKeyRef}
							initialValue=""
							focused
							width={50}
							height={1}
							backgroundColor={colors.background}
							textColor={colors.text}
							cursorColor={colors.primary}
							placeholderColor={colors.textMuted}
							placeholder="sk-..."
							keyBindings={[
								{ name: "return", action: "submit" },
								{ name: "kpenter", action: "submit" },
							]}
							onSubmit={submitApiKey}
							onKeyDown={handleApiKeyKey}
						/>
					</box>
					<text fg={colors.textMuted}>Enter save · Esc back to provider list</text>
				</box>
			) : (
				<box flexDirection="column">
					<text fg={colors.textSubtle}>
						{phase === "provider" ? "PROVIDER" : `MODEL · ${provider}`}
					</text>
					<box flexDirection="row">
						<text fg={colors.textMuted}>🔍 </text>
						<textarea
							ref={searchRef}
							initialValue=""
							focused
							width={40}
							height={1}
							backgroundColor={colors.background}
							textColor={colors.text}
							cursorColor={colors.primary}
							placeholderColor={colors.textMuted}
							placeholder="type to search..."
							onContentChange={syncQuery}
							onKeyDown={handleSearchKey}
							keyBindings={[]}
						/>
					</box>
					{Array.from({ length: visible }, (_, i) => renderRow(i))}
					<text fg={colors.textMuted}>
						up/down navigate · Enter select · Esc {phase === "provider" ? "cancel" : "back"}
					</text>
				</box>
			)}
		</box>
	);
}
