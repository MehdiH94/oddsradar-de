import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// OddsBlitzer was started from CoteRadar, the French site, which runs on its
// own server from its own repository. Nothing here may lead to it: a command
// copied from the documentation, a deploy or a workflow must only ever reach
// OddsBlitzer's server, repository and sites.
const ROOT = resolve(__dirname, "../..");
const CHECKED = ["deploy", ".github", "README.md", "CONTRIBUTING.md", "web/README.md", ".env.example"];
const COTERADAR = [
  /cote-radar\.fr/i, // its sites
  /141\.94\.244\.108/, // its server
  /ouassimBenMosbah|coteRadar\.git/i, // its repository
  /\/opt\/coteradar/, // its checkouts
  /\bcoteradar-(?:staging-)?(?:worker|web|backup|deploy)/, // its services and sudoers
];

const files = (path: string): string[] => {
  const full = join(ROOT, path);
  try {
    if (!statSync(full).isDirectory()) return [full];
  } catch {
    return [];
  }
  return readdirSync(full).flatMap((name) => files(join(path, name)));
};

describe("OddsBlitzer's deployment and documentation", () => {
  it("never point to CoteRadar's server, repository, sites or services", () => {
    const found: string[] = [];
    for (const file of CHECKED.flatMap(files)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (COTERADAR.some((p) => p.test(line))) found.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("deploy to OddsBlitzer's server and sites only", () => {
    for (const workflow of ["deploy.yml", "deploy-staging.yml"]) {
      const text = readFileSync(join(ROOT, ".github/workflows", workflow), "utf8");
      expect(text).toMatch(/^\s*DEPLOY_HOST: 141\.95\.86\.176$/m);
      expect(text).toMatch(/'https:\/\/(?:staging\.)?odds-blitzer\.de'/);
    }
  });
});
