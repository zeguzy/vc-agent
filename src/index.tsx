#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { createSession } from "./agent/session.js"
import { App } from "./tui/App.js"

interface ParsedArgs {
  model?: string
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { help: false }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      args.help = true
    } else if (arg === "--model" || arg === "-m") {
      args.model = argv[++i]
    } else if (arg.startsWith("--model=")) {
      args.model = arg.slice("--model=".length)
    }
  }
  return args
}

function showHelp(): void {
  console.log(`
openagent — 基于 Pi SDK 的全屏 TUI 代码 Agent

用法:
  openagent [选项]

选项:
  --model, -m <name>    指定 LLM 模型 (如: claude-sonnet-4-20250514)
  --help, -h           显示帮助信息

环境变量:
  ANTHROPIC_API_KEY    Anthropic API 密钥
  OPENAI_API_KEY       OpenAI API 密钥
  DEEPSEEK_API_KEY     DeepSeek API 密钥
  GOOGLE_API_KEY       Google AI API 密钥
  MISTRAL_API_KEY      Mistral API 密钥

示例:
  openagent
  openagent --model claude-sonnet-4-20250514
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.help) {
    showHelp()
    process.exit(0)
  }

  const hasApiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.MISTRAL_API_KEY
  if (!hasApiKey) {
    console.error(
      "错误: 请设置 LLM API 密钥环境变量\n" +
        "  ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY / GOOGLE_API_KEY / MISTRAL_API_KEY",
    )
    process.exit(1)
  }

  const cwd = process.cwd()
  const model = args.model

  let session
  try {
    session = await createSession({ cwd, model })
  } catch (err) {
    console.error(
      "创建 Agent 会话失败:",
      err instanceof Error ? err.message : String(err),
    )
    process.exit(1)
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  })

  const root = createRoot(renderer)
  root.render(<App session={session} model={model || "default"} cwd={cwd} />)
}

main().catch((err) => {
  console.error("启动失败:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
