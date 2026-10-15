<!-- Feature or bug branch -> development. Release: development -> main. -->

## What and why

## Checks

- [ ] A test covers the change (a failing one first, for a bug)
- [ ] `npx tsc --noEmit -p .` and `npm test`; in `web/`: `npm run lint`, `npm test`, `npm run build`
- [ ] The end-to-end tests pass (`npm run e2e`, which the CI also runs); a new critical path gets its own spec in `e2e/` (CONTRIBUTING.md, section 5)
- [ ] Release only (`development` -> `main`): checked on https://staging.cote-radar.fr, `deploy-staging` green
