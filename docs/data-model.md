# Data model

Defined in `packages/domain/src/entities.ts`.

| Entity | Key fields | Notes |
| --- | --- | --- |
| Topic | `id` (slug), `kind`, `title`, `summary`, `sections[]`, `disputed`, `notes`, `tags[]` | `kind`: case, person, organization, synthesis, thesis. `disputed` is a one-sentence closing note on the main denial or open question |
| Section | `id`, `label`, `points[]` | A point is `{ text, refIds[] }` |
| Reference | `id`, `topicId`, `label`, `url?`, `publishedOn?`, `excerpt?`, `note?` | Belongs to exactly one topic |
| Perspective | `id`, `topicId`, `stance`, `holder`, `body`, `refIds[]` | May cite only its topic's references |
| Relation | `id`, `fromId`, `toId`, `kind`, `note`, `provenance` | Directional only for `cause-effect` |

All rows carry `createdAt`, `updatedAt`, `updatedBy`, and a publishing `status`
(`draft` | `published`, plus `publishedAt`). Text fields are plain text: URLs and
`[[topic-id]]` are turned into links at render time; no HTML is ever stored or rendered.

## Publishing

Public reads (`/api/topics`, `/api/topics/:id`, `/api/graph`, `/api/activity`, `/api/export`) return
published content only: a reference, perspective or link also needs its topic(s) published, and
points never cite a hidden reference (`publishedOnly` in `packages/domain`). A signed-in editor
adding `?preview=1` gets drafts too; for anyone else the flag is ignored.

Defaults: new topics are drafts. A new reference, perspective or link takes its topic's status
unless one is given, so a source added in the editor to a live topic goes live, while the Claude
connector always writes drafts. `POST /api/topics/:id/publish` publishes a topic with its drafts;
`POST /api/status` sets any mix of items; `GET /api/drafts` is the review queue. Rows imported
before publishing existed have no `status` and count as published.

## Pages

The home intro and the About page are editable too (Editors → Pages, or the connector's
`update_page`). Each page keeps a working copy and a published copy: saving changes the working
copy, publishing copies it live, so readers never see a half-finished edit. A page that has never
been saved shows its built-in default (`DEFAULT_PAGES` in `packages/domain/src/pages.ts`).
Bodies are a small Markdown subset rendered as React text, never HTML. Stored as
`PAGE#<id> / PAGE` rows in the content table.

## Environments

Code moves dev → prod; content does not. Each environment has its own tables, and prod is the
source of truth: real entries are written there (as drafts, then published). Dev is a sandbox
for code changes. To test against real data, copy prod into dev (one-way, replaces dev's content):

```bash
pnpm data:refresh-dev          # dry run: shows counts
pnpm data:refresh-dev --yes    # replace greed-dev-content with a copy of greed-prod-content
```

## DynamoDB (single table `greed-{env}-content`)

| PK | SK | Row |
| --- | --- | --- |
| `TOPIC#<id>` | `TOPIC` | topic |
| `TOPIC#<id>` | `REF#<refId>` | reference |
| `TOPIC#<id>` | `PERSP#<pId>` | perspective |
| `REL#<id>` | `REL` | relation |

The BFF reads the whole table with one paginated Scan and caches the indexed result for 15s
(`CONTENT_CACHE_TTL_MS`). At hundreds of rows this is cheaper and simpler than per-view queries.
Deleting a topic queries its partition and removes relations that touch it.

Users live in `greed-{env}-users`, owned by `@bubltec/mycota-auth`.

## Seed import

`data/seed/source/` is the export of the original artifact's database (`items/`, `relations/`).
`transform.ts` turns each item's trailing citation groups, e.g.
`"… happened. (Washington Post (https://…); NPR)"`, into References linked from the point, keeps
`disputed` and `notes`, and maps the old relation id suffixes (`same-org`, `shared-framing`,
`implementation-of`, …) onto relation kinds. Ids are hashes of the source, so re-running is
idempotent, and every write is conditional on the row not existing, so the seed never
overwrites CMS edits.
