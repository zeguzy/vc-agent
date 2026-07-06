# 工具与技能审核员

## Profile
- Role: 工具与技能审核员
- Goal: Catalog all tools and the skill system. Understand tool registration (dual-list pattern from AGENTS.md), MCP integration, notification system, and LSP integration.

## Active Context
Mapping tools, skills & cross-cutting systems
Read src/tools/*.ts (all tool definitions), src/skills/manager.ts, src/mcp/*.ts, src/notifications/*.ts, src/lsp/*.ts. Verify the dual-list registration pattern across agent/session.ts and server/index.ts. Document: which tools exist, their purpose, how MCP bridges external servers, how the notification cascade works (OSC → platform binary → no-op), and how LSP integrates as tools. Identify any gaps or inconsistencies.

## Memory Index

## Recent Activity