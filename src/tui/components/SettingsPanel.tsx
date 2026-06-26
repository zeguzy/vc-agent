import type { KeyBinding as TextareaKeyBinding, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import { type Config, writeConfig } from "../../config.js";
import { settings as allSettings } from "../../settings/registry.js";
import type { SettingContext } from "../../settings/types.js";
import { colors } from "../theme.js";
import { ModelPicker } from "./ModelPicker.js";

interface SettingsPanelProps {
	config: Config;
	ctx: SettingContext;
	onClose: () => void;
}

const LABEL_WIDTH = 18;
const MODEL_IDX = allSettings.findIndex((s) => s.key === "model");

const inputKeyBindings: TextareaKeyBinding[] = [
	{ name: "return", action: "submit" },
	{ name: "kpenter", action: "submit" },
];

export function SettingsPanel({ config: initialConfig, ctx, onClose }: SettingsPanelProps) {
	const [config, setConfig] = useState(initialConfig);
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [selectEdit, setSelectEdit] = useState<{
		settingIdx: number;
		optionIdx: number;
		options: readonly unknown[];
	} | null>(null);
	const [inputEdit, setInputEdit] = useState<number | null>(null);
	const [mode, setMode] = useState<"list" | "modelPicker">("list");
	const [error, setError] = useState<string | null>(null);

	const configRef = useRef(config);
	configRef.current = config;
	const ctxRef = useRef(ctx);
	ctxRef.current = ctx;
	const selectedIdxRef = useRef(selectedIdx);
	selectedIdxRef.current = selectedIdx;
	const selectEditRef = useRef(selectEdit);
	selectEditRef.current = selectEdit;
	const inputEditRef = useRef(inputEdit);
	inputEditRef.current = inputEdit;
	const modeRef = useRef(mode);
	modeRef.current = mode;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const inputTextareaRef = useRef<TextareaRenderable | null>(null);

	const change = (idx: number, value: unknown) => {
		const s = allSettings[idx];
		s.apply(value, ctx);
		const newConfig = s.persist(configRef.current, value);
		setConfig(newConfig);
		setSelectEdit(null);
		setInputEdit(null);
		setMode("list");
		try {
			writeConfig(ctx.cwd, newConfig, s.scope === "global" ? "global" : "project");
			setError(null);
		} catch (e) {
			setError(`not saved: ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	const submitInput = () => {
		const idx = inputEditRef.current;
		if (idx === null) return;
		const val = inputTextareaRef.current?.plainText ?? "";
		change(idx, val.trim());
	};

	useKeyboard((key) => {
		if (modeRef.current === "modelPicker") return;
		const inp = inputEditRef.current;
		if (inp !== null) {
			if (key.name === "escape") setInputEdit(null);
			return;
		}
		const edit = selectEditRef.current;
		if (edit) {
			const opts = edit.options;
			if (key.name === "j" || key.name === "down") {
				setSelectEdit({ ...edit, optionIdx: Math.min(opts.length - 1, edit.optionIdx + 1) });
			} else if (key.name === "k" || key.name === "up") {
				setSelectEdit({ ...edit, optionIdx: Math.max(0, edit.optionIdx - 1) });
			} else if (key.name === "return") {
				change(edit.settingIdx, opts[edit.optionIdx]);
			} else if (key.name === "escape") {
				setSelectEdit(null);
			}
			return;
		}
		if (key.name === "j" || key.name === "down") {
			setSelectedIdx((i) => Math.min(allSettings.length - 1, i + 1));
		} else if (key.name === "k" || key.name === "up") {
			setSelectedIdx((i) => Math.max(0, i - 1));
		} else if (key.name === "return") {
			const idx = selectedIdxRef.current;
			const s = allSettings[idx];
			if (s.editor.type === "toggle") {
				change(idx, !(s.read(configRef.current) as boolean));
			} else if (s.editor.type === "select") {
				const cur = s.read(configRef.current);
				const oi = s.editor.options.findIndex((o) => String(o) === String(cur));
				setSelectEdit({ settingIdx: idx, optionIdx: oi >= 0 ? oi : 0, options: s.editor.options });
			} else if (s.editor.type === "selectDynamic") {
				const opts = s.editor.options(ctxRef.current);
				const cur = s.read(configRef.current);
				const oi = opts.findIndex((o) => String(o) === String(cur));
				setSelectEdit({ settingIdx: idx, optionIdx: oi >= 0 ? oi : 0, options: opts });
			} else if (s.editor.type === "input") {
				setInputEdit(idx);
			} else if (s.editor.type === "modelPicker") {
				setMode("modelPicker");
			}
		} else if (key.name === "escape") {
			onCloseRef.current();
		}
	});

	return (
		<box flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
			<box
				borderStyle="rounded"
				border={["top", "right", "bottom", "left"]}
				borderColor={colors.borderActive}
				backgroundColor={colors.backgroundInset}
				flexDirection="column"
				paddingLeft={1}
				paddingRight={1}
			>
				<box flexDirection="row">
					<text fg={colors.primary}>Settings</text>
					{mode !== "modelPicker" && (
						<text fg={colors.textMuted}> j/k navigate · Enter edit · Esc close</text>
					)}
				</box>
				{mode === "modelPicker" ? (
					<ModelPicker
						config={config}
						ctx={ctx}
						onApply={(modelId) => change(MODEL_IDX, modelId)}
						onCancel={() => setMode("list")}
					/>
				) : (
					allSettings.map((s, i) => {
						const cur = s.read(config);
						const isSelected = i === selectedIdx;
						const inSelectEdit = selectEdit?.settingIdx === i;
						const inInputEdit = inputEdit === i;
						const prevCat = i > 0 ? allSettings[i - 1].category : null;
						const showHeader = s.category !== prevCat;
						const isSelectable = s.editor.type === "select" || s.editor.type === "selectDynamic";
						return (
							<box key={s.key} flexDirection="column">
								{showHeader && <text fg={colors.textSubtle}>{s.category.toUpperCase()}</text>}
								<box flexDirection="row">
									<text fg={isSelected ? colors.secondary : colors.textSubtle}>
										{isSelected ? "▶ " : "  "}
									</text>
									<text fg={colors.text}>{s.label.padEnd(LABEL_WIDTH)}</text>
									<text fg={colors.textMuted}>{s.renderValue(cur)}</text>
								</box>
								{inSelectEdit && isSelectable && selectEdit && (
									<box flexDirection="column" paddingLeft={2}>
										{selectEdit.options.map((opt, oi) => (
											<text
												key={oi}
												fg={oi === selectEdit.optionIdx ? colors.secondary : colors.textMuted}
											>
												{oi === selectEdit.optionIdx ? "▶ " : "  "}
												{String(opt)}
											</text>
										))}
									</box>
								)}
								{inInputEdit && s.editor.type === "input" && (
									<box flexDirection="row" paddingLeft={2}>
										<text fg={colors.secondary}>▶ </text>
										<textarea
											ref={inputTextareaRef}
											initialValue={String(cur)}
											focused
											width={40}
											height={1}
											backgroundColor={colors.background}
											textColor={colors.text}
											cursorColor={colors.primary}
											placeholderColor={colors.textMuted}
											placeholder={s.editor.placeholder}
											keyBindings={inputKeyBindings}
											onSubmit={submitInput}
										/>
									</box>
								)}
							</box>
						);
					})
				)}
				{error && <text fg={colors.warning}>{error}</text>}
			</box>
		</box>
	);
}
