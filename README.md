# Session Browser

Browse and read your local AI coding sessions from **Claude Code**, **Codex**, **OpenCode**, **Grok**, **Antigravity** and **Cursor**, and see where your tokens went.

Everything runs in the visitor's browser. People pick (or drag in) their own session folders, and the files are parsed on their device in Web Workers. The deployed site is a static page with no backend, and nothing is sent anywhere unless the visitor uses **Send to Worklog** (below), which sends a short, redacted description of the sessions they choose to their own Worklog account. Fonts are self-hosted. The only outside request is a download of the public price list from [models.dev](https://models.dev/api.json) (cached for six hours; a copy bundled at build time is the fallback), and nothing about your sessions is sent with it.

## What it reads

| Tool | Folder to pick | Contents | Token data |
|---|---|---|---|
| Claude Code | `~/.claude` | `projects/<project>/<session>.jsonl`, plus `<session>/subagents/*.jsonl`; `stats-cache.json` and `settings.json` for older usage (below) | yes |
| Codex | `~/.codex` | `sessions/**/rollout-*.jsonl`, `archived_sessions/*.jsonl.zst`, `session_index.jsonl` (titles), `state_<n>.sqlite` (older usage, below) | yes |
| OpenCode | `~/.local/share/opencode` | `opencode.db` (SQLite) and `opencode.db-wal` | yes |
| Grok | `~/.grok` | `sessions/<cwd>/<id>/{chat_history.jsonl, summary.json, usage.json}` | newer sessions (`usage.json`) |
| Antigravity | `~/.gemini/antigravity` | `conversations/<id>.db` (SQLite with protobuf steps), `conversation_summaries.db`; older `conversations/<id>.pb` are only counted | yes (inferred, see below) |
| Cursor | `~/.cursor` | `projects/<project>/agent-transcripts/<id>/<id>.jsonl`, plus `<id>/subagents/*.jsonl` | estimated (see below) |

Extra Claude Code accounts kept in their own config folder (e.g. `~/.claude-work` via `CLAUDE_CONFIG_DIR`) are read too; their sessions show under Claude Code, and each folder's `stats-cache.json` is matched only against that folder's transcripts.

On Windows, `~` is `%USERPROFILE%`. The folder pickers start in Documents, one level below these folders on a default install.

Limits:

- **Antigravity** has no published schema. Its protobuf field numbers were mapped by hand (`src/lib/parsers/antigravity.ts`), so its token counts are a best-effort reading.
- **Cursor** transcripts don't record tool output, token usage or per-message times. Cursor's older in-editor chat history lives in one multi-GB database, which is too large for a browser tab, so it isn't read.
- **Estimated tokens**: when a tool records no usage (Cursor, older Grok sessions), tokens are counted from the transcript with the o200k tokenizer (`src/lib/estimate.ts`). Each model call is counted as re-sending the conversation so far (new text as input, the rest as cache reads), with the context compacted when it passes 200k. System prompts, tool definitions and Cursor's unrecorded tool output aren't included, and no model is recorded, so there's no cost. These numbers show with a `~`.
- **Older usage** (`src/lib/history.ts`): some agents delete their session files but keep running totals, and those are added to the totals without counting anything twice.
  - *Claude Code* deletes transcripts after `cleanupPeriodDays` (30 by default, in `~/.claude/settings.json`). `stats-cache.json` keeps per-model totals and per-day tokens up to its `lastComputedDate` (refreshed when `/stats` runs). For each model, the cache's total minus what the remaining transcripts hold up to that day is added, spread over days by what the cache recorded per day (and by message counts where it has no per-day tokens). Its input/output/cache split is estimated from that model's all-time mix. The days between the cache's last day and the oldest remaining transcript can't be counted, and the overview says so. A response copied into several transcripts (resumed or forked sessions) is counted once.
  - *Codex* lists every thread with its total in `state_<n>.sqlite`. Threads whose rollout file is gone are added with that total, split like the same model's other sessions.
  - *Cursor* keeps no token usage locally, and older *Antigravity* conversations (`.pb`) are encrypted; the overview says so rather than counting them as 0. *OpenCode* keeps everything in its database, and *Grok* sessions without `usage.json` are estimated.
- **Codex** usage: `input_tokens` already includes cached input and `output_tokens` includes reasoning; each turn's tokens go to the model in use for that turn.
- **Grok** cost is converted from xAI's "USD ticks" at 10¹⁰ ticks per dollar.

## Features

- Overview: total tokens and estimated cost (models.dev list prices), per tool, per model and per day; largest sessions. A date range (7, 30, 90 days, 12 months or all time) applies to the list and every page.
- **Share**: turns the overview into a 1200×675 PNG (totals, daily chart, tools, top models) to download or copy. It shows totals only: no titles, prompts or folders.
- **Tools** page: every tool your agents called, ranked, with sessions, which apps used it, failure rate and average time; calls by kind; the shell programs run most; MCP servers.
- **Time** page: active hours (gaps over 30 minutes between messages left out), active days and streaks, a weekday × hour heatmap, time per day, project and tool, and the longest sessions by active time. Tools that don't record message times (Cursor) are left out.
- Sessions list with tool filters, sort, folder filter, and full-text search inside conversations
- Conversation reader: chat-style messages, with tool calls shown as compact steps that expand into the command, a diff for edits, parameters and output. Thinking and injected context can be shown or hidden.
- **Remove sensitive info**: hides API keys and tokens (OpenAI, Anthropic, GitHub, AWS, Google, Stripe, Slack, Telegram, JWTs and more), private keys, passwords in URLs, secret-looking `KEY=value` and JSON fields, `.env` and other credential-file contents read or written by tools, emails, and your username, which is learned from home-folder paths and hidden wherever it appears. It's pattern-based: a strong safety net, not a guarantee.
- **Export**, for one session or the whole filtered list:
  - *Normal*: Markdown transcript or full JSON; redaction optional
  - *AI training data*: JSONL in the standard chat fine-tuning shape (`{"messages":[…], "metadata":{…}}` with `tool_calls` and `tool` messages). Redaction is always on; injected system context is dropped; tool calls without a recorded result are left out; long tool output is capped.
- **Send to Worklog**: adds one session, or the whole filtered list, to your timeline on [Worklog](https://worklog.pro.et) with your own API key. Off until you use it, and nothing is sent until you click Send after reviewing a preview of every entry.
  - Each entry has: a title, a 1–3 sentence summary of the first prompt, the project folder's name (not its path), the agent and model names, the start time and the active time (gaps of more than 30 minutes between messages are left out).
  - Never sent: conversation text, tool calls or output, code, file paths, links, branch names, tokens or cost. Redaction always runs first.
  - Each entry carries `external_id` `session-browser:<session id>`, so sending a session again updates its entry instead of adding a duplicate. Subagent sessions are left out of list sends, since they're part of their parent's work.
  - Sent sessions are marked in the list and in the conversation view ("In Worklog"), and turn amber when the session has continued since it was sent. These marks are kept in this browser only.
  - It calls Worklog's MCP endpoint (`https://worklog.pro.et/api/mcp`, `log_work` tool) from the browser, with the key in an `Authorization` header. The key is kept in memory, or in this browser's localStorage if you tick "Remember on this device".
- **Several computers**: under Sources, **Save this computer's file** downloads its totals (per-session tokens, models, dates, tool and time stats, titles and folders; no prompts, conversations or file paths). **Import another computer** on any of your computers adds that file, and the overview, Tools and Time pages, the share image and the list then show all of them combined. Imported sessions carry the computer's name and can't be opened, since the conversation stays where it was recorded. A session found on two computers is counted once, a newer file from the same computer replaces the older one, and imported files stay in this browser (`src/lib/devices.ts`).
- Picked folders are remembered in the browser, and the last sync is shown right away on return. **Sync** reads them again (Chromium may ask for one click to re-allow access). Other browsers can drag folders in.
- With **Remove sensitive info** on, a session shows how many items were hidden and a list of them, grouped by type, with a jump to where each appears.
- Parsed summaries are cached in IndexedDB, so unchanged files aren't re-read.

## Code map

- `src/lib/parsers/`: one parser per tool, plus `sqlite-wal.ts` (folds a WAL file into the db image), `protobuf.ts` (schema-less reader) and `common.ts`
- `src/lib/worker/`: Web Worker pool that receives `File`s and returns summaries or messages
- `src/lib/sources.ts`: walks picked or dropped folders, visiting only the subfolders that can hold sessions
- `src/lib/store.svelte.ts`: app state, cache, remembered folders
- `src/lib/devices.ts`, `src/lib/components/Devices.svelte`: device files, for combining a person's computers
- `src/lib/redact.ts`, `src/lib/export.ts`, `src/lib/toolinfo.ts`: redaction, export formats, tool-call presentation
- `src/lib/stats.ts`: per-session tool and time statistics, worked out in the parse worker and cached with each summary
- `src/lib/sharecard.ts`: draws the shareable PNG on a canvas
- `src/lib/worklog.ts`, `src/lib/components/WorklogDialog.svelte`: Send to Worklog (entry mapping, MCP client, dialog)
- `prototype/`: the first version, a stdlib-only Python server (`python prototype/server.py`); not part of the site

## Develop

```bash
npm install
npm run dev
```

```bash
npm test          # parser, redaction, export and Worklog tests; parser tests also run against your own session folders if present
npm run check     # type check
```

## Deploy to Vercel

Push the repo to GitHub and import it at vercel.com/new, or run:

```bash
npx vercel
```
