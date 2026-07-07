import { describe, expect, it } from "bun:test";
import {
	AGENT_DIR_NAME,
	agentConfigDir,
	buildSqliteUri,
	isSqliteUri,
	parseSessionIdFromUri,
	SESSIONS_BACKUP_DIR_NAME,
	SESSIONS_DB_NAME,
	SESSIONS_DIR_NAME,
	sessionsBackupDir,
	sessionsDbPath,
	sessionsLegacyDir,
	TEAM_DIR_NAME,
	teamDir,
	teamDirForSession,
} from "../src/utils/paths.js";

const HOME = "/home/test";

describe("agentConfigDir", () => {
	it("resolves to ~/.config/openagent", () => {
		expect(agentConfigDir(HOME)).toBe("/home/test/.config/openagent");
	});

	it("uses real homedir by default", () => {
		const dir = agentConfigDir();
		expect(dir.endsWith(`/.config/${AGENT_DIR_NAME}`)).toBe(true);
	});

	it("is pure (no filesystem touch)", () => {
		expect(agentConfigDir("/nonexistent/home")).toBe("/nonexistent/home/.config/openagent");
	});
});

describe("sessionsDbPath", () => {
	it("resolves to ~/.config/openagent/sessions.db", () => {
		expect(sessionsDbPath(HOME)).toBe(`/home/test/.config/${AGENT_DIR_NAME}/${SESSIONS_DB_NAME}`);
	});
});

describe("sessionsLegacyDir", () => {
	it("resolves to ~/.config/openagent/sessions", () => {
		expect(sessionsLegacyDir(HOME)).toBe(
			`/home/test/.config/${AGENT_DIR_NAME}/${SESSIONS_DIR_NAME}`,
		);
	});
});

describe("sessionsBackupDir", () => {
	it("resolves to ~/.config/openagent/sessions.bak", () => {
		expect(sessionsBackupDir(HOME)).toBe(
			`/home/test/.config/${AGENT_DIR_NAME}/${SESSIONS_BACKUP_DIR_NAME}`,
		);
	});
});

describe("teamDir", () => {
	it("resolves to ~/.config/openagent/team", () => {
		expect(teamDir(HOME)).toBe(`/home/test/.config/${AGENT_DIR_NAME}/${TEAM_DIR_NAME}`);
	});
});

describe("teamDirForSession", () => {
	it("appends sessionId under team/", () => {
		expect(teamDirForSession("abc-123", HOME)).toBe(
			`/home/test/.config/${AGENT_DIR_NAME}/${TEAM_DIR_NAME}/abc-123`,
		);
	});

	it("handles sessionId with special chars (no sanitization — caller's responsibility)", () => {
		expect(teamDirForSession("0192-uuid", HOME)).toBe(
			`/home/test/.config/${AGENT_DIR_NAME}/${TEAM_DIR_NAME}/0192-uuid`,
		);
	});
});

describe("parseSessionIdFromUri", () => {
	it("parses sqlite:// prefix", () => {
		expect(parseSessionIdFromUri("sqlite://abc-123")).toBe("abc-123");
	});

	it("parses sqlite:// prefix with uuid", () => {
		const uuid = "01923456789012345678901234567890";
		expect(parseSessionIdFromUri(`sqlite://${uuid}`)).toBe(uuid);
	});

	it("returns raw id when not a sqlite:// uri (defensive)", () => {
		expect(parseSessionIdFromUri("abc-123")).toBe("abc-123");
	});

	it("throws on empty string", () => {
		expect(() => parseSessionIdFromUri("")).toThrow("empty sessionFile");
	});

	it("throws on malformed sqlite:// uri (empty id)", () => {
		expect(() => parseSessionIdFromUri("sqlite://")).toThrow("malformed sqlite uri");
	});
});

describe("buildSqliteUri", () => {
	it("prefixes sessionId with sqlite://", () => {
		expect(buildSqliteUri("abc-123")).toBe("sqlite://abc-123");
	});

	it("round-trips with parseSessionIdFromUri", () => {
		const id = "01923456789012345678901234567890";
		expect(parseSessionIdFromUri(buildSqliteUri(id))).toBe(id);
	});
});

describe("isSqliteUri", () => {
	it("returns true for sqlite:// uris", () => {
		expect(isSqliteUri("sqlite://abc")).toBe(true);
	});

	it("returns false for plain paths", () => {
		expect(isSqliteUri("/foo/bar.jsonl")).toBe(false);
		expect(isSqliteUri("abc-123")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isSqliteUri("")).toBe(false);
	});
});

describe("consistency: sessionsDbPath under agentConfigDir", () => {
	it("sessionsDbPath is agentConfigDir + sessions.db", () => {
		expect(sessionsDbPath(HOME)).toBe(`${agentConfigDir(HOME)}/${SESSIONS_DB_NAME}`);
	});

	it("sessionsLegacyDir is agentConfigDir + sessions", () => {
		expect(sessionsLegacyDir(HOME)).toBe(`${agentConfigDir(HOME)}/${SESSIONS_DIR_NAME}`);
	});

	it("sessionsBackupDir is agentConfigDir + sessions.bak", () => {
		expect(sessionsBackupDir(HOME)).toBe(`${agentConfigDir(HOME)}/${SESSIONS_BACKUP_DIR_NAME}`);
	});

	it("teamDir is agentConfigDir + team", () => {
		expect(teamDir(HOME)).toBe(`${agentConfigDir(HOME)}/${TEAM_DIR_NAME}`);
	});

	it("teamDirForSession is teamDir + sessionId", () => {
		const sid = "sess-1";
		expect(teamDirForSession(sid, HOME)).toBe(`${teamDir(HOME)}/${sid}`);
	});
});
