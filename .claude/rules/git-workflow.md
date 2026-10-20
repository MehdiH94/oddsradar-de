# Git workflow

Rules for every change to this repository, by Claude Code or anyone else. The
full path is in CONTRIBUTING.md, section 6. Nothing here is optional: if a
request seems to need an exception, ask the user instead of making one.

## One environment

- While the site has no traffic and no customers, there is one environment:
  production (https://odds-blitzer.de), deployed from `main`. There is no
  staging any more (the user's decision, 20/10/2026): `development` and
  `deploy-staging` are retired.

## Branches

- **Never commit or push directly on `main`, never rebase or force-push it.**
  `main` only moves when a pull request into it is merged.
- Every feature or bug starts from an up-to-date `main`:
  `git switch main && git pull`, then `feat/<name>` or `fix/<name>`.
- Commits keep the prefixes of CONTRIBUTING.md (`feat:`, `fix:`, `test:`,
  `docs:`, `ci:`, `chore:`), and every change comes with its test.

## Pull requests

- A feature or bug branch is merged only through a pull request into `main`,
  once CI (`ci` workflow) is green. Merge with a merge commit.
- Claude Code merges its own pull requests as soon as CI is green, without
  asking (the user's standing instruction): run the checks of CONTRIBUTING.md
  section 5 locally first, since a merge goes straight to production.
- After a merge, follow the `deploy` run to green and report the result.

## Production

- `deploy.yml`'s `gate` job refuses to deploy a commit of `main` that is not
  a pull request's merge commit. Do not work around it (no `--force`, no
  editing the gate, no manual run of `deploy/deploy.sh` on the production
  checkout to bypass it) and do not disable it.
- A production bug is fixed like any other change: `fix/…` from `main`, pull
  request, green CI, merge. A bad release is undone with a `git revert` in a
  pull request.

## Environments

- This repository is OddsBlitzer (odds-blitzer.de, VPS 141.95.86.176).
  CoteRadar (cote-radar.fr, repository ouassimBenMosbah/coteRadar, VPS
  141.94.244.108) is another project: never connect to it, deploy to it, or
  change its repository or its secrets. `tests/deploy/targets.test.ts` keeps
  its targets out of `deploy/`, the workflows and the docs.
- The old staging services on the VPS (`oddsradar-staging-*`,
  `/opt/oddsradar-staging`) are no longer deployed. Never point them at
  production's `auth.sqlite`, and never copy their data to production.
- Private keys and secrets are never read, printed or pasted: the user adds
  them to GitHub secrets or to the VPS themselves.
