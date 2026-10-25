import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// deploy/vps-report.sh, run as its SSH key's forced command runs it: the
// command the client asked for in SSH_ORIGINAL_COMMAND. Dry runs: what it
// would run is printed instead.
const SCRIPT = resolve(__dirname, "../../deploy/vps-report.sh");

function report(command: string | undefined) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, REPORT_DRY_RUN: "1", APP_DIR: resolve(__dirname, "../..") };
  if (command !== undefined) env.SSH_ORIGINAL_COMMAND = command;
  const run = spawnSync("bash", [SCRIPT], { env, encoding: "utf8" });
  return { status: run.status, out: run.stdout.trim(), err: run.stderr.trim() };
}

describe("deploy/vps-report.sh", () => {
  it("runs the surebet report, over 7 days unless told", () => {
    expect(report("surebet-report")).toMatchObject({ status: 0, out: "npm run --silent surebet-report -- 7" });
    expect(report("surebet-report 3")).toMatchObject({ status: 0, out: "npm run --silent surebet-report -- 3" });
  });

  it("runs the probe and the status", () => {
    expect(report("probe").out).toContain("node scripts/probe-geo-bookmakers.mjs");
    const status = report("status");
    expect(status.status).toBe(0);
    expect(status.out).toContain("systemctl status --no-pager --lines=0 oddsradar-worker oddsradar-web");
  });

  it("fetches a sample of Rabona's sportsbook, its ids checked", () => {
    expect(report("rabona-sample menu").out).toContain("GetSportMenu?culture=en-GB&timezoneOffset=0&integration=rabona");
    expect(report("rabona-sample upcoming 66").out).toContain("GetUpcoming?culture=en-GB&timezoneOffset=0&integration=rabona&deviceType=1&numFormat=en-GB&countryCode=DE&eventCount=100&sportId=66");
    expect(report("rabona-sample champ 2936,2941").out).toContain("champIds=2936%2C2941");
    for (const command of [
      "rabona-sample",
      "rabona-sample menu x",
      "rabona-sample upcoming",
      "rabona-sample upcoming 66;id",
      "rabona-sample upcoming $(id)",
      "rabona-sample champ 1,2,3,4,5,6,7,8,9,10,11",
      "rabona-sample champ 2936&x=1",
      "rabona-sample https://example.com",
    ]) {
      expect(report(command).status, command).toBe(2);
    }
  });

  it("refuses anything else, its arguments included", () => {
    for (const command of [
      undefined,
      "",
      "bash",
      "rm -rf /opt/oddsradar",
      "deploy",
      "surebet-report 7; rm -rf /",
      "surebet-report $(id)",
      "surebet-report 0",
      "surebet-report 100",
      "surebet-report 7 8",
      "probe now",
      "status; cat .env",
    ]) {
      const run = report(command);
      expect(run.status, String(command)).toBe(2);
      expect(run.out, String(command)).toBe("");
      expect(run.err).toMatch(/^vps-report: .*Allowed: surebet-report \[days\], probe, status, rabona-sample menu\|upcoming <id>\|champ <ids>\.$/);
    }
  });

  it("is what the workflow's key reaches, on OddsBlitzer's server only, and never deploys", () => {
    const workflow = readFileSync(resolve(__dirname, "../../.github/workflows/vps-report.yml"), "utf8");
    expect(workflow).toMatch(/^\s*DEPLOY_HOST: 141\.95\.86\.176$/m);
    expect(workflow).toContain("secrets.VPS_REPORT_SSH_KEY");
    expect(workflow).not.toContain("secrets.VPS_SSH_KEY");
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
  });
});
