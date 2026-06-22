import { type Message } from "../../store.js"
import { colors, icons } from "../theme.js"
import { syntaxStyle } from "../syntax.js"

function UserMessageView({ message, index }: { message: Message, index: number }) {
	return (
		<box
			border={["left"]}
			borderColor={colors.agent}
			marginTop={index === 0 ? 0 : 1}
			flexShrink={0}
		>
			<box
				paddingTop={1}
				paddingBottom={1}
				paddingLeft={2}
				backgroundColor={colors.backgroundPanel}
				flexShrink={0}
			>
				<text fg={colors.text}>{message.content}</text>
			</box>
		</box>
	)
}

function AssistantMessageView({ message }: { message: Message }) {
	return (
		<box paddingLeft={3} marginTop={1} flexShrink={0}>
			<markdown
				syntaxStyle={syntaxStyle}
				streaming={true}
				content={message.content}
				fg={colors.markdownText}
				bg={colors.background}
			/>
		</box>
	)
}

function ToolMessageView({ message }: { message: Message }) {
	if (!message.toolName) return null

	const icon = message.toolStatus === "running" ? icons.toolRunning
		: message.toolStatus === "error" ? icons.toolError
		: icons.toolDone
	const fg = message.toolStatus === "running" ? colors.textMuted
		: message.toolStatus === "error" ? colors.error
		: colors.success

	if (message.toolStatus === "running") {
		const args = message.toolArgs
		const argStr = typeof args === "string" ? args : JSON.stringify(args ?? "")
		const shortArgs = argStr.length > 50 ? `${argStr.slice(0, 47)}...` : argStr
		return (
			<box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="row">
				<text width={2} fg={colors.textMuted}>{icon}</text>
				<text fg={colors.textMuted}>{message.toolName}({shortArgs})</text>
			</box>
		)
	}

	return (
		<box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="row">
			<text width={2} fg={fg}>{icon}</text>
			<text fg={colors.textMuted}>{message.toolName}</text>
		</box>
	)
}

function SeparatorView() {
	return (
		<box marginTop={1} flexShrink={0}>
			<box border={["top"]} borderColor={colors.borderActive} />
		</box>
	)
}

export function MessageList({ messages }: { messages: Message[] }) {
	return (
		<scrollbox
			flexGrow={1}
			scrollY
			stickyScroll
			stickyStart="bottom"
			focused={false}
		>
			<box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
				<box height={1} />
				{messages.map((msg, i) => {
					if (msg.role === "separator") return <SeparatorView key={msg.id} />
					if (msg.role === "user") return <UserMessageView key={msg.id} message={msg} index={i} />
					if (msg.role === "tool") return <ToolMessageView key={msg.id} message={msg} />
					return <AssistantMessageView key={msg.id} message={msg} />
				})}
			</box>
		</scrollbox>
	)
}
