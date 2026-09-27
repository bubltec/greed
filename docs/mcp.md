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
| `add_perspective` | Attributed view: critic, defender, official, legal, expert, editorial |
| `link_topics` / `unlink_topics` | Typed links; provenance defaults to `inferred` |
| `list_drafts` | The review queue: everything not yet published |
| `publish_topic` | Publish a topic with its drafts (sources, perspectives, links to live topics) |
| `set_status` | Publish or unpublish individual items |

**Everything the connector creates is a draft.** Nothing it writes is public until it is
published, either by you in the editor or by Claude when you ask it to (`publish_topic`,
`set_status`; the server instructions tell Claude not to publish unprompted).

There is deliberately no tool to delete a topic or a reference; do that in the web editor.
Writes go through `ContentService` with the same validation as the CMS, and are attributed
as `<your email> (mcp)` so the log shows which channel made a change.

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
