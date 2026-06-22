export type MessageRole = "user" | "assistant" | "tool" | "separator"

export interface Message {
  id: string
  role: MessageRole
  content: string
  toolName?: string
  toolArgs?: unknown
  toolStatus?: "running" | "done" | "error"
}

let _idCounter = 0
export function nextId(): string {
  return `msg-${++_idCounter}`
}

export function createUserMessage(text: string): Message {
  return { id: nextId(), role: "user", content: text }
}

export function createAssistantMessage(text: string = ""): Message {
  return { id: nextId(), role: "assistant", content: text }
}

export function createToolMessage(
  toolName: string,
  toolArgs: unknown,
  status: "running" | "done" | "error" = "running",
): Message {
  return {
    id: nextId(),
    role: "tool",
    content: "",
    toolName,
    toolArgs,
    toolStatus: status,
  }
}

export function createSeparator(): Message {
  return { id: nextId(), role: "separator", content: "" }
}
