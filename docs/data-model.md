# Data model

Defined in `packages/domain/src/entities.ts`.

| Entity | Key fields | Notes |
| --- | --- | --- |
| Topic | `id` (slug), `kind`, `title`, `summary`, `sections[]`, `disputed`, `notes`, `tags[]` | `kind`: case, person, organization, synthesis, thesis. `disputed` is a one-sentence closing note on the main denial or open question |
| Section | `id`, `label`, `points[]` | A point is `{ text, refIds[] }` |
| Reference | `id`, `topicId`, `label`, `url?`, `publishedOn?`, `excerpt?`, `note?`, `viralClaim?`, `verdict?` | Belongs to exactly one topic. A circulating claim (a viral screenshot or post) is a reference with `viralClaim` and a one-line `verdict`; it is cited and answered, never embedded or attached |
| Attachment | `id`, `topicId`, `referenceId`, `kind`, `caption`, `altText`, `sourceUrl?`, `capturedAt`, `sha256`, `mimeType`, `bytes`, `extractedText?`, `extractionStatus` | Archived evidence (`kind`: primary-document, chart, scan) for one reference of its topic; the points that cite that reference are the points it supports. Created only by the server when it archives a file, so the hash, type and size are never caller-supplied. The file lives in the archive under `attachments/<sha256>` |
| Perspective | `id`, `topicId`, `stance`, `holder`, `body`, `refIds[]` | May cite only its topic's references |
| Relation | `id`, `fromId`, `toId`, `kind`, `note`, `provenance` | Directional only for `cause-effect` |
| Outlet | `id`, `name`, `domain`, `paywall`, `accuracy`, `bias`, `oneSided`, `factual`, `note?` | A publication in the trust catalog, not a citation. `paywall` is a hard avoid. Ratings are `high` \| `mixed` \| `low`; for bias, low ranks first |

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
connector always writes drafts. `POST /api/topics/:id/publish` publishes a topic with its drafts
(`includeLinked: true` also publishes draft topics it links to, and their sources and perspectives);
`POST /api/status` sets any mix of items; `GET /api/drafts` is the review queue. Rows imported
before publishing existed have no `status` and count as published.

## Evidence archive

`attach_document` (connector) archives a PDF, image or text file from a public https URL as a draft
attachment. This is the only place the server fetches a caller-chosen address, so it is narrow:
only hosts a document provider owns (CourtListener, Federal Register, GovInfo) or a **published,
non-paywalled outlet** in the catalog (add an outlet for `justice.gov` or any other primary source
first); every redirect hop is re-checked against the same list; 4 MB maximum (a served file has to
fit in one 6 MB Lambda response once base64-encoded, which adds a third; `lambda.ts` lists the
binary types so a served PDF is not corrupted); PDF, PNG, JPEG, WebP, GIF and plain text only. The
file is stored under its SHA-256, so the same bytes are stored once and a row can never name another file.

Storage is a private, versioned, TLS-only S3 bucket (`ArchiveBucket` in the `Data` stack, retained in
prod). Objects are written once (`IfNoneMatch: *`); the API's role can read and put but not delete.
Readers never get a bucket URL: files go through the BFF. The Lambda finds the bucket through
`ARCHIVE_BUCKET`, and OCR through `ARCHIVE_OCR=textract`; without them the stage is "not configured".

Archived files are served at `GET /api/attachments/:id/file`: published attachments only (an editor's
`?preview=1` also gets drafts), with the stored type, `nosniff` and a sandboxing CSP. Images are shown
inline on the topic page's Evidence section; a PDF is a download, because Chrome's viewer refuses a
response with a sandbox CSP.

Extracted text: plain text is read on archive. A PNG, JPEG or one-page PDF goes to Amazon Textract
(synchronous `DetectDocumentText`). A longer PDF is read as a Textract job over the archived object;
the job's idempotency token is the file's hash, so calling `extract_attachment_text` again joins the
same job instead of starting another. One call waits about 12 s, then leaves the file `pending`
for a retry. A job that fails or reads only some pages is `failed`, never stored as complete. The text
is a machine reading, so check it against the file before quoting it. Anything Textract cannot read
(WebP, GIF, a blank scan) is left `pending`, and an OCR error leaves it `failed`; the file is archived either way.
`find_gaps` lists both as `attachmentsNeedingText`. `extract_attachment_text` retries from the
archived copy (no fetch), and a person can always save an exact transcription with
`update_attachment`. Deleting a reference removes its attachment rows; the archived file is kept.
**A stage with no archive wired in refuses `attach_document`** with "not configured" rather than
storing nowhere.

## Pages

The home intro and the About page are editable too (Editors → Pages, or the connector's
`update_page`). Each page keeps a working copy and a published copy: saving changes the working
copy, publishing copies it live, so readers never see a half-finished edit. A page that has never
been saved shows its built-in default (`DEFAULT_PAGES` in `packages/domain/src/pages.ts`).
Bodies are a small Markdown subset rendered as React text, never HTML: paragraphs, headings, lists, bold, links (including `mailto:`), and blockquotes. A `>` blockquote is a note box; `> [!info]`, `> [!success]`, `> [!warn]` and `> [!error]` set its tone. Stored as
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
| `TOPIC#<id>` | `ATT#<attId>` | attachment |
| `REL#<id>` | `REL` | relation |
| `OUTLET#<id>` | `OUTLET` | outlet |

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
