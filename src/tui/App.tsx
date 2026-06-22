import { useState, useEffect, useRef, useCallback } from "react"
import { useKeyboard } from "@opentui/react"
import type { AgentSession, AgentSessionEvent } from "../agent/session.js"
import { extractAssistantText } from "../agent/session.js"
import {
	type Message,
	createUserMessage,
	createAssistantMessage,
	createToolMessage,
	createSeparator,
} from "../store.js"
import { MessageList } from "./components/MessageList.js"
import { InputBox } from "./components/InputBox.js"
import { StatusBar } from "./components/StatusBar.js"
import { colors } from "./theme.js"

interface AppProps {
	session: AgentSession
	model: string
	cwd: string
}

export function App({ session, model, cwd }: AppProps) {
	const [messages, setMessages] = useState<Message[]>([
		createAssistantMessage("你好！我是 openagent，可以帮你读写文件、运行命令。"),
	])
	const [isRunning, setIsRunning] = useState(false)
	const lastCtrlCRef = useRef<number>(0)
	const toolCallIdToMsgId = useRef<Map<string, string>>(new Map())

	useEffect(() => {
		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			switch (event.type) {
				case "agent_start":
					setIsRunning(true)
					break
				case "message_start": {
					const msg = event.message as any
					if (msg?.role === "assistant") {
						const newMsg = createAssistantMessage()
						setMessages((prev) => [...prev, newMsg])
					}
					break
				}
				case "message_update": {
					const msg = event.message as any
					if (msg?.role === "assistant") {
						const text = extractAssistantText(msg.content)
						setMessages((prev) => {
							const updated = [...prev]
							for (let i = updated.length - 1; i >= 0; i--) {
								if (updated[i].role === "assistant") {
									updated[i] = { ...updated[i], content: text }
									break
								}
							}
							return updated
						})
					}
					break
				}
				case "tool_execution_start": {
					const toolMsg = createToolMessage(event.toolName, event.args, "running")
					toolCallIdToMsgId.current.set(event.toolCallId, toolMsg.id)
					setMessages((prev) => [...prev, toolMsg])
					break
				}
				case "tool_execution_end": {
					const msgId = toolCallIdToMsgId.current.get(event.toolCallId)
					if (msgId) {
						setMessages((prev) =>
							prev.map((m) =>
								m.id === msgId
									? { ...m, toolStatus: event.isError ? "error" : "done" }
									: m,
							),
						)
					}
					break
				}
				case "agent_end":
					setIsRunning(false)
					setMessages((prev) => [...prev, createSeparator()])
					break
			}
		})
		return unsubscribe
	}, [session])

	const handlePrompt = useCallback(
		(text: string) => {
			setMessages((prev) => [...prev, createUserMessage(text)])
			session.prompt(text).catch((err) => {
				setMessages((prev) => [
					...prev,
					createAssistantMessage(`Error: ${err instanceof Error ? err.message : String(err)}`),
				])
				setIsRunning(false)
			})
		},
		[session],
	)

	useKeyboard((key) => {
		if (key.name === "c" && key.ctrl) {
			const now = Date.now()
			if (now - lastCtrlCRef.current < 1000) {
				process.exit(0)
			}
			lastCtrlCRef.current = now
			if (isRunning) {
				session.abort().catch(() => {})
			} else {
				process.exit(0)
			}
		}
	})

	return (
		<box flexDirection="column" height={"100%"} backgroundColor={colors.background}>
			<MessageList messages={messages} />
			<InputBox disabled={isRunning} onSubmit={handlePrompt} />
			<StatusBar model={model} cwd={cwd} />
		</box>
	)
}
