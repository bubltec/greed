# greed

**greed.bubbletech.io**: a sourced, cross-linked record of power, money and oversight, and a
small CMS for adding to it.

This started as one long Claude document ("Documented Cases: Power, Money & Oversight"), was
split into an items-and-relations index, and now lives here as its own site. Every entry
(a **topic**) carries:

- **Sources.** Each point is footnoted to a reference. Sources that still need a URL are flagged.
- **A closing note** (one sentence) on the main denial or open question, where there is one.
- **Perspectives.** Attributed views: critic, defender, official, legal, expert, editorial.
- **Connections.** Typed links to other topics (same actor, same context, shared mechanism,
  cause → effect, contradicts, related), each marked sourced, inferred, or editor-added.

Everything has a **draft / published** status. The public site shows published content;
editors see drafts with `?preview=1` and review them on the Editors page. See
[docs/data-model.md](docs/data-model.md#publishing).

Built on [mycota](../mycota) the same way [badthingsforpets](../badthingsforpets) is: NestJS BFF
on one Lambda, React on S3 + CloudFront, DynamoDB, `@bubltec/mycota-auth` for sign-in.

## Layout

```
apps/bff          NestJS 12 + Fastify 5 API (one Lambda in AWS, plain Node locally)
apps/web          Reader + /admin CMS (Vite 8, React 19, Tailwind 4, NES Mega Man palette)
packages/domain   Content model, entity table, views, generic ContentStore port + in-memory fake, citation parser
packages/config   Shared tsconfig presets
data/seed         Import of the original artifact export (59 topics, 345 sources, 99 links)
infra/cdk         GreedDns, GreedCi, GreedDev / GreedProd (Data, Api, Web)
docs/             Data model, deployment
```

## Run locally

```bash
nvm use                 # Node 26
pnpm install
cp .env.example .env
pnpm db:up              # DynamoDB Local on :8000
pnpm --filter @greed/bff dev      # API on :3002 (creates local tables on boot)
pnpm seed:local                   # in another terminal, once the API is up (builds domain first)
pnpm --filter @greed/web dev      # http://localhost:5175
```

Open <http://localhost:5175/admin> and use **Local editor sign-in** to edit. The Editors page
opens on a worklist: sources missing links, topics with no perspectives, no connections, or no
sources.

## Check

```bash
pnpm lint && pnpm turbo run typecheck build && pnpm turbo run test
```

## API

Public, unauthenticated: `GET /api/topics`, `/api/topics/:id`, `/api/graph`, `/api/activity`,
`/api/export` (the whole dataset as JSON), `/api/session`.

Editor-only (signed in and on `EDITORS`): `POST/PUT/DELETE /api/topics[/:id]`,
`/api/topics/:id/references[/:refId]`, `/api/topics/:id/perspectives[/:pid]`,
`/api/relations[/:rid]`. Every write returns the refreshed topic view.

## Claude connector

`https://greed.bubbletech.io/api/mcp` is a remote MCP server: add it in Claude as a custom
connector and Claude can search, add, cite and link entries as you. See [docs/mcp.md](docs/mcp.md).

## Deploy

See [docs/deploy.md](docs/deploy.md) for the one-time setup (DNS delegation from
`bubbletech.io`, GitHub repo + environments, SSM secrets, GitHub OAuth app, prod seed). After
that, merging to `main` deploys dev automatically and prod after approval.
