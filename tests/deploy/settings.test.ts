import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// deploy/deploy.sh's apply_settings, run as the deploy job runs it: the
// settings on standard input, written to .env.
const SCRIPT = resolve(__dirname, "../../deploy/deploy.sh");
const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/AbC-dEf_123";

describe("deploy.sh's settings", () => {
  let dir: string;
  let env: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-deploy-"));
    env = join(dir, ".env");
    writeFileSync(env, "PORT=3000\nPOLL_INTERVAL_MINUTES=5\n");
    chmodSync(env, 0o640);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // Every function of the script, without running its main().
  const apply = (input: string) =>
    spawnSync("bash", ["-c", `source <(sed '/^main "\\$@"$/,$d' "${SCRIPT}") && apply_settings "${env}"`], {
      input,
      encoding: "utf8",
    });

  it("writes the deploy job's settings to .env, keeping its other lines and permissions", () => {
    const run = apply(`DISCORD_WEBHOOK_URL=${WEBHOOK}\r\nPUBLIC_URL=https://cote-radar.fr\n`);
    expect(run.status).toBe(0);
    expect(readFileSync(env, "utf8")).toBe(
      `PORT=3000\nPOLL_INTERVAL_MINUTES=5\nDISCORD_WEBHOOK_URL=${WEBHOOK}\nPUBLIC_URL=https://cote-radar.fr\n`
    );
    expect(statSync(env).mode & 0o777).toBe(0o640);
    // Never the value in the deploy's log.
    expect(run.stdout).toContain("DISCORD_WEBHOOK_URL set in .env");
    expect(run.stdout + run.stderr).not.toContain("AbC-dEf_123");
  });

  it("leaves .env alone when nothing changes, and removes a setting sent empty", () => {
    apply(`DISCORD_WEBHOOK_URL=${WEBHOOK}\n`);
    const again = apply(`DISCORD_WEBHOOK_URL=${WEBHOOK}\n`);
    expect(again.stdout).not.toContain("set in");
    const removed = apply("DISCORD_WEBHOOK_URL=\nPUBLIC_URL=\n");
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("DISCORD_WEBHOOK_URL removed from .env");
    expect(removed.stdout).not.toContain("PUBLIC_URL");
    expect(readFileSync(env, "utf8")).toBe("PORT=3000\nPOLL_INTERVAL_MINUTES=5\n");
  });

  it("takes nothing from an empty standard input", () => {
    expect(apply("").status).toBe(0);
    expect(readFileSync(env, "utf8")).toBe("PORT=3000\nPOLL_INTERVAL_MINUTES=5\n");
  });

  it("fails the deploy on a setting it doesn't know or of the wrong form, without showing it", () => {
    const wrong = apply("DISCORD_WEBHOOK_URL=https://evil.example/api/webhooks/1/secret-token\n");
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain("DISCORD_WEBHOOK_URL does not have the expected form");
    expect(wrong.stderr).not.toContain("secret-token");
    expect(apply("PUBLIC_URL=http://site/$(reboot)\n").status).not.toBe(0);
    // Another line of .env, or none at all.
    expect(apply("PORT=80\n").stderr).toContain("unexpected setting");
    expect(apply("=x\n").stderr).toContain("unexpected setting");
    expect(readFileSync(env, "utf8")).toBe("PORT=3000\nPOLL_INTERVAL_MINUTES=5\n");
  });
});

describe("deploy.sh's SMTP settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "coteradar-smtp-"));
  const env = join(dir, ".env");
  const apply = (input: string) =>
    spawnSync("bash", ["-c", `source <(sed '/^main "\\$@"$/,$d' "${SCRIPT}") && apply_settings "${env}"`], { input, encoding: "utf8" });

  it("writes the mail settings, and refuses a value that systemd or dotenv would read differently", () => {
    writeFileSync(env, "PORT=3000\n");
    expect(apply("SMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_USER=apikey\nSMTP_PASSWORD=s3cret-Pass_word!\nSMTP_FROM=OddsRadar <no-reply@example.com>\n").status).toBe(0);
    expect(readFileSync(env, "utf8")).toContain("SMTP_FROM=OddsRadar <no-reply@example.com>\n");
    for (const bad of ['SMTP_PASSWORD=has space', 'SMTP_PASSWORD=has"quote', "SMTP_PASSWORD=has$dollar", "SMTP_HOST=host;reboot", "SMTP_PORT=abc"]) {
      expect(apply(`${bad}\n`).status).not.toBe(0);
    }
  });
});

// Which branch and which services a deploy.sh run is for: production unless
// the staging key's forced command says otherwise.
describe("deploy.sh's branch and services", () => {
  let dir: string;
  let clone: string;
  const git = (cwd: string, ...args: string[]) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" });
  const sha = (ref: string) => git(clone, "rev-parse", ref).stdout.trim();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "coteradar-branch-"));
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    clone = join(dir, "clone");
    git(dir, "init", "--bare", "-b", "main", origin);
    git(dir, "clone", origin, work);
    git(work, "checkout", "-b", "main");
    git(work, "commit", "--allow-empty", "-m", "on main");
    git(work, "push", "origin", "main");
    git(work, "checkout", "-b", "development");
    git(work, "commit", "--allow-empty", "-m", "only on development");
    git(work, "push", "origin", "development");
    git(dir, "clone", origin, clone);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // The script's functions in the clone, with the deploy environment given.
  const run = (script: string, deployEnv: Record<string, string>) =>
    spawnSync("bash", ["-c", `source <(sed '/^main "\\$@"$/,$d' "${SCRIPT}") && ${script}`], {
      cwd: clone,
      encoding: "utf8",
      env: { ...process.env, ...deployEnv },
    });

  it("deploys main to the production services unless told otherwise", () => {
    const main = sha("origin/main");
    const dev = sha("origin/development");
    expect(run("checkout ''", {}).status).toBe(0);
    expect(sha("HEAD")).toBe(main);
    expect(run(`checkout ${dev}`, {}).stderr).toContain(`${dev} is not a commit of origin/main`);
    expect(run('echo "${SERVICES[*]}"', {}).stdout.trim()).toBe("oddsradar-worker oddsradar-web");
  });

  it("deploys development to the staging services when the forced command says so", () => {
    const dev = sha("origin/development");
    const staging = { DEPLOY_BRANCH: "development", DEPLOY_SERVICES: "oddsradar-staging-worker oddsradar-staging-web" };
    expect(run(`checkout ${dev}`, staging).status).toBe(0);
    expect(sha("HEAD")).toBe(dev);
    expect(run('echo "${SERVICES[*]}"', staging).stdout.trim()).toBe("oddsradar-staging-worker oddsradar-staging-web");
  });

  it("refuses a branch name that isn't one", () => {
    expect(run("true", { DEPLOY_BRANCH: "main; reboot" }).status).not.toBe(0);
  });
});
