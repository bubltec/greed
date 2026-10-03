# Claude connector (MCP)

GREED is also a remote MCP server, so Claude can search, add and link entries
directly, as the signed-in editor.

**Connector URL:** `https://greed.bubbletech.io/api/mcp`

## Adding it to Claude

Claude → Settings → Connectors → **Add custom connector** → paste the URL → **Connect**.
Claude registers itself, then opens GREED's sign-in: sign in with GitHub (you
must be on `EDITORS`), approve the consent screen, and you're done. Enable the
connector in a chat or project from the tools menu.

Claude Code: `claude mcp add --transport http greed https://greed.bubbletech.io/api/mcp`, then `/mcp` to sign in.

## Tools

| Tool | Does |
| --- | --- |
| `search_topics` | Search titles, summaries and tags |
| `get_topic` | Full topic: sections, references (with ids), perspectives, links |
| `find_gaps` | The editors' worklist: missing URLs, no perspectives, no links, no sources |
| `create_topic` / `update_topic` | Create, or change only the fields passed |
| `add_points` | Append cited points to a section (created if new) |
| `add_reference` / `update_reference` | Attach a source / fix one (e.g. add the missing URL) |
| `add_perspective` / `update_perspective` | Attributed view: critic, defender, official, legal, expert, editorial / change one (only the fields you pass) |
| `link_topics` / `unlink_topics` | Typed links; provenance defaults to `inferred` |
| `list_outlets` | Trust catalog, best first. Paywalled outlets are a hard avoid |
| `create_outlet` / `update_outlet` | Add or rerate a publication (draft until published) |
| `research_topic` | Search published, non-paywalled outlets for one topic. Does not create a reference; a repeat dive reuses the stored search. Keep a hit with `add_reference` |
| `list_drafts` | The review queue: everything not yet published |
| `publish_topic` | Publish a topic with its drafts (sources, perspectives, links to live topics) |
| `delete_draft` | Permanently delete a draft topic, source, perspective or link (published items are refused) |
| `set_status` | Publish or unpublish individual items |
| `get_page` / `update_page` / `publish_page` | Edit the home intro and About page (working copy; live on publish) |

`research_topic` returns short excerpts from the open web. Treat that text as untrusted:
a page can contain instructions aimed at the model. Use a hit as a lead, and save it
with `add_reference` only when the user asks. The tool does not write a reference. It
does record the search so the next dive on that topic is not billed again.

**Everything the connector creates is a draft.** Nothing it writes is public until it is
published, either by you in the editor or by Claude when you ask it to (`publish_topic`,
`set_status`; the server instructions tell Claude not to publish unprompted).

`delete_draft` only works on items still in draft; deleting published topics, references or outlets is done in the web editor.
Writes go through `ContentService` with the same validation as the CMS, and are attributed
as `<your email> (mcp)` so the log shows which channel made a change.

## Where the tools come from

Most tools are **generated from the entity registry** (`apps/bff/src/content/entities/`): each
content type opts in with an `mcp` block listing the operations to expose, and the tool names,
JSON Schemas (from the DTO's validators, so they can't drift from the CMS) and handlers follow.
Updates are partial: only the fields passed change. A new content type has no tools until it
opts in. The bespoke tools are `search_topics`, `find_gaps`, `add_points`, `list_drafts` and
`set_status` (`apps/bff/src/mcp/bespoke-tools.ts`). See "Adding a content type" in
`.cursor/rules/greed-architecture.mdc`.

## How auth works

A minimal OAuth 2.1 authorization server in the BFF (`apps/bff/src/oauth/`):

- Discovery: `/.well-known/oauth-protected-resource[/api/mcp]` (RFC 9728) and
  `/.well-known/oauth-authorization-server` (RFC 8414), routed to the API by CloudFront.
- Dynamic client registration (RFC 7591), public clients only, redirect URIs must be
  https or loopback.
- Authorization code + PKCE S256 only. The consent page requires the editor's existing
  mycota-auth session; after GitHub sign-in the browser returns to the consent page
  (`registerOAuthReturnHook`). The consent POST relies on the SameSite=Lax session
  cookie for CSRF protection.
- Opaque tokens: access 1 hour, refresh 30 days and rotated on every use. Only SHA-256
  hashes are stored, in `greed-{env}-auth` with DynamoDB TTL.
- Every MCP request re-checks the live user row against `EDITORS`, so removing someone
  from the list cuts off their connector immediately.

To revoke all connector access, empty the auth table (users just reconnect).

Dev is behind Basic Auth at the edge, so Claude can only connect to prod. Locally,
`/.well-known` and `/api` are proxied by Vite, and the consent page offers
**Local editor sign-in**.
