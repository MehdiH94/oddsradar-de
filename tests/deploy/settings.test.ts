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

  it("writes the administrators' webhook, and refuses one that is no Discord webhook", () => {
    const ADMIN = "https://discord.com/api/webhooks/987654321098765432/Admin_Token-1";
    expect(apply(`DISCORD_ADMIN_WEBHOOK_URL=${ADMIN}\n`).status).toBe(0);
    expect(readFileSync(env, "utf8")).toContain(`DISCORD_ADMIN_WEBHOOK_URL=${ADMIN}\n`);
    expect(apply("DISCORD_ADMIN_WEBHOOK_URL=https://evil.example/hook\n").status).not.toBe(0);
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
    expect(apply("SMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_USER=apikey\nSMTP_PASSWORD=s3cret-Pass_word!\nSMTP_FROM=OddsBlitzer <no-reply@example.com>\n").status).toBe(0);
    expect(readFileSync(env, "utf8")).toContain("SMTP_FROM=OddsBlitzer <no-reply@example.com>\n");
    for (const bad of ['SMTP_PASSWORD=has space', 'SMTP_PASSWORD=has"quote', "SMTP_PASSWORD=has$dollar", "SMTP_HOST=host;reboot", "SMTP_PORT=abc"]) {
      expect(apply(`${bad}\n`).status).not.toBe(0);
    }
  });
});

// Which branch a deploy.sh run is for: main unless a key's forced command
// says otherwise.
describe("deploy.sh's branch", () => {
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

  it("deploys main unless told otherwise, with the sandbox's compose file", () => {
    const main = sha("origin/main");
    const dev = sha("origin/development");
    expect(run("checkout ''", {}).status).toBe(0);
    expect(sha("HEAD")).toBe(main);
    expect(run(`checkout ${dev}`, {}).stderr).toContain(`${dev} is not a commit of origin/main`);
    expect(run('echo "$COMPOSE ${SERVICES[*]}"', {}).stdout.trim()).toBe("docker-compose.sandbox.yml web worker");
  });

  it("deploys another branch only when the forced command names it", () => {
    const dev = sha("origin/development");
    expect(run(`checkout ${dev}`, { DEPLOY_BRANCH: "development" }).status).toBe(0);
    expect(sha("HEAD")).toBe(dev);
  });

  it("refuses a branch name that isn't one", () => {
    expect(run("true", { DEPLOY_BRANCH: "main; reboot" }).status).not.toBe(0);
  });
});

// deploy.sh's build, restart and health check, with docker and curl replaced
// by stand-ins that log their calls: the containers are rebuilt and restarted
// from the sandbox's compose file, and a container that is not running fails
// the deploy.
describe("deploy.sh's containers", () => {
  let dir: string;
  let calls: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oddsblitzer-docker-"));
    calls = join(dir, "calls");
    writeFileSync(
      join(dir, "docker"),
      `#!/bin/sh\necho "docker $*" >> "${calls}"\ncase "$*" in *" ps "*) printf '%s\\n' $RUNNING ;; esac\n`
    );
    writeFileSync(join(dir, "curl"), `#!/bin/sh\necho "curl $*" >> "${calls}"\nexit \${CURL_EXIT:-0}\n`);
    writeFileSync(join(dir, "sleep"), "#!/bin/sh\nexit 0\n");
    for (const bin of ["docker", "curl", "sleep"]) chmodSync(join(dir, bin), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (script: string, env: Record<string, string>) =>
    spawnSync("bash", ["-c", `source <(sed '/^main "\\$@"$/,$d' "${SCRIPT}") && ${script}`], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DEPLOY_HEALTH_TIMEOUT_S: "2", ...env },
    });
  const logged = () => readFileSync(calls, "utf8").trim().split("\n");

  it("rebuilds and restarts the sandbox's containers, then checks both run", () => {
    const deploy = run("build && restart && check_health", { RUNNING: "web worker" });
    expect(deploy.status).toBe(0);
    expect(deploy.stdout).toContain("health check passed");
    expect(logged()).toEqual([
      "docker compose -f docker-compose.sandbox.yml build",
      "docker compose -f docker-compose.sandbox.yml up -d --remove-orphans",
      "curl -fs -o /dev/null http://127.0.0.1:5010/api/health",
      "docker compose -f docker-compose.sandbox.yml ps --status running --services",
    ]);
  });

  it("fails when the worker is not running after the restart", () => {
    const deploy = run("check_health", { RUNNING: "web" });
    expect(deploy.status).not.toBe(0);
    expect(deploy.stderr).toContain("worker is not running");
  });

  it("fails when the API does not answer", () => {
    const deploy = run("check_health", { RUNNING: "web worker", CURL_EXIT: "7" });
    expect(deploy.status).not.toBe(0);
    expect(deploy.stderr).toContain("the API does not answer on http://127.0.0.1:5010/api/health");
  });
});
