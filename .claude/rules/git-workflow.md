# Git workflow

Rules for every change to this repository, by Claude Code or anyone else. The
full path is in CONTRIBUTING.md, section 6. Nothing here is optional: if a
request seems to need an exception, ask the user instead of making one.

## Branches

- `main` is production (https://cote-radar.fr). `development` is the
  integration branch, deployed to staging (https://staging.cote-radar.fr).
- **Never commit, push, rebase or force-push on `main`.** `main` only moves
  when a pull request `development` -> `main` is merged.
- Every feature or bug starts from an up-to-date `development`:
  `git switch development && git pull`, then `feat/<name>` or `fix/<name>`.
  Never branch from `main`, not even for a hotfix.
- Commits keep the prefixes of CONTRIBUTING.md (`feat:`, `fix:`, `test:`,
  `docs:`, `ci:`, `chore:`), and every change comes with its test.

## Pull requests

- A feature or bug branch is merged only through a pull request into
  `development` (`gh pr create --base development`), once CI (`ci` workflow) is
  green. Merge with a merge commit.
- Merging a pull request is the user's call unless they asked for it. Ask
  before running `gh pr merge`.
- After a merge into `development`, follow the `deploy-staging` run to green
  and report the staging result.

## Promotion to production

- Only when the user explicitly asks for a production release, and only after
  `deploy-staging` is green on the `development` commit to release and the
  change has been checked on staging.
- The only pull request into `main` is `development` -> `main`
  (`gh pr create --base main --head development`); `promotion-guard` fails any
  other. Never open one from a feature branch.
- A production bug is fixed the same way as any other: `fix/…` from
  `development`, staging, then promotion. There is no shortcut to `main`.
- `deploy.yml`'s `gate` job refuses to deploy a commit of `main` that was not
  deployed on staging. Do not work around it (no `--force`, no editing the
  gate, no manual run of `deploy/deploy.sh` on the production checkout to
  bypass it) and do not disable it.

## Environments

- Staging is production-like but separate: its own databases, its own
  services (`coteradar-staging-*`), no Discord alerts. Never point staging at
  production's `auth.sqlite`, and never copy staging data to production.
- Private keys and secrets are never read, printed or pasted: the user adds
  them to GitHub secrets or to the VPS themselves.
