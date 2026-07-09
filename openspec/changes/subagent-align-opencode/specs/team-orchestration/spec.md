## MODIFIED Requirements

### Requirement: TeamMember full tool inheritance from main session
TeamManager.createMember SHALL create member sessions that inherit the complete tool set from the main session, rather than the current manual `filterMemberTools` + `buildMemberCustomTools` whitelist approach. Only recursive/privilege tools (subagent, team, question) SHALL be excluded. Skills and MCP SHALL be inherited via resourceLoader and McpManager.

#### Scenario: Member session with full capabilities
- **WHEN** a team member is created
- **THEN** the member's session uses the same tools allowlist as the main session, minus NEVER_MEMBER_TOOLS (subagent/team/question), instead of the current restricted default ["read","bash","grep","find","memory","message"]

#### Scenario: Member inherits MCP tools
- **WHEN** a team member is created and the main session has MCP tools
- **THEN** the member session automatically includes the "mcp" tool and all MCP tool definitions from the parent session's McpManager

#### Scenario: Member with skill injection
- **WHEN** a team member is created with assignedSkills=["lark-doc"]
- **THEN** the member session's resourceLoader includes the lark-doc skill content in the system prompt

#### Scenario: Member exclusion list enforced
- **WHEN** a team member is created
- **THEN** the tools subagent, team, and question are excluded from the member's tool allowlist, preventing recursive spawning and privilege escalation
