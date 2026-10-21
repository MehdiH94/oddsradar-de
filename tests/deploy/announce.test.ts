import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// deploy/announce.sh, run as the deploy workflow's announce job runs it.
const SCRIPT = resolve(__dirname, "../../deploy/announce.sh");
const REPO = "https://github.com/MehdiH94/oddsradar-de";
const SITE = "https://odds-blitzer.de";

function announce(result: string, message: string) {
  const run = spawnSync("bash", [SCRIPT, result, REPO, SITE], { input: message, encoding: "utf8" });
  expect(run.status).toBe(0);
  return run.stdout.trim() ? JSON.parse(run.stdout) : null;
}

const merge = (branch: string, title: string) => `Merge pull request #42 from MehdiH94/${branch}\n\n${title}\n`;

describe("deploy/announce.sh", () => {
  it("announces a feature in production, with its pull request and the site", () => {
    expect(announce("success", merge("feat/telegram", "feat: Telegram alerts"))).toEqual({
      username: "OddsBlitzer",
      allowed_mentions: { parse: [] },
      content: `🚀 **In production:** feat: Telegram alerts\n${REPO}/pull/42\n${SITE}`,
    });
  });

  it("announces a fix", () => {
    expect(announce("success", merge("fix/swapped-teams", "fix: swapped teams")).content).toMatch(/^🛠️ \*\*In production:\*\* fix: swapped teams\n/);
  });

  it("stays quiet on docs, CI and chores", () => {
    expect(announce("success", merge("docs/readme", "docs: README"))).toBeNull();
    expect(announce("success", merge("chore/deps", "chore: deps"))).toBeNull();
    expect(announce("success", "Some commit\n")).toBeNull();
  });

  it("always announces a failed deploy", () => {
    expect(announce("failure", merge("docs/readme", "docs: README")).content).toBe(`❌ **Deploy failed:** docs: README\n${REPO}/pull/42`);
    expect(announce("failure", "Some commit\n").content).toBe("❌ **Deploy failed:** Some commit");
  });

  it("keeps a title with quotes and markdown as plain JSON text", () => {
    const title = 'feat: a "Seite prüfen" link & `code`';
    expect(announce("success", merge("feat/x", title)).content).toContain(title);
  });
});
