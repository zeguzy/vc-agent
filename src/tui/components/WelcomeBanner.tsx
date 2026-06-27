import { colors } from "../theme.js";

const LOGO = [
	"  ╭───╮     ╭───────╮",
	"  │ o │     │ p e n │",
	"  │ p │     │ a g e │",
	"  │ e │ ─── │ n t   │",
	"  │ n │     │       │",
	"  │ a │     │       │",
	"  │ g │     │       │",
	"  ╰───╯     ╰───────╯",
];

interface WelcomeBannerProps {
	cwd: string;
	model?: string;
}

export function WelcomeBanner({ cwd, model }: WelcomeBannerProps) {
	return (
		<box flexDirection="column" paddingTop={2} paddingBottom={2} flexShrink={0}>
			{/* Logo */}
			<box flexDirection="column" paddingBottom={1}>
				{LOGO.map((line, i) => (
					<text key={i} fg={i < 5 ? colors.secondary : colors.primary}>
						{line}
					</text>
				))}
			</box>

			{/* Subtitle */}
			<text fg={colors.textSubtle}>Your terminal coding assistant</text>

			{/* Model + CWD */}
			<box flexDirection="column" paddingTop={1}>
				<text fg={colors.textMuted}>
					<text fg={colors.textSubtle}>model: </text>
					<text fg={colors.primary}>{model ?? "default"}</text>
				</text>
				<text fg={colors.textMuted}>
					<text fg={colors.textSubtle}>cwd: </text>
					<text fg={colors.text}>{cwd}</text>
				</text>
			</box>

			{/* Quick tips */}
			<box flexDirection="column" paddingTop={1}>
				<text fg={colors.textSubtle}>Quick Start</text>
				<text fg={colors.textMuted}>
					<text fg={colors.secondary}>/help</text>
					<text fg={colors.textMuted}> list all commands</text>
				</text>
				<text fg={colors.textMuted}>
					<text fg={colors.secondary}>/model</text>
					<text fg={colors.textMuted}> switch model</text>
				</text>
				<text fg={colors.textMuted}>
					<text fg={colors.secondary}>/sessions</text>
					<text fg={colors.textMuted}> pick from previous chats</text>
				</text>
				<text fg={colors.textMuted}>
					<text fg={colors.secondary}>/settings</text>
					<text fg={colors.textMuted}> open settings</text>
				</text>
				<text fg={colors.textMuted}>
					<text fg={colors.secondary}>Ctrl+C</text>
					<text fg={colors.textMuted}> exit</text>
				</text>
			</box>

			{/* Separator */}
			<box paddingTop={1}>
				<box border={["top"]} borderColor={colors.borderSoft} />
			</box>
		</box>
	);
}
