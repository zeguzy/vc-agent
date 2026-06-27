import { colors } from "../theme.js";

interface WelcomeBannerProps {
	cwd: string;
	model?: string;
}

function KeyHint({ k, desc }: { k: string; desc: string }) {
	return (
		<box flexDirection="row">
			<text fg={colors.secondary}>{k}</text>
			<text fg={colors.textMuted}>{desc}</text>
		</box>
	);
}

export function WelcomeBanner({ cwd, model }: WelcomeBannerProps) {
	return (
		<box flexDirection="column" paddingTop={2} paddingLeft={2} flexShrink={0}>
			<text fg={colors.primary}>openagent</text>
			<text fg={colors.textSubtle}>your terminal coding assistant</text>

			<box flexDirection="column" paddingTop={2}>
				<box flexDirection="row">
					<text fg={colors.textSubtle}>model </text>
					<text fg={colors.text}>{model ?? "default"}</text>
				</box>
				<box flexDirection="row">
					<text fg={colors.textSubtle}>cwd </text>
					<text fg={colors.textMuted}>{cwd}</text>
				</box>
			</box>

			<box flexDirection="column" paddingTop={2}>
				<KeyHint k="/help     " desc="list all commands" />
				<KeyHint k="/model    " desc="switch model" />
				<KeyHint k="/sessions " desc="browse history" />
				<KeyHint k="/settings " desc="configure" />
				<KeyHint k="Ctrl+C    " desc="exit" />
			</box>

			<box paddingTop={2}>
				<box border={["top"]} borderColor={colors.borderSoft} />
			</box>
		</box>
	);
}
