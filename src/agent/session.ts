import {
  createAgentSession,
  SessionManager,
  ModelRegistry,
  AuthStorage,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent"

export interface SessionOptions {
  cwd: string
  model?: string
}

export async function createSession(options: SessionOptions): Promise<AgentSession> {
  const authStorage = AuthStorage.create()
  const modelRegistry = ModelRegistry.create(authStorage)
  const model = resolveModel(modelRegistry, options.model)

  const result = await createAgentSession({
    cwd: options.cwd,
    authStorage,
    modelRegistry,
    ...(model ? { model } : {}),
    tools: ["read", "bash", "edit", "write"],
    sessionManager: SessionManager.inMemory(),
  })
  return result.session
}

function resolveModel(registry: ModelRegistry, modelStr?: string) {
  if (!modelStr) return undefined

  if (modelStr.includes(":")) {
    const [provider, modelId] = modelStr.split(":", 2)
    return registry.find(provider, modelId)
  }

  for (const m of registry.getAll()) {
    if (m.id === modelStr) return m
  }
  return undefined
}

export function extractAssistantText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text as string)
    .join("")
}

export function summarizeArgs(args: unknown, maxLen = 50): string {
  const str = typeof args === "string" ? args : JSON.stringify(args)
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + "..."
}

export type {
  AgentSession,
  AgentSessionEvent,
}
