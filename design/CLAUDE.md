# HelioDX UI — rules for Claude Code

This folder is the design source of truth for the HelioDX web app and landing page. Read this file before any UI work, then the relevant section of `SPEC.md`, then open the matching mockup in `mockups/`.

## Order of authority

1. `SPEC.md` — behaviour, states, copy and acceptance criteria. If the mockup and the spec disagree on behaviour, the spec wins.
2. `mockups/*.html` — visual truth: layout, spacing, colour, type. Copy exact values from the mockup's CSS; do not round them to a framework default.
3. `tokens.css` / `tokens.json` — the palette and scale. Every colour, radius and font in the app must come from here. If a value you need is missing, add it to both token files in the same change and say so.
4. `components.md` — one reference implementation per component. Build the shared component first, then the screens from it; never fork a second button or chip.

## Non-negotiables (these fix real bugs in the current build)

- **No `window.alert`, `confirm` or `prompt`.** Confirmations are inline; results are toasts (`components.md` → Toast). Signing shows an inline status strip, not an alert.
- **No `window.open` for files.** PDFs download via a Blob + `<a download>`; nothing opens in a new tab that a pop-up blocker can eat.
- **No icon font.** Icons are inline SVG, stroke 1.75, `aria-hidden="true"` unless they stand alone (then `role="img" aria-label`). The ☐ glyphs in the current build are a missing icon font — remove it.
- **Never crop the film.** X-ray images use `object-fit: contain` inside a dark viewer box with the image's own aspect ratio; thumbnails may use `cover` at ≤ 64 px only.
- **No blocking spinners between steps.** Analysis streams findings as they are detected; the report and patient note draft in the background; every wait shows what is happening, elapsed time and the expected time.
- **Real controls.** `<button>`, `<a href>`, `<input>` + `<label>`; no `onClick` on a `div`. Hit targets ≥ 44 px. Text contrast ≥ 4.5:1 (3:1 at ≥ 24 px). Keyboard shortcuts in `SPEC.md` §5.3 must work.
- **Colour is black and white, plus two signals.** Green (`--hx-green`) only for success — accepted, done, ready, signed, live. Red (`--hx-red`) only for failure or attention — needs attention, reject, errors, flagged regions. Primary actions, selection and progress are black. No other hue anywhere in the app (`SPEC.md` §2.3). The environment chip is an outline, not a colour.
- **Name and brand.** The product is spelled **HelioDX**. The logo is `assets/heliodx-lockup.png` (dark tile, "helio." wordmark) at 34 px high in the app header; the environment chip "Research Beta · Not ready for clinical use" stays in the header on every signed-in screen.
- **One container width.** Signed-in pages use a two-pane layout (viewer 620 px + panel) or a `max-width: 1240px` centred column. Nothing runs edge to edge at 1500 px.

## How to work

- Implement one screen per task, in the order of `SPEC.md` §4 unless told otherwise (worklist → analyzing → review → sign → share → done → console → welcome).
- Before writing code, open the mockup and list its regions, states and copy; implement against that list, then check every acceptance criterion in the spec section.
- Use the demo data in `SPEC.md` §3.3 (Sample Patient 1 / case AI2Y7) as fixtures so screens look like the mockups while the backend is wired.
- When a backend capability the spec needs does not exist yet (streaming findings, background drafting, trace storage), implement the UI against a typed mock that matches `types.ts`, and leave a `TODO(backend)` with the exact contract.
- Verify in a real browser at 1440 and at 390 wide. Run the full demo path (`SPEC.md` §1.2) after each screen lands — it must still complete end to end.
- Keep copy exactly as written in the spec; do not paraphrase clinical or consent text.
