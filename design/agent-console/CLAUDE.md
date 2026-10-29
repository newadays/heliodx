# HelioDX agent console — rules for Claude Code

This folder is the design source of truth for two surfaces: the **console side panel** on the worklist and the **dedicated console page**. Read this, then `SPEC.md`, then open the matching mockup in `mockups/`.

## Order of authority

1. `SPEC.md` — behaviour, states, copy, acceptance criteria. Where a mockup and the spec disagree on behaviour, the spec wins.
2. `mockups/*.html` — layout, spacing, colour, type. Copy exact values from the mockup CSS; do not round to a framework default.
3. `tokens.css` / `tokens.json` — every colour, radius, font and size. Add missing values to both files in the same change and say so.
4. `components.md` — one reference implementation per component. Build shared components first; never fork a second chip, tag or tile.

## Non-negotiables

- **Both surfaces render the same data.** The side panel and the page read one `trace[]`, one `RunManifest` and one `RunStats` per run; the panel is a compact projection of the page, never a second model. The four panel tiles are the first four of the page's seven.
- **Everything comes from the manifest and the trace.** Agents, tools, counts, stats: nothing hard-coded. Adding a tool server-side must appear without a UI change.
- **Live without reload.** Running cases stream steps in; stats tiles and the "running now" indicator update as steps complete. Reconnect with backoff; never clear what is already shown.
- **Colour is black and white plus two signals.** Green only for success (ran, passed, live), red only for failure (checks failed > 0, escalated, failed run). The number carries the meaning; colour reinforces it.
- **No `window.alert`, no `window.open`.** Exports download via Blob + `<a download>`. Confirmations are inline.
- **Real controls, inline SVG icons, 44 px targets** (36 px only inside the panel header and the dark viewer). Keyboard: `Esc` closes the panel; expanded trace rows are `<button aria-expanded>`.
- **Spelling:** HelioDX. Case IDs carry their source prefix (`S-AI2Y7`, `U-7K2P`) everywhere.

## How to work

- Build the page first (it holds every component), then the panel from the same components.
- Use the fixtures in `SPEC.md` §6 so both surfaces look like the mockups before the backend is wired; leave `TODO(backend)` with the exact contract from `types.ts` where an endpoint is missing.
- Verify at 1440 and 390 wide, with the panel open and closed, with a running case and with none.
