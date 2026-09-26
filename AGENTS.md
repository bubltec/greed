# Agent instructions

**The source of truth for agent instructions in this repo is [`.cursor/rules/`](.cursor/rules/).**
This file and `CLAUDE.md` are pointers only; add or change rules in `.cursor/rules/`.

| Rule | Applies | Covers |
| --- | --- | --- |
| [`sync-before-code-changes`](.cursor/rules/sync-before-code-changes.mdc) | always | Fetch origin, compare branches, check whether the PR merged |
| [`recover-from-merged-branch`](.cursor/rules/recover-from-merged-branch.mdc) | on request | Stash-and-restart when a branch's PR already merged |
| [`greed-architecture`](.cursor/rules/greed-architecture.mdc) | globs | Content model, BFF, CMS, seed, CDK, verification |

Human-facing docs: [`README.md`](README.md) and [`docs/`](docs/). The sibling repo `../mycota`
publishes the `@bubltec/mycota-*` packages this app consumes.
