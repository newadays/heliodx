# HelioDX — design handoff

Design package for the HelioDX clinician flow redesign (worklist → analyze → review → sign → patient note → share → done), the agent console (side panel and full page), and the public welcome page.

## How to use this with Claude Code

1. Copy this folder into the HelioDX repo as `design/` (so the path is `design/SPEC.md`, `design/mockups/…`).
2. Add one line to the repo's root `CLAUDE.md`:
   `For any UI work, read design/CLAUDE.md first.`
3. Start Claude Code in the repo and ask for a screen by name, e.g. *"Implement the Review screen from design/SPEC.md §4.4 to match design/mockups/review.html."*

Claude Code will pick up `design/CLAUDE.md` automatically whenever it works inside `design/`; the root pointer makes sure it is read for UI work elsewhere in the repo.

## What is in here

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Working rules for Claude Code: how to read the mockups, what is non-negotiable, how to verify. |
| `SPEC.md` | The product spec: routes, data model, every screen (layout, states, interactions, copy, acceptance criteria), cross-cutting behaviours, and the prioritised engineering changes. |
| `components.md` | Component inventory with the reference markup and CSS for each (buttons, chips, step rail, finding row, markers, option cards, trace rows, stat tiles, toast). |
| `tokens.css` | Design tokens as CSS custom properties — app theme (light) and landing theme (dark). |
| `tokens.json` | The same tokens as JSON for a Tailwind/theme config. |
| `types.ts` | TypeScript interfaces for the data the screens render (Study, Finding, Report, PatientNote, Share, TraceStep). |
| `mockups/*.html` | Thirteen standalone high-fidelity mockups. Open them in a browser; they are the visual source of truth. Palette: black and white, green for success, red for failure. |
| `assets/` | X-ray samples (NIH ChestX-ray14 crops), the HelioDX logo lockup and square tile, the Meta logo badge. |

## Mockups and the prototype link map

| File | Screen | Primary action → goes to |
| --- | --- | --- |
| `welcome.html` | Public landing page | Log in → `worklist.html` |
| `worklist.html` | Worklist (signed-in home) | Review draft → `review.html`; Watch → `analyzing.html`; Agent console → `worklist-console.html` |
| `analyzing.html` | Study open while analysis runs | Start reviewing → `review.html` |
| `review.html` | Review findings | Continue to report → `sign.html` |
| `sign.html` | Clinician report and signature | Sign → `share.html`; Patient note tab → `share.html` |
| `share.html` | Patient note preview and PDF save (sample study) | Download PDF → `done.html` |
| `done.html` | Shared confirmation and audit trail | Back to worklist → `worklist.html`; Open in agent console → `console.html` |
| `worklist-console.html` | Worklist with the agent console side panel open | Open full console → `console.html` |
| `console.html` | Dedicated agent console page | Open in app → `done.html` |
| `upload.html` | Worklist with the upload panel open (empty, drop zone) | Choose files → `upload-queue.html` |
| `upload-queue.html` | Upload panel with three files queued and the details form | Start analysis → `worklist.html` |
| `upload-deid.html` | De-identification check for a DICOM with burned-in text | Redact and continue → `upload-queue.html` |
| `share-pdf.html` | Patient note preview and PDF save (uploaded study) | Download PDF → `done.html` |

All mockups are laid out for 1440 px wide and are fluid down to phone width (two-pane screens stack; wide tables scroll in a box).

## Provenance

Sample X-rays are crops of NIH ChestX-ray14 images taken from the existing HelioDX demo. The hero film on the welcome page is the one supplied for it. Patient details, times, token counts and step durations in the mockups are the synthetic demo data from the existing app and its console; bracketed values like `[AGE / SEX]` are placeholders where the demo did not show a value.
