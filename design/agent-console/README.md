# HelioDX — Agent console handoff

Scope: the **agent console** only — the side panel on the worklist and the dedicated console page. Everything else in HelioDX (worklist, review, sign, share, upload, welcome) is out of scope for this package and lives in the full design handoff.

## How to use this with Claude Code

1. Copy this folder into the repo as `design/agent-console/`.
2. Add to the root `CLAUDE.md`: `For agent console work, read design/agent-console/CLAUDE.md first.`
3. Ask for one surface at a time: *"Implement the console side panel from design/agent-console/SPEC.md §2 to match mockups/worklist-console.html"*, then *"Implement the console page from §3 to match mockups/console.html"*.

## What is in here

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Working rules for Claude Code on these two screens. |
| `SPEC.md` | The console spec: data (manifest, trace, stats), the side panel, the page, live behaviour, fixtures, acceptance criteria. |
| `components.md` | Reference markup and CSS for every component the console uses. |
| `types.ts` | TypeScript contracts: `TraceStep`, `ToolCall`, `RunManifest`, `AgentDef`, `ToolDef`, `RunStats`, `ConsoleCase`. Type-checks under `--strict`. |
| `tokens.css` / `tokens.json` | The HelioDX tokens (shared with the rest of the app). |
| `mockups/worklist-console.html` | Worklist with the console side panel open. |
| `mockups/console.html` | Dedicated console page: Agents & tools panel, run header, statistics row, trace table with one step expanded. |
| `assets/` | Logo lockup and the four thumbnails the worklist mockup uses. |

Both mockups are standalone HTML at 1440 px and fluid down to phone width. Open them in a browser; they are the visual source of truth. Palette: black and white; green only for success, red only for failure.

## Provenance

Step names, timings and token counts come from the existing HelioDX console (case AI2Y7), transposed to the 14:27 timeline the rest of the design uses. Agent roles and tool names are a reconstruction in the manifest's voice — the UI renders whatever the run manifest lists.
