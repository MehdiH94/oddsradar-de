import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The sandbox's container (Dockerfile, docker-compose.sandbox.yml). The CI's
// docker job builds and starts it; these keep the rules of the VPS that a
// green build would not show: the sandbox's network and ports, Caddy as the
// only way in, the databases in the volume, no secret in the image.
const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const dockerfile = read("Dockerfile");
const compose = read("docker-compose.sandbox.yml");
const dockerignore = read(".dockerignore").split("\n").map((l) => l.trim());

describe("the sandbox's container", () => {
  it("runs a Node version the code supports", () => {
    const engines = JSON.parse(read("package.json")).engines.node as string;
    const minMajor = Number(/(\d+)/.exec(engines)![1]);
    const bases = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
    expect(bases.length).toBeGreaterThan(0);
    for (const major of bases) expect(major).toBeGreaterThan(minMajor);
  });

  it("runs as the unprivileged user, the API by default", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^CMD \["node", "dist\/api\/index\.js"\]$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK [\s\S]*\/api\/health/m);
  });

  it("keeps secrets, databases and dependencies out of the image", () => {
    for (const entry of [".env", "data", "**/node_modules", ".git"]) expect(dockerignore).toContain(entry);
  });

  it("publishes the API on 127.0.0.1 only, in the sandbox's port range", () => {
    const published = [...compose.matchAll(/^\s*- "([^"]+):(\d+):(\d+)"$/gm)];
    expect(published).toHaveLength(1);
    const [, ip, hostPort, containerPort] = published[0];
    expect(ip).toBe("127.0.0.1");
    expect(Number(hostPort)).toBeGreaterThanOrEqual(5000);
    expect(Number(hostPort)).toBeLessThanOrEqual(5999);
    expect(containerPort).toBe("3000");
    expect(compose).not.toMatch(/0\.0\.0\.0:\d+:/);
  });

  it("joins the sandbox's own network, never the host's", () => {
    expect(compose).toMatch(/^networks:\n {2}sandbox:\n {4}external: true$/m);
    expect(compose).not.toMatch(/network_mode|privileged|docker\.sock|cap_add/);
  });

  it("keeps both databases in the shared volume", () => {
    expect(compose).toMatch(/DB_PATH: \/app\/data\/coteradar\.sqlite/);
    expect(compose).toMatch(/AUTH_DB_PATH: \/app\/data\/auth\.sqlite/);
    expect(compose).toMatch(/- data:\/app\/data/);
  });

  it("backs both databases up from the web container into ./backups", () => {
    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends sqlite3/);
    expect(dockerfile).toMatch(/^COPY deploy\/backup-db\.sh deploy\/backup-db\.sh$/m);
    expect(compose).toMatch(/- \.\/backups:\/app\/backups/);
    const unit = (name: string) => read(`deploy/${name}`);
    for (const [service, args, timer, when] of [
      ["oddsblitzer-backup.service", "data/auth.sqlite auth 30", "oddsblitzer-backup.timer", "hourly"],
      ["oddsblitzer-backup-odds.service", "data/coteradar.sqlite odds 28", "oddsblitzer-backup-odds.timer", "Sun *-*-* 04:00:00"],
    ]) {
      expect(unit(service)).toContain("WorkingDirectory=%h/projets/oddsblitzer");
      expect(unit(service)).toContain(
        `ExecStart=/usr/bin/docker compose -f docker-compose.sandbox.yml exec -T --user root web deploy/backup-db.sh ${args}`
      );
      expect(unit(service)).not.toMatch(/^User=/m);
      expect(unit(timer)).toContain(`OnCalendar=${when}`);
    }
  });
});
