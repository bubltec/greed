# Data model

Defined in `packages/domain/src/entities.ts`.

| Entity | Key fields | Notes |
| --- | --- | --- |
| Topic | `id` (slug), `kind`, `title`, `summary`, `sections[]`, `disputed`, `notes`, `tags[]` | `kind`: case, person, organization, synthesis, thesis |
| Section | `id`, `label`, `points[]` | A point is `{ text, refIds[] }` |
| Reference | `id`, `topicId`, `label`, `url?`, `publishedOn?`, `excerpt?`, `note?` | Belongs to exactly one topic |
| Perspective | `id`, `topicId`, `stance`, `holder`, `body`, `refIds[]` | May cite only its topic's references |
| Relation | `id`, `fromId`, `toId`, `kind`, `note`, `provenance` | Directional only for `cause-effect` |

All rows carry `createdAt`, `updatedAt`, `updatedBy`. Text fields are plain text: URLs and
`[[topic-id]]` are turned into links at render time; no HTML is ever stored or rendered.

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
