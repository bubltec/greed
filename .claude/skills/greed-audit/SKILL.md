---
name: greed-audit
description: Audit GREED entries in bulk for encoding/escaping damage, structural problems and stale claims, and apply safe repairs. Use when asked to audit, clean up, or check many entries (or all entries) — never audit entry-by-entry with get_topic.
---

# Auditing GREED content

The server does the scanning; you do the judging. `audit_content` reads the
whole record in one call and returns one compact line per issue. Reading
entries one at a time with `get_topic` to look for problems wastes the
context window and will not finish — do not do it.

## Workflow

1. **Scope.** If the user named entries, pass their ids as `ids`. If they
   said "all", omit `ids`. Narrow with `categories` (`text`, `structure`,
   `staleness`) or `codes` when they asked for one kind of problem.
2. **Dry run.** Call `audit_content` and page with `offset`/`nextOffset`
   (default 50 lines per call) until `nextOffset` is null. Report the
   headline first: how many entries were scanned, the total, and the
   per-code counts — then the lines, grouped by code. Each line is
   `topic | type:id | field | CODE confidence | before → after`.
3. **Fast fix.** Lines whose code has a `→ after` repair and `high`
   confidence are safe to apply in bulk. When the user asked for cleanup
   (not just a report), call `apply_audit_fixes` with the same scope —
   it recomputes repairs server-side, never publishes or unpublishes
   anything, and returns one line per repaired field. Batch with `limit`
   (default 50) and repeat until `remainingFixable` is 0.
4. **Re-audit.** Run `audit_content` once more on the same scope and show
   what remains. What remains needs a human or a targeted fix, below.
5. **Never invent repairs.** Do not hand-write replacement text for a
   finding and push it through `update_*` unless the user approved that
   exact wording. `apply_audit_fixes` exists so repairs are deterministic.

## Attachments and links

- `audit_content` also covers attachments: caption and alt text are repaired like
  prose; **extracted text is never auto-fixed** (it must match the file), so a
  finding there means compare it with the archived file and fix it with
  `update_attachment` only with wording the user approved. A draft attachment
  on a published topic shows up as `PUBLISHED_WITH_DRAFT_CHILD`.
- `find_gaps` lists scans still needing text (`pending` or `failed`); run
  `extract_attachment_text` on them. A multi-page PDF may answer "still
  reading": call again after a minute. OCR text is a machine reading, so say so
  when you quote it.
- `audit_links` checks whether cited URLs still work. It requests only URLs
  already on references, pages ~25 URLs per call (`offset`/`nextOffset`), and
  reports lines like `topic | reference:id | CODE confidence | detail | url`.
  `LINK_BROKEN` (404/410 or the domain is gone) and `LINK_MOVED … → new` are
  worth acting on: fix a moved link with `update_reference` after opening the
  new address to confirm it is the same page. `LINK_BLOCKED` means the site
  refuses automated checks, not that the link is dead: leave it or ask the user.
  `LINK_PAYWALLED` flags a cited paywalled outlet; `LINK_UNCHECKED` is a URL it
  will not request (private address, odd port). It never edits anything.

## What the codes mean

- **Text, auto-fixable (`high`):** `ENC_HTML_ENTITY`, `ENC_DOUBLE`,
  `ENC_PERCENT`, `ESC_QUOTE`, `ESC_NEWLINE`, `ESC_UNICODE`, `MOJIBAKE`,
  `HTML_TAG`, `CTRL_CHAR`, `DOUBLE_SPACE`. These are encoding/escaping
  damage in plain-text fields; URLs are never touched.
- **Text, report-only:** `QUOTE_MIX` (straight and curly quotes in one
  field — may be quoted material; ask before normalizing) and
  `UNSUPPORTED_MARKUP` (markup prose fields can't render; only `**bold**`,
  `[text](url)`, `[[topic-id]]` are supported). Fix these one at a time
  with the matching `update_*` tool, showing the user the wording first.
- **Structure (never auto-fixed):** `POINT_NO_CITATION` (research and add
  a reference, or ask), `REF_ORPHAN` (cite it from a point/perspective or
  ask whether to delete the draft), `PERSPECTIVE_NEAR_DUP` (show both;
  merging is the user's call), `PUBLISHED_WITH_DRAFT_CHILD` (the child is
  invisible to readers; ask whether to publish it with `set_status` or
  leave it in the review queue).
- **Staleness (never auto-fixed):** `STALE_DATE` — an "as of" date or
  pending/trial language older than `staleDays` (default 90; pass it when
  the user gives a horizon). Verify against a fresh source with
  `research_topic` or `search_documents` before suggesting an update;
  a stale flag is a prompt to check, not proof the text is wrong.

## Rules

- Everything stays in its current status: fixes never publish. Only call
  `publish_topic`/`set_status` when the user explicitly asks.
- Present large results as counts plus lines, not prose summaries of each
  entry. If the user only wants one topic fixed, scope with `ids` rather
  than auditing everything and filtering yourself.
- If `apply_audit_fixes` reports skips (a field changed since the audit),
  re-run the dry run for that scope instead of retrying blindly.
