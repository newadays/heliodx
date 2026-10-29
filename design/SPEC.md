# HelioDX — clinician flow specification

Version 1 · 28 Oct 2026 · companion to `mockups/`, `tokens.css`, `components.md`, `types.ts`.

## 1. Purpose

HelioDX drafts chest X-ray findings with a team of agents and lets a clinician review, sign and share a plain-language note with the patient. This spec replaces the first-pass flow recorded on 28 Oct (2 min 20 s, of which roughly half was spinners) with a flow that is calm, fast and inspectable.

### 1.1 What the redesign changes

| Problem in the first pass | What this spec does instead |
| --- | --- |
| ~65 s of blocking spinners across five stages, each started by a click | Analysis runs on arrival; findings stream in; report and patient note draft in the background; every wait shows progress, elapsed and expected time (§5.1, §5.2) |
| X-ray cropped to the abdomen (`object-fit: cover`), then letterboxed tiny on the summary | Persistent dark viewer with the whole film, `object-fit: contain` (§4.0) |
| Markers 5 and 6 drawn on top of each other | Markers placed per finding region; the CTR measurement is drawn on the film; hover spotlights a region (§4.4) |
| Six separate Accept clicks with scrolling | One-line verdict, "Accept all N normal findings", compact per-row accept/edit/reject, keyboard shortcuts (§4.4, §5.3) |
| Broken icon font (☐ glyphs) | Inline SVG icons only |
| Native `alert()` on sign; PDF opened in a pop-up and blocked | Inline signed strip + toast; PDF downloads directly (§5.4, §5.5) |
| Three consent gates with greyed-out buttons that do not say why | One attestation on sign, one consent line on share; buttons explain what is missing (§4.5, §4.6) |
| Edge-to-edge 1500 px layout; 200-character lines; raw values like `0.4509` in prose | Two-pane layout or 1240 px column; numbers rounded to two decimals and shown as "value · limit" (§4.0, §4.4) |
| No sense of place across six pages | Persistent step rail Analyze → Review → Sign → Patient note → Share, breadcrumb, and case ID (§4.0) |

### 1.2 The guided demo path (judges)

Target: a study from open to shared in **about two minutes of clinician time**, with no step waiting on a spinner longer than a few seconds.

1. Worklist → open **Sample Patient 1** (draft already ready).
2. Review 6 findings: Accept all, edit one wording (finding 4), continue.
3. Sign: tick attestation, sign. Signed strip appears; patient note tab is already "Draft ready".
4. Share: Download PDF (consent optional). Done screen with audit trail.
5. Optional: open the agent console from the worklist to show the trace.

The worklist also shows a study mid-analysis (Sample Patient 3) so the agents can be watched live without putting the wait on the demo path.

## 2. Information architecture

### 2.1 Routes

| Route | Screen | Auth |
| --- | --- | --- |
| `/` | Welcome (landing) | public |
| `/worklist` | Worklist; `?console=1` opens the console side panel | signed in |
| `/study/:caseId` | Study workspace. One route; the step is state, not a URL segment: `analyzing` → `review` → `sign` → `share` → `done`. Deep links may add `?step=review` etc. | signed in |
| `/console` | Agent console, full page; `/console/:caseId` selects a case | signed in |
| `/worklist?upload=1` | Worklist with the upload side panel open; files dropped anywhere on the worklist open it pre-filled | signed in |

The study workspace is one page with a persistent viewer (left) and a step panel (right). Changing step swaps the panel; the viewer stays mounted so the film never reloads or re-crops.

### 2.2 Navigation chrome (every signed-in screen)

- Header, 56 px, white, bottom border: logo lockup (34 px high, links to `/worklist`) · environment chip "Research Beta · Not ready for clinical use" (outline chip, `chip-env`) · spacer · breadcrumb (`Worklist › Sample Patient 1`) · avatar "DC" (black disc, white initials; title: clinician name).
- Study screens add the **step rail** under the header of the panel: `1 Analyze — 2 Review — 3 Sign — 4 Patient note — 5 Share`. Done steps show a check in a green dot; the current step is a black dot; future steps are outlined. The rail is a `<nav aria-label="Progress">`; steps already completed are links back.

### 2.3 Colour

Black and white, with two signal colours and nothing else:

| Use | Token | Where |
| --- | --- | --- |
| Primary action, current step, selection, focus ring, progress, number chips | `--hx-primary` #15181C | primary buttons, pressed toggles, selected cards, progress bars, meter fill, markers' numbers chip in lists |
| **Success** | `--hx-green` #137A3A (tint #E6F4EA, line #BFE3CB, bright #3DDC84 on the dark viewer, pulse #16A34A) | ok chips (Draft ready, Ready, Normal, Live, Checked), accepted buttons, done steps, signed strip, Done check disc, trace rail dots, image markers and measurement lines, live pulse |
| **Failure / attention** | `--hx-red` #B42318 (tint #FDECEA, line #F3B9B3, bright #FF6B6B on the dark viewer) | warn chips (Needs attention, unsupported sentence), reject hover, error banners, flagged regions on the film, failed states |
| Neutral | greys from `tokens.css` | everything else: tags, inactive steps, hints, borders |

No other hue appears in the app. The landing page keeps black, white and its single green accent (#7FEE64).

## 3. Data model

Full interfaces are in `types.ts`. Summary:

- **Study** — `caseId` (short, e.g. `AI2Y7`), patient (display name, age, sex), modality/view (`Chest X-ray`, `PA`), indication, `arrivedAt`, `status` (`analyzing | draft_ready | in_review | signed | shared`), image (URL, width, height), `findings[]`, `report`, `patientNote`, `shares[]`, `trace[]`.
- **Finding** — `n` (1-based, stable), `title`, `evidence` (one line, "measure · limit" form), `measurement` (`value`, `limit`, `unit`), `confidence` (0–1) and `confidenceBand` (`high ≥ 0.85`, `moderate ≥ 0.6`, else `low`), `polarity` (`normal | attention`), `regions[]` (each `{x, y}` in % of the image, one marker per region), `decision` (`pending | accepted | edited | rejected`), `editedText?`.
- **Report** — `findings[]` (sentences, each carrying its finding `n`), `impression[]`, `recommendation`, `draftedFrom` (hash of the decision set), `signed?` (`by`, `at`, `sha256`).
- **PatientNote** — `title`, `body`, `nextSteps[]`, `approvedBy`, `checkedAgainst` (signed report hash), `readingGrade`.
- **Share** — `channel` (`whatsapp | email | pdf`), `destination`, `consent` (`recorded: boolean`, `note?`), `at`.
- **TraceStep** — `name` (`Received | Intake | Triage | Prep | Signed | Patient note | Shared`), `kind` (`system | model | clinician`), `startedAt`, `agents[]` (e.g. `Intake`), `models[]` (e.g. `Glimmer`, `SAM 3.1`), `durationMs?`, `tokens?`, `summary`, `traceId?`, `detail?` (inputs, outputs, measurements).

### 3.3 Demo fixtures (Sample Patient 1 · case AI2Y7)

Use these so the UI matches the mockups before the backend is wired.

Study: Sample Patient 1 · 34 M · Chest X-ray · PA · "Cough for two weeks." · arrived 14:27:04.

Findings (all `normal`):

| n | title | evidence | confidence | regions (x%, y%) |
| --- | --- | --- | --- | --- |
| 1 | Cardiac silhouette within expected limits | Cardiothoracic ratio `0.45` · limit `0.55` | 0.90 | (50, 55) |
| 2 | Lung areas are symmetric | Area difference `2.1%` · limit `15%` | 0.90 | (28, 36) |
| 3 | Lung densities are symmetric | Left/right mean brightness ratio `1.09` · limit `1.25` | 0.90 | (72, 36) |
| 4 | Costophrenic angles are sharp | Blunting `0 / 0` · limit `0.6` | 0.90 | (17, 79), (84, 79) |
| 5 | No focal consolidation in the left lung | No focal area of increased opacity within the lung outline | 0.70 | (69, 54) |
| 6 | No focal consolidation in the right lung | No focal area of increased opacity within the lung outline | 0.70 | (30, 56) |

Measurement overlay for finding 1: heart-width line at y 62 % from x 40 % to 58 %; inner-thorax line at y 67 % from x 14 % to 86 %; labels "heart 0.45" and "thorax · CTR 0.45".

Report: findings as the six sentences in `mockups/sign.html`; impression (1) No focal consolidation in either lung on this PA chest radiograph. (2) Cardiac silhouette within expected limits. (3) Lung areas and densities symmetric. (4) Costophrenic angles sharp. Recommendation: "Correlate clinically with the two-week history of cough; consider further evaluation if symptoms persist or worsen, and review with the official radiology interpretation."

Patient note: see `mockups/share.html` (title "About your chest X-ray"; body; "What happens next"; "Reviewed and approved by Dr. Demo Clinician (simulated) · HelioDX Demo").

Trace (times transposed to the 14:27 timeline):

| step | kind | at | agents / models | duration · tokens | summary |
| --- | --- | --- | --- | --- | --- |
| Received | system | 14:27:04 | Upload | 831 ms | Chest X-ray · PA · 34 M · from sample |
| Intake | model | 14:27:05 | Intake · Glimmer · SAM 3.1 | 2.7 s · 1 726 | Quality pass · sharpness 97 · brightness 102 · clipped 9% · 1024×1024 · 2/2 regions segmented |
| Triage | model | 14:27:08 | Triage · Glimmer | 2.6 s · 386 | Priority routine · CTR 0.45 · asymmetry 0.02 · density ratio 1.09 · blunting 0 / 0 — all within limits |
| Prep | model | 14:27:10 | Prep · Glimmer | 21.2 s · 2 807 | Draft ready · 6 proposed observations · 5 measurements · 2 overlays |
| Signed | clinician | 14:33:26 | Clinician | — | 6 accepted · 1 edited · 0 rejected · signed by Dr. Demo Clinician |
| Patient note | model | 14:34:02 | Summary · Glimmer | 4.6 s · 1 649 | 1 next step mapped to a signed sentence · 0 claims outside the signed text · grade 7 |
| Shared | clinician | 14:36:10 | Clinician | — | 1 share · PDF · consent recorded |

Totals shown in the console: agent time 31.9 s · tokens 6 568 · model steps 4 · clinician steps 2 · arrival to shared 9:06.

Other worklist rows: Sample Patient 2 (47 F, PA, "Shortness of breath on exertion.", draft ready, 6 findings, 14:19); Sample Patient 3 (analyzing, Prep, 12 s, 14:31); Sample Patient 4 (signed, note shared by PDF, 13:52). Unknown demographics stay as `[AGE / SEX]` / `[INDICATION]` until real fixtures exist.

## 4. Screens

### 4.0 Shared: the study workspace shell

Mockups: `analyzing.html`, `review.html`, `sign.html`.

Layout: a flex row that wraps.
- **Viewer** (left): `flex: 0 1 620px`, background `--hx-viewer-bg`. Toolbar 48 px (patient name, "34 M · Chest X-ray · PA", spacer, toggle buttons). Image stage with 20 px padding; the film is an `<img>` with `object-fit: contain` inside a box of the film's own aspect ratio, max-width 580 px, radius 4 px. Status bar 40 px (image quality, dimensions, prior studies or a hint line).
- **Panel** (right): `flex: 1 1 560px`, background `--hx-ground`. Step rail strip (white, 12 px 28 px padding, bottom border), content (padding 20–24 px 28 px), footer (white, top border, 14 px 28 px) with the hint text left and actions right.
- Below 1180 px the panel wraps under the viewer; the viewer becomes full width.

Viewer toggles (buttons, `aria-pressed`): **Markers**, **Measurements** (review and sign only), **Fit**, **1:1**, **Invert**. Markers are 28 px green circles with a 2 px white ring and the finding number; a finding with two regions draws two markers with the same number. The focused finding's marker grows to 34 px, white fill, green text, and a soft 4 px green halo; its region gets a dashed ellipse and the rest of the film dims to 35 %.

### 4.1 Welcome `/`

Mockup: `welcome.html`. Dark theme (`[data-theme="landing"]` tokens).

- Header 64 px: logo lockup (36 px), spacer, nav "What to expect" (anchor), "Log in" (→ `/worklist`), "Contact us" (dark pill).
- Hero, min-height 680 px: left column max-width 560 px — eyebrow `CLINICIAN-REVIEWED IMAGING FINDINGS` (accent, uppercase, 12 px, 0.08 em tracking); h1 "The platform for" + accent line "Clinical AI Workflow" (clamp 38–62 px, weight 600, line-height 1.06); paragraph "HelioDX: Meta Muse Wonder coordinating a team of Muse Glimmer agents that run the radiology workflow privately, on the clinic's own GPU."; pills "Log in" (light) and "Contact us" (dark); small line "A study, start to finish, in about two minutes · Nothing reaches a patient until you sign".
- Hero art: `assets/cxr-hero.jpg` absolutely positioned on the right (`width: min(100%, 760px)`, `object-fit: cover`, `object-position: center top`, opacity 0.85) with three gradient layers fading its left, top/bottom and right edges into the page colour, and a faint accent radial glow over the heart. Over it: accent markers 1–6 at the positions in the mockup, two measurement lines, and three chips ("Cardiac silhouette · within limits · CTR 0.43", "Costophrenic angles · sharp", "6 findings drafted in 27 s"). The whole art block is `role="img"` with a descriptive label; its children are `aria-hidden`.
- "What to expect": eyebrow, h2 "Five steps. You decide at every one.", side paragraph, then five cards (01 Analyze … 05 Share) in a grid `repeat(auto-fit, minmax(min(210px, 100%), 1fr))`. Copy as in the mockup; card 05 reads "A one-page PDF to print or hand over, with the patient's consent recorded."
- Principles: three cards — "You stay in charge", "Private and compliant", "Fully traceable".
- Footer: Meta logo in a white 12 px-radius badge (40 px high), "Powered by Meta AI" (28 px, 600), "Muse Wonder · Muse Glimmer · SAM 3.1 · Muse Voice Transcribe", links Log in · Contact us · Agent console, and the research-prototype line.

Acceptance: text contrast on the dark ground ≥ 4.5:1 (body `#B5BDB7`, muted `#8A939A`); the hero reads at 390 px wide with the film as a dimmed backdrop; "Log in" reaches the worklist.

### 4.2 Worklist `/worklist`

Mockup: `worklist.html`.

- Centred column, max-width 1240 px, padding 32 px 24 px.
- Title row: h1 "Worklist" (26 px, 700) + description; right: secondary button "Agent console" (external-link icon) → opens the side panel (§4.8).
- **Guided demo** card (dismissable, remembered per user): label "GUIDED DEMO", "About 2 minutes", four numbered steps: Open a study · Review the drafted findings · Sign the report · Share the plain-language note.
- Filter tabs with counts: All · Ready to review · Analyzing · Signed. Sort select: Newest first / Ready first.
- Table (card, `min-width: 1000px` inside an `overflow-x: auto` box). Columns: thumbnail 64 px (`object-fit: cover`, dark background while loading) · Patient (name, age/sex) · Study (modality, view · image count) · Indication · Status · Arrived (mono HH:MM) · action.
- Status cell by `status`:
  - `draft_ready`: ok chip "Draft ready" + muted "N findings · all within normal limits" (or "· K need attention"). Action: primary "Review draft".
  - `analyzing`: neutral chip "Analyzing" with pulse dot + 120 px progress bar + muted "<step> · <elapsed> s". Action: secondary "Watch".
  - `signed` / `shared`: ink chip "Signed" + muted "Patient note shared · <channel>". Action: secondary "View".
- Footnote: "Analysis runs on arrival and usually finishes in under 30 seconds. Open a study at any time — findings appear as they are detected and you can start reviewing before the run completes."
- Thumbnails load with a dark placeholder of the right size; no layout shift.

Acceptance: a `draft_ready` row opens the workspace already at the review step; an `analyzing` row opens it at the analyzing step; the analyzing row's progress updates live without reload; tab counts match the rows.

### 4.3 Analyzing (study workspace, step 1)

Mockup: `analyzing.html`.

- Viewer: film with a thin accent scan line animating top→bottom (3.4 s, ease-in-out, alternate) while analysis runs; status bar "Image quality OK · 1024 × 1024 · No prior studies on file".
- Panel header row: h1 "Drafting findings"; right: elapsed `m:ss` in mono 20 px + "elapsed · usually under 0:30". Progress bar (`role="progressbar"`) driven by completed steps (Received 10 %, Intake 30 %, Triage 45 %, Prep 45→100 % by findings streamed / expected).
- Step list: Image quality checked (done, detail "exposure and rotation within range") · Study type confirmed (done, "Chest X-ray · PA") · Detecting findings (running, pulse, "N found so far") · Drafting clinician report (todo, "starts automatically").
- "Findings so far": one card per streamed finding (number chip, title, evidence, "Normal"/"Attention" chip); remaining expected slots as dashed skeleton cards with shimmer (`aria-hidden`).
- Clinical context card: the indication.
- Footer: "You can start reviewing now. Findings still being detected will join the list as they arrive." · ghost "Agent console" · primary "Start reviewing" (enabled as soon as ≥ 1 finding exists).

Acceptance: opening a study already `draft_ready` skips this step; the elapsed counter ticks every second; when Prep completes the panel transitions to Review without a click if the clinician has not already moved on; if analysis fails, the step shows an error state with "Retry analysis" and the console link (§5.8).

### 4.4 Review (step 2)

Mockup: `review.html`.

- Panel header: h1 "Review findings"; verdict chip "N findings · all within normal limits" (or "N findings · K need attention", warn chip); muted "AI-drafted. Supports your judgment; not a diagnosis."; right: "**R of N** reviewed" + progress bar.
- Toolbar: secondary "Accept all N normal findings" (double-check icon) — accepts every `normal` finding that is still `pending`; attention findings are never bulk-accepted. Right: keyboard hints `A accept · E edit · R reject · J K next / previous`.
- Findings list, grouped when attention findings exist ("Needs attention" first, then "Within normal limits"). Row grid: `24px | 1fr | 112px | auto`. Cells: number chip · title + evidence (mono for numbers) · confidence (label "High/Moderate/Low · NN%" + 3-segment meter: high 3, moderate 2, low 1) · three 44 px icon buttons Accept (check), Edit (pencil), Reject (×).
- Row states: `pending` (default) · `accepted` (Accept button filled green, `aria-label="Accepted"`; clicking again returns to pending) · `rejected` (row at 60 % opacity, title struck, Reject filled; still re-openable) · `editing` (row expands: label "Wording in the report", text input prefilled with the report sentence, "Save and accept" primary 40 px, "Cancel" ghost, muted "Measured … · your edit is recorded as yours") · `edited` (neutral chip "Edited by you" after the title; Accept shown filled).
- Focus: one row is focused at a time (black border + 3 px halo); J/K move it; hovering a row or focusing it spotlights its marker(s) on the viewer; clicking a marker focuses its row.
- Footer: "The report drafts itself from your decisions as you go — no waiting at the next step." · ghost "Save and return later" → worklist · primary "Continue to report" → Sign. If any finding is still `pending`, continuing shows an inline confirm in the footer: "K findings have no decision. Continue and leave them out of the report?" with "Go back" / "Continue". Rejected findings are excluded from the report and listed in the trace.

Acceptance: all six decisions reachable by keyboard alone; Accept all sets exactly the pending normal findings; editing a sentence persists through Sign; the progress counter equals accepted + edited + rejected; the viewer marker for the focused row changes state within one frame; at 390 px the list is single-column and the icon buttons stay 44 px.

### 4.5 Sign (step 3)

Mockup: `sign.html`.

- Panel rail right side: muted summary "6 of 6 reviewed · 6 accepted · 1 wording edited".
- Tabs: "Clinician report" (current) · "Patient note" with chip "Draft ready" (or "Drafting…" with pulse; or "Drafts after you sign" if background drafting is off). Right: ghost "Edit" (toggles contenteditable sections) and "Copy".
- Report card: h1 "Chest X-ray · PA · Sample Patient 1, 34 M"; muted "Drafted from your 6 accepted findings"; FINDINGS as a list with number chips (a line hover spotlights its marker on the viewer), edited lines carry the "Edited by you" chip; IMPRESSION numbered list; RECOMMENDATION paragraph; bottom info line "AI-drafted for clinician review. Not a diagnosis — verify against the image before signing."
- Footer: attestation checkbox (label: "I have reviewed the image and the findings. The impression and recommendation are my own.") on the left; right: ghost "Back to findings", primary "Sign as Dr. <Name>" with lock icon; under it, muted "Signing locks the report and records the time and a hash. The patient note is written from the signed version."
- Sign button is enabled only when the attestation is ticked; when disabled it carries `aria-describedby` pointing at the muted hint, which then reads "Tick the confirmation to sign".
- On sign: button shows a 36 px inline spinner and "Signing…" for the request only; on success the panel moves to Share and the signed strip (§4.6) is shown; a toast "Report signed · 14:33" appears. No modal, no `alert`.

Acceptance: report content equals the accepted/edited findings in order; the signed report is immutable afterwards (Edit disappears, strip shows hash); the patient-note tab shows the real draft state.

### 4.6 Share (step 4 Patient note + step 5 Share)

Mockups: `share.html` (sample), `share-pdf.html` (uploaded study).

*Revised 28 Oct, twice. First: the page read as a wall of options with a greyed-out button and no visible order, so the pane became a numbered sequence with a primary that is never disabled and a PDF that is never gated by consent. Second: **WhatsApp and email are removed for now** — the only way the note leaves HelioDX is a one-page PDF. The channel-picker design below is kept for when sending returns; build the PDF-only version (**§4.6a**) today.*

#### 4.6a PDF-only (build this)

- **Signed strip** and **left pane** exactly as in the full design below (note card, "Checked against the signed report" chip, Edit wording / Rewrite from report, no checkbox in the card, one muted line under it: "The PDF is this note, one page, with the case ID <id> in the footer. The image and your clinical findings are not included.").
- **Right pane.** Step rail; h1 "Save the patient note as a PDF"; muted "One page, to print or hand to <first name | the patient>. Only the plain-language note leaves HelioDX; the image and your clinical findings stay in the record."
  - A static **PDF card** (not a radio): black file icon · "PDF · `HelioDX-<caseId>-patient-note.pdf`" · "Downloads here — no new tab. Sending by WhatsApp or email is not available yet."
  - **1 · Record consent** card with the neutral chip **Optional for a PDF**: checkbox "<First name | The patient> agreed to receive a printed or saved copy of this note." · "Consent note (optional)" · muted "What you record here goes into the study's audit trail with the time." Nothing in it takes focus on load.
  - Footer: ghost "Back to report" · **2 · Download PDF** (primary, always enabled, download icon) · under it "Saves the PDF and records the share in the audit trail."
- On click: generate the PDF, save it via Blob + `<a download>`, write a `Share { channel: 'pdf', consent }` record and a "Shared" trace step ("1 share · PDF · consent recorded" or "· consent not recorded"), then move to Done.
- No `Channel` other than `'pdf'` is offered or accepted by the API for now; the `Channel` type keeps `'whatsapp' | 'email'` for later.

Acceptance (PDF-only): with nothing touched, one click on Download PDF produces `HelioDX-<caseId>-patient-note.pdf` without opening a tab and lands on Done; the consent checkbox is optional and its state appears in the audit trail; the word WhatsApp or email appears nowhere on the page except the single "not available yet" sentence; no pseudonym is used as a name; the note card contains no checkbox.

#### 4.6b Full design with channels (deferred — do not build yet)

- **Signed strip** under the header (green tint, full width): lock icon, "**Report signed** by Dr. Demo Clinician · today 14:33 · `sha256 a6bd4ea5…` · locked", right link "View signed report" (→ sign step, read-only).
- **Left pane** (`flex: 0 1 620px`, light grey `#E9EDF1`): toolbar label — sample: "WHAT <FIRST NAME> WILL RECEIVE"; upload: "WHAT THE PATIENT WILL RECEIVE" (a pseudonym is never used as a name) — plus the ok chip "Checked against the signed report" and ghost "Edit wording" / "Rewrite from report". Centre: the note as a 460 px card. **No checkbox in the note card**: the old "Tick each step to confirm it says what you signed" gate is removed — the check chip already covers it, and a second checkbox with a different purpose is what made the page confusing. Under the card, one muted line about the PDF: "The PDF is this note, one page, with the case ID <id> in the footer. The image and your clinical findings are not included."
- **Right pane** — step rail; h1: sample "Share the patient note with <first name>", upload "Share the patient note"; muted "Two steps: choose how the patient gets it, then save or send. Only the plain-language note leaves HelioDX; the image and your clinical findings stay in the record." Then three numbered blocks (24 px black number discs, the same `n` chip as the finding numbers):
  1. **How will the patient get it?** Radio cards. Order: channels with a contact on file first, PDF last — except when no contact exists, in which case PDF is first and pre-selected. A channel without a contact is rendered as a disabled card (grey ground, no cursor, radio disabled with an `aria-label` explaining why) with the sentence "No phone number was given for this upload." and a secondary 36 px **Add a number** / **Add an email** button that reveals an inline input; never a dead option. The PDF card says "Print it or hand it over. Nothing is sent and no new tab opens." and carries a neutral chip "No contact needed".
  2. **Record consent** card. Header carries a neutral chip stating the rule for the selected channel: **Required to send** (WhatsApp, email) or **Optional for PDF**. Checkbox sentence — send channels: "<First name> agreed at today's visit to receive this note by <channel>." (upload: "The patient agreed at today's visit to receive this note by <channel>."); PDF: "The patient agreed to receive a printed or saved copy of this note." Then "Consent note (optional)" and the muted policy line "WhatsApp and email are third-party services; your clinic's policy applies. The channel, time and consent go into the study's audit trail." Nothing in this card takes focus on page load.
  3. **The action**, in the footer, with the number disc beside it: ghost "Back to report" left; right, the primary — **Download PDF** (PDF) or **Send via <Channel>** — and under it one muted line saying exactly what will happen: "Saves `HelioDX-<caseId>-patient-note.pdf` and records the share in the audit trail." / "Sends to <destination> and records consent in the audit trail. A PDF copy is always available from the Done screen."
- **The primary is never disabled.** For send channels with consent unticked, pressing it does not send: the consent card gets a red border, the checkbox receives focus, and an inline red line under it reads "Tick consent before sending." (role="alert"). Download PDF always works; if consent is unticked the audit trail records "consent not recorded".
- "Edit wording" makes the note body editable in place; "Rewrite from report" regenerates and shows "Rewriting…" inside the card (skeleton lines) without emptying the pane. Any edit re-runs the check against the signed report and updates the chip (ok "Checked against the signed report" / warn "1 sentence not supported by the signed report — review").
- On send: the primary shows an inline spinner for the request only, then the workspace moves to Done ("Sent to <first name> via WhatsApp" / "Saved as PDF for the patient").
- Naming: an upload's pseudonym (`Upload 1 · 28 Oct`) never appears where a person's name would ("Share with…", "… agreed at today's visit"); use "the patient".

Acceptance: a clinician who has never seen the page can state the three steps from the layout alone; with PDF selected and nothing else touched, one click on Download PDF produces `HelioDX-<caseId>-patient-note.pdf` without opening a tab and lands on Done; with WhatsApp selected and consent unticked, pressing Send focuses the checkbox and shows the inline message, and nothing is sent; channels without a contact show the add-contact action instead of a dead radio; no pseudonym is used as a name anywhere on the page; the note card contains no checkbox; the note cannot be sent while the check chip is in the warn state without an explicit "Send anyway" confirm.

### 4.7 Done (step 5 complete)

Mockup: `done.html`.

- Centred two-column row (max-width 1100 px). Left: 56 px green check disc; h1 "Patient note saved as a PDF" (when sending channels return: "Sent to <Name> via <Channel>"); muted "Today at 14:36 · consent recorded. Print it or hand it to <Name>; the image and your clinical findings stay in the record."; buttons primary "Back to worklist", secondary "Open next: <next ready study>", ghost "Download the PDF again"; card "What the PDF contains": "One page: the plain-language note, who approved it and the case ID <id> in the footer. No image and no measurements, so nothing clinical can be misread without you."
- Right: "Audit trail" card: h2 + link "Open in agent console"; vertical timeline — time (mono) · rail dot · title + detail — for Study arrived, Analyzed in 27 s, Reviewed by …, Report signed (hash), Patient note written from the signed report, Sent via … (last, filled dot).

Acceptance: timeline is built from `trace[]`, not hard-coded; "Open next" picks the oldest `draft_ready` study, hidden if none.

### 4.8 Agent console — side panel (`/worklist?console=1`)

Mockup: `worklist-console.html`.

- The "Agent console" button becomes pressed (ink fill, `aria-pressed="true"`). A 480 px `<aside aria-label="Agent console">` slides in on the right; the worklist narrows (it does not get covered). Below 1180 px the panel stacks under the worklist.
- Panel header: h2 "Agent console", ok chip "Live" with pulse, spacer, secondary 36 px "Open full console" (→ `/console/<selected case>`), 36 px close button.
- "Running now" strip (green tint, link): pulse + "**Running now:** Sample Patient 3 · Prep · 12 s" + "Follow" → that study's analyzing step. Hidden when nothing is running.
- Case `<select>`: follows the row selected in the worklist (clicking a row selects it; the row gets the `sel` tint).
- Four stat tiles: Agent time · Tokens · Model steps · Clinician steps.
- Trace timeline: for each `TraceStep` — rail dot (green ring for model/system, filled ink for clinician) · title · time (mono 12 px) · tags (agent neutral, models black) · duration · tokens right-aligned · one-line summary · "Open trace" link (model steps only) → full console with that step expanded.
- Footer: muted "Model steps run on Glimmer; segmentation on SAM 3.1." · ghost "Export trace".
- Live: steps append in real time for running cases; the stat tiles update when a step completes.

Acceptance: opening the panel does not reflow the table columns; `Esc` closes it; panel state survives navigation to a study and back.

### 4.9 Agent console — full page (`/console/:caseId`)

Mockup: `console.html`.

- Left `<aside aria-label="Cases">` 320 px: h2 "Cases" + chip "N running"; search (patient, case ID or step); filter chips All · Running · Ready · Signed; case list (name, case ID or arrival time in mono, status line with pulse for running); selected case tinted. Footer note about what is logged.
- Main: h1 patient name + mono case ID + status chip; meta line; buttons secondary "Export JSON", primary "Open in app" (→ `/study/:caseId`).
- Stat tiles: Agent time · Tokens · Model steps · Clinician steps · Arrival to shared.
- Trace table (card, `min-width: 980px` in an `overflow-x: auto` box). Columns: Step · Started · Agent · Duration · Tokens · Summary · expand. Rows expand in place (`aria-expanded`); the expanded row shows tabs Summary · Prompt · Raw output · Timing, a three-column detail (Inputs · Output · Measurements and overlays), and actions "Copy trace link" and "Replay this step" (replay never mutates a signed case).
- Deep link `/console/:caseId?step=<traceId>` opens with that step expanded and scrolled into view.

Acceptance: the list and the selected case update live; expanding a row does not shift other rows' columns; Export JSON downloads `HelioDX-<caseId>-trace.json` (no new tab).

### 4.10 Upload a study (`/worklist?upload=1`)

Mockups: `upload.html` (empty panel), `upload-queue.html` (files queued, details), `upload-deid.html` (de-identification check).

Entry points: the **Upload study** button in the worklist title row (pressed state while the panel is open), and dragging files anywhere over the worklist — the page shows a dashed outline with "Drop to upload" and opens the panel with the files queued. The panel is a 520 px `<aside aria-label="Upload a study">` on the right, same pattern as the console; below 1180 px it stacks under the worklist.

**State 1 — empty (`upload.html`)**
- Header: h2 "Upload a study" · close.
- Drop zone (dashed, 36 px padding, light ground): upload icon in a grey disc, "Drop chest X-rays here", "or", secondary **Choose files** (a `<label>` wrapping `<input type="file" multiple accept=".dcm,.dicom,image/jpeg,image/png">`), hint "JPEG, PNG or DICOM (.dcm) · up to 50 MB per file · several files at once". Drag-over state: black border, grey ground.
- "Before anything leaves your machine" — three rows with icons: DICOM patient tags are removed in your browser; burned-in text is checked; analysis starts as soon as a file is ready.
- "or" divider → ghost link "Add a sample from the NIH ChestX-ray14 set" (opens the existing sample panel).
- Footer: muted "Research Beta — upload synthetic or fully de-identified images only." · ghost Cancel · primary **Start analysis** disabled with `aria-describedby` hint "Add at least one file to start".

**State 2 — queue and details (`upload-queue.html`)**
- Header adds a neutral chip "N files". A compact dashed strip "Add more files — or drop them here" sits above the queue (another file input).
- Queue: one card per file — 56 px thumbnail (dark placeholder until decoded), file name + "size · format", then a status line. The selected card has a black border + halo; clicking a card selects it and shows its details below. States:
  - `uploading`: thumbnail at 55 % opacity, 6 px progress bar, "14 patient tags removed · uploading 64%"; the × cancels.
  - `ready`: ok chip **Ready** + "Chest X-ray · PA detected · quality OK · no text on film".
  - `attention`: red card border, warn chip **Needs attention** + the reason in one sentence, then ghost actions **Replace file** (file input) and **Analyze anyway**; the × removes. Reasons: not a frontal chest X-ray, lung bases/apices not in view (cropped), image too small (< 1024 px short side), unreadable file, duplicate of an existing study (same pixel hash — link to it), burned-in text detected (→ state 3).
  - `failed`: red chip **Failed** + reason (unsupported format, over 50 MB, decode error) + Replace / Remove.
- Details card for the selected file (light ground): label "Details · <file name>" + "Applies to this file only"; **Patient label** text (default "Upload N · <date>", hint "A pseudonym for the worklist. Never a real name or ID."); **Age** number · **Sex** select (F / M / Not recorded) · **View** select (detected value first, e.g. "PA · detected", then AP); **Indication** textarea; checkbox "This image contains no patient identifiers — on the film or in its metadata. By uploading, you agree to use the images in the beta project." (required per file; recorded with the study — decided 28 Oct).
- Footer: "**R of N ready.** Files that need attention are skipped unless you choose Analyze anyway." · ghost Cancel · primary **Start analysis · R** (disabled with the hint "Tick the identifier confirmation for each ready file" until every ready file's checkbox is ticked).
- Start analysis closes the panel, inserts one worklist row per started file at the top with status `analyzing` (progress live), shows a toast "R studies uploaded · analysis started", and keeps the panel's unfinished files (uploading / attention) available if reopened.

**State 3 — de-identification check (`upload-deid.html`)**
- Opened from an `attention` card whose reason is burned-in text, or automatically when a DICOM finishes uploading with a flagged region. Header: back arrow (to the queue) · file name · warn chip **Needs attention** · close.
- Preview: the film in a dark box with `object-fit: contain`; the flagged region drawn as a 2 px dashed red (#FF6B6B) rectangle with the rest of the film dimmed to 45 %, and a red tag "Text detected" above it. Status line: "DICOM · CR · 2048 × 2048 · PA" and "Chest X-ray · quality OK".
- Red banner: "Burned-in text found in the top-right corner." + "It may be a name, ID or date printed on the film. Redact it before analysis — the redacted image is what gets stored and analyzed; the original never leaves your machine." + ghost actions **Keep — it is not identifying** and **Adjust the area** (drag handles on the rectangle).
- "What left your machine" card: ok chip "Tags removed in your browser"; two columns — **Removed · 14** (green check rows: Patient name, Patient ID, Birth date, Accession number, Institution + referring physician, Study date (shifted) + device serial, "Show all 14") and **Kept · 6** (grey dot rows: Modality · CR, Body part · CHEST, View position · PA, Image size, Pixel spacing, Photometric). The removed set follows the DICOM PS3.15 basic de-identification profile; dates are shifted by a per-upload random offset, not deleted, so the view/date relationship survives.
- Footer: muted "Analysis will not start until the flagged area is redacted or confirmed." · ghost **Remove file** · primary **Redact and continue** → back to the queue with the file `ready` and its status line "Redacted · 1 area · 14 tags removed".

Acceptance: a dropped JPEG reaches `ready` with no clicks; a DICOM never leaves the browser with any of the removed tags present (verify with a tag dump of the uploaded object); a file with burned-in text cannot start analysis until redacted or explicitly kept, and the choice is written to the trace ("Received" step detail); multi-file upload creates one study per file; cancelling an upload mid-way leaves no partial study; all controls work with keyboard only; the drop zone and queue work at 390 px wide.

### 4.11 Study source: uploads vs samples

Mockup: `worklist.html` (two sections, source tags, source filter); `review.html` (source tag in the viewer toolbar). Amends §4.2, §4.0, §4.3, §4.5, §4.6, §4.7, §4.8, §4.9 and §1.2 as noted.

**Why.** Users will mix their own films with the preloaded demo set. The two must be unmistakable at a glance, in every surface a study appears in, and the distinction must not depend on colour (green and red are reserved for success and failure, §2.3). The cue is structural and lexical: separate sections, a differently shaped tag, a differently treated thumbnail, different words in the metadata, and a case-ID prefix that travels everywhere.

**Data.**
- `Study.source: 'upload' | 'sample'` — set at creation, immutable.
- `Study.caseId` is prefixed by source: `U-` for uploads, `S-` for samples (e.g. `U-7K2P`, `S-AI2Y7`). The prefix is part of the ID string wherever the ID appears: URLs (`/study/U-7K2P`), the console, trace exports, PDF footers, the audit trail.
- `Study.provenance` — uploads: `{ uploadedBy, uploadedAt, format: 'jpeg'|'png'|'dicom', removedTagCount, redactionCount, overrides[], originalFileName }` (`originalFileName` is shown to the uploader only, never exported). Samples: `{ dataset: 'NIH ChestX-ray14', synthetic: true, sampleIndex }`.
- Visibility and lifecycle: an upload is visible only to the user who uploaded it and can be **deleted** by them (removes the image, findings, report, note, shares and trace). A sample is visible to everyone in the workspace, can be **reset** (back to `draft_ready`: decisions, signature, note and shares cleared; the trace keeps a "Reset" clinician step) and can never be edited, renamed or deleted.
- Patient label for uploads is a pseudonym, default `Upload N · <d Mon>`. Labels beginning with "Sample Patient" are reserved: the details form rejects them inline with "Reserved for sample studies."

**Worklist (amends §4.2).**
- Two sections in this order, each an `<section>` with an `<h2>`, a count pill, a one-line description and a section action:
  - **Your uploads** · "De-identified in your browser · visible to you only · you can delete them" · ghost "Upload another" (opens the upload panel).
  - **Sample studies** · "NIH ChestX-ray14 films with synthetic patients · for the guided demo · reset any time" · ghost "Add a sample" (opens the sample panel).
- Uploads always sit above samples; the Sort control applies within each section. Status tabs (All / Ready to review / Analyzing / Signed) count across both sections. A **source filter** — segmented control `All sources · Your uploads · Samples`, `<nav aria-label="Filter by source">` — sits beside the sort control and persists in the URL (`?source=uploads|samples`). Filtering to one source hides the other section entirely.
- Empty upload section (user has none): the section still renders, with an inline drop target in place of the table: "No uploads yet — drop a chest X-ray here or **Upload study**." Samples section is never empty (the seed set is always present; if a user removed all via reset-to-empty, show "Add a sample").
- Row anatomy by source:

| Cell | Upload | Sample |
| --- | --- | --- |
| Thumbnail | 64 px, solid, full contrast | 64 px inside a 1.5 px dashed `#9AA0A6` frame with 3 px padding, image at 85 % opacity (`thumb-sample`), decorative (`aria-hidden`) |
| Name line | pseudonym + `UPLOADED` tag (solid black, white text, upload icon) | "Sample Patient N" + `SAMPLE` tag (white, dashed grey border, grey text) |
| Meta line | `47 F · by DC at 14:52 · U-7K2P` | `34 M · synthetic · S-AI2Y7` |
| Study, second line | `PA · JPEG · 14 tags removed` (DICOM: `PA · DICOM · 14 tags removed · 1 redaction`) | `PA · NIH ChestX-ray14` |
| Row overflow menu (36 px icon button, far right of the action) | Delete study (inline confirm in the row: "Delete this upload and everything drafted from it?" Cancel / Delete) · Download de-identified file · Open in console | Reset sample · Open in console |

- The source tag is the `src` component (§components.md): 20 px tall, uppercase 10.5 px, weight 700, 0.06 em tracking; `src-up` = black fill / white text / 10 px upload icon; `src-sample` = white fill / 1 px dashed `#9AA0A6` border / `#5F6873` text. On the dark viewer: `src-sample` = transparent / dashed `#8B96A3` / `#C8D0D8`; `src-up` = white fill / black text.

**Study workspace (amends §4.0, §4.3).**
- Viewer toolbar: patient name · source tag · meta including the case ID (`34 M · Chest X-ray · PA · S-AI2Y7`). Breadcrumb unchanged.
- Viewer status bar, second item: upload → `Uploaded JPEG · de-identified in browser · 14 tags removed · 1 redaction`; sample → `NIH ChestX-ray14 · synthetic patient`.
- Uploads only: a "Delete study" item in the viewer's overflow menu, disabled once signed (signed uploads are retained for the audit trail; show the hint "Signed studies are kept for the audit trail").

**Report, note and PDF (amends §4.5, §4.6).**
- Report title keeps the case ID: `Chest X-ray · PA · Upload 1 · 28 Oct · U-7K2P`.
- Signed PDF footer: upload → `Case U-7K2P · uploaded by Dr. Demo Clinician · de-identified in browser · HelioDX research prototype`; sample → `Case S-AI2Y7 · sample study, synthetic patient · HelioDX research prototype`.
- Patient note approved-by line: sample → "Reviewed and approved by Dr. Demo Clinician (simulated) · HelioDX Demo"; upload → "Reviewed and approved by Dr. Demo Clinician · HelioDX research prototype" (drop "(simulated)", keep the prototype wording). The share panel for a sample adds the muted line "This is a sample study — nothing is sent; the share is recorded for the demo." and sends nowhere.
  - *As built (29 Oct):* the demo organization is named "HelioDX" (was "HelioDX Demo" / "HelioDX demo clinic (synthetic)"), so the PDF header reads "HelioDX". The approved-by line is just "Reviewed and approved by Dr. Demo Clinician" (plus "(simulated)" for samples); the case line under the disclaimer carries the source and "HelioDX research prototype" once, so the prototype wording no longer repeats.

**Console (amends §4.8, §4.9).**
- Case list rows and the case `<select>` show the source tag after the name; the case ID shows its prefix.
- The **Received** trace step's agent tag is `Sample` for samples and `Upload` for uploads (the current build tags samples `Upload` with "from sample" in the summary — change the tag). Summary lines: sample → `Chest X-ray · PA · 34 M · from sample S-AI2Y7`; upload → `Chest X-ray · PA · 47 F · uploaded by DC · JPEG · 14 tags removed · 1 redaction`. Overrides (`analyze anyway`, `kept text`) appear in the step detail.
- Stats and totals are per case and unaffected.

**Guided demo (amends §1.2, §4.2).** The demo card reads "About 2 minutes · uses a sample"; step 1 "Open a study" always targets the first `draft_ready` sample, never an upload. If no sample is `draft_ready` (all signed), the card's step 1 becomes "Reset a sample" and opens the sample section's reset action.

**Acceptance.**
- With one upload and four samples, the worklist shows two sections in that order; sorting by any key never moves an upload below a sample.
- Every study row, viewer toolbar, console case row, trace export and PDF footer carries the source — by tag or prefix — with no colour needed to tell them apart (verify in greyscale).
- A second user signed into the same workspace sees the samples but not the first user's uploads.
- Deleting an upload removes it from the worklist, the console and search; its case ID is never reused. Resetting a sample returns it to `draft_ready` with the original image and no decisions, and adds a "Reset" step to its trace.
- The details form rejects a label starting with "Sample Patient".
- The guided demo opens a sample even when an upload is the newest study.
- `?source=uploads` reloads with only the uploads section and the filter pressed.

**As built (HelioDX, 28 Oct).**
- Samples belong to the workspace: one shared set for the demo organization (owner id `samples`, files under `studies/{orgId}/samples/`), seeded with `demo-user seed-samples`; every demo account reviews, signs, shares and resets the same set. Uploads stay private to the uploader (`studies/{orgId}/{uid}/…`).
- Case ids are reserved on creation (`caseIds/{orgId}_{id}`), so a deleted upload's id is never drawn again.
- Files still in the upload panel show in "Your uploads" as "Not started" rows with what they're waiting for and a "Finish upload" action; nothing exists on the server until Start analysis (§4.10).

## 5. Cross-cutting behaviour

### 5.1 Analysis on arrival, findings streamed

- Analysis starts when a study is ingested, not when it is opened. The worklist shows progress for running studies.
- The client subscribes to a per-study stream (SSE or WebSocket) that emits `trace_step`, `finding` (one per detected finding, with `expectedTotal` when known), `report_draft`, `patient_note_draft`, and `done | error` events. The Analyzing panel renders findings as they arrive; the Review list accepts late arrivals while the clinician is already reviewing (new rows animate in at the bottom; the verdict chip and counts update).
- Expected time is shown as "usually under 0:30" and comes from a rolling median of recent runs, not a constant.

### 5.2 Background drafting

- The clinician report is (re)drafted from the current decision set each time a decision changes, debounced 600 ms; the Sign step shows whatever draft matches the current decisions and never a blank page. If the draft is older than the decisions, the Sign step shows a slim "Updating report…" line for the delta only.
- The patient note is pre-drafted from the current report draft. On sign, the server checks the note against the signed text (hash match → "Checked against the signed report"; mismatch → regenerate from the signed report before showing the Share step, with the chip reading "Rewriting from the signed report…").

### 5.3 Keyboard

Review step: `A` accept, `E` edit, `R` reject, `J`/`K` next/previous, `Enter` opens the focused finding's edit, `Esc` cancels edit, `Shift+A` accept all normal. Sign step: `Cmd/Ctrl+Enter` signs when the attestation is ticked. Console panel: `Esc` closes. Shortcuts are ignored while typing in an input.

### 5.4 Toasts and status

- One toast region, bottom-centre, max one toast at a time, 5 s, dismissible, `role="status"`. Used for: Report signed, Note sent, PDF downloaded, Copied, Export ready, and recoverable errors with a retry action.
- Long-running actions show an inline spinner inside the triggering button and keep the rest of the screen interactive; they never replace page content with a spinner.
- No `alert`, `confirm`, `prompt`, no modal dialogs anywhere in the flow.

### 5.5 Sharing, PDF and consent

- **For now the only share is a PDF** (§4.6a). WhatsApp and email are deferred; nothing in the UI offers them beyond the one "not available yet" sentence, and the API rejects any channel other than `pdf`.
- PDF: generated server-side or client-side, delivered as a Blob and saved via an `<a download>` click; never `window.open`. File name `HelioDX-<caseId>-patient-note.pdf`; one page; footer carries the case ID and the source line (§4.11).
- Consent is one optional checkbox for a PDF ("agreed to receive a printed or saved copy"); the optional note is free text; both are stored on the `Share` record and shown in the audit trail ("consent recorded" / "consent not recorded").
- When sending channels return (§4.6b): consent becomes required for them, sends go through the clinic's configured provider, and the UI shows only the destination the record holds (mono).

### 5.6 Signing

- Signing stores `by`, `at` and a SHA-256 of the canonical report text; the report becomes read-only. The signed strip shows the first 8 hex characters. Any later change requires an addendum (out of scope for v1; show nothing).

### 5.7 Trace

- Every system, model and clinician action on a study writes a `TraceStep`. Model steps carry agent name(s), model name(s), `durationMs`, `tokens`, `traceId` and a `detail` object. Clinician steps carry `summary` only.
- The Done audit trail, the console side panel and the console page all render the same `trace[]`.

### 5.8 Loading, empty and error states

- Worklist empty: "No studies yet. New studies appear here as they arrive." with the demo card still shown.
- Image not yet loaded: the viewer box keeps the film's aspect ratio with a dark placeholder; no layout shift.
- Analysis failed: step row in warn colour, "Analysis didn't complete" + "Retry analysis" secondary + "Agent console" link; the study stays in the worklist as "Needs attention".
- Send failed: toast with "Retry"; the Share step stays as it was.
- Stream dropped: a slim reconnecting line in the panel; retry with backoff; never reset the clinician's decisions.

### 5.9 Responsive

- Signed-in pages: 1440 design width; two-pane screens wrap under 1180 px; tables scroll horizontally inside a card; toolbars wrap; hit targets ≥ 44 px at every width.
- Landing: fluid; the five-step grid collapses by `auto-fit`; the hero film becomes a dimmed backdrop behind the text on phones.

### 5.10 Upload pipeline (client side)

Order of operations for each file, all in the browser before any network call:

1. **Sniff and decode.** Accept by content, not extension: DICOM (preamble `DICM`), JPEG, PNG. Reject others as `failed`. Decode to pixels (DICOM via a WASM/JS decoder; apply rescale slope/intercept and `MONOCHROME1` inversion so the preview matches a viewer).
2. **De-identify DICOM.** Strip the PS3.15 basic-profile tags plus private tags; shift dates by a per-upload random offset (same offset for every date in the file); keep modality, body part, view position, image geometry, photometric interpretation. Record the removed-tag count for the status line and the trace.
3. **Burned-in text check.** Run OCR on the image corners and edges (where annotations live). Any hit with a confidence above the threshold → `attention` with the bounding box; the user redacts (fills the box with black in the pixel data) or keeps.
4. **Study-type and view check.** Classify frontal chest vs other, PA vs AP, and field of view (apices and costophrenic angles present). Failures → `attention` with the reason; the user may "Analyze anyway" (recorded in the trace). As built: the browser checks size, greyscale and aspect; the frontal-chest / PA-AP / field-of-view classification runs in Intake on our own GPU once analysis starts (a non-chest film stops there with the reason), because no model runs in the browser.
5. **Duplicate check.** Hash the decoded pixels; if it matches an existing study, `attention` with a link to it.
6. **Upload** the de-identified, possibly redacted object with the user's details. As built: the browser uploads the decoded pixels only, as a lossless PNG, so no DICOM tag or photo metadata can leave the machine at all; files go to a private staging area first and become a study only on **Start analysis**. The server re-validates (tag scan, size) and starts analysis (§5.1). The "Received" trace step records: source `upload`, format, removed-tag count, redactions, overrides.

Sizes: ≤ 50 MB per file; ≥ 1024 px short side recommended (smaller files are flagged, not blocked). Keep decoded pixel buffers out of memory once uploaded.

## 6. Engineering changes, in order

1. **Analyze on ingest + stream findings** (§5.1). Removes the 25 s blank wait.
2. **Background report and note drafting** (§5.2). Removes the 15 s and 9 s waits.
3. **Viewer with `object-fit: contain`, markers per region, measurement overlay** (§4.0, §4.4).
4. **Review list: verdict, Accept all, inline edit, keyboard** (§4.4, §5.3).
5. **Replace `alert()` with the toast + signed strip; PDF via Blob download** (§5.4, §5.5).
6. **Inline SVG icons; remove the icon font** (fixes the ☐ glyphs).
7. **Layout: header, step rail, breadcrumb, 1240 px column / two-pane** (§2.2, §4.0).
8. **Consent and attestation as single, explained gates** (§4.5, §4.6).
9. **Trace model + console panel and page** (§4.8, §4.9, §5.7).
10. **Welcome page** (§4.1).
11. **Upload a study: panel, queue, client-side de-identification and checks** (§4.10, §5.10).
12. **Study source: sections, tags, ID prefixes, delete/reset, provenance in trace and PDF** (§4.11).

Each item is done when its screen's acceptance criteria pass and the demo path (§1.2) completes end to end in a browser.

## 7. Open questions

- **PA vs AP.** The sample card says PA; the pipeline (study-type step and console) says AP. The UI shows the pipeline's value; decide which is right for the sample and make the label and detection agree.
- **Confidence thresholds.** The bands here (high ≥ 0.85, moderate ≥ 0.6) are a UI convention; confirm against the model's calibration.
- **Patient note pre-drafting.** Allowed before signing (this spec) or only after, for policy reasons? If only after, keep the UI but show "Drafts after you sign" on the tab and make the Share step's first paint a skeleton inside the note card, not a blank pane.
- **Clinic identity.** The note shows "Dr. Demo Clinician · Acme Health"; the real clinic name, reply number and date format need a source.
- **Unknown fixtures.** Samples 3 and 4 need age/sex and indication.
- **Upload policy.** Is uploading real (even de-identified) patient films allowed in the research prototype, or only synthetic data? If only synthetic, keep the flow but make the per-file identifier checkbox read "This is a synthetic or public-dataset image" and say so in the panel footer.
- **Upload visibility.** §4.11 makes uploads private to the uploader. If the hackathon build has a single shared demo login, treat "visible to you only" as visible to that login and keep the wording; revisit when real accounts exist.
- **DICOM decoding.** Which decoder (e.g. a WASM build) is acceptable for the hackathon build, and are compressed transfer syntaxes (JPEG 2000, JPEG-LS) in scope? Out of scope → flag as `failed` with "Export as uncompressed DICOM, JPEG or PNG".
