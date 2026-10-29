# HelioDX — Agent console specification

Version 1 · 29 Oct 2026 · scope: the console side panel on the worklist and the dedicated console page. Companion files: `mockups/worklist-console.html`, `mockups/console.html`, `components.md`, `types.ts`, `tokens.css`.

## 1. Purpose

The console is where a clinician or a judge sees what the agents did to a study: which agents and tools exist, which ran, how long and how much they cost, what each step took in and produced, and where the clinician's own actions sit in the same timeline. Two surfaces share one model:

- **Side panel** (`/worklist?console=1`) — a 480 px panel beside the worklist for a quick look at the selected case while staying on the list.
- **Page** (`/console/:caseId`) — the full view: a collapsible Agents & tools panel, a run selector with status, a statistics row, and the trace table with expandable steps.

Both render the same `trace[]`, `RunManifest` and `RunStats`. The panel is a projection of the page, not a second model.

## 2. Side panel (`/worklist?console=1`)

Mockup: `mockups/worklist-console.html`.

- **Opening.** The worklist's "Agent console" button becomes pressed (ink fill, `aria-pressed="true"`). A 480 px `<aside aria-label="Agent console">` appears on the right; the worklist narrows and keeps its columns (it is not covered). Below 1180 px the panel stacks under the worklist. `Esc` closes it; the state (open/closed, selected case) persists across navigation to a study and back, and in the URL (`?console=1`).
- **Header.** h2 "Agent console" · ok chip "Live" with a pulsing dot (present while the panel holds a stream; otherwise "Connected" neutral or "Reconnecting…" neutral) · spacer · secondary 36 px "Open full console" (→ `/console/<selected case>`) · 36 px close button.
- **Running now strip** (green tint `#F0FAF3`, border `#BFE3CB`, a link): pulse + "**Running now:** <patient> · <step> · <elapsed> s" + "Follow" → that study's analyzing step. Hidden when nothing is running; when several run, shows the newest and "+N more".
- **Case `<select>`**, label "Case": options `"<patient label> · <caseId> · <status>"`, newest first; follows the row selected in the worklist (clicking a row selects it and tints it). Changing the select does not navigate.
- **Four stat tiles** — the first four of the page's row so the two surfaces agree: **Tool calls · Agent tokens · Agent time · Checks failed** (label "· K passed"; value green at 0, red above). Grid `repeat(auto-fit, minmax(min(96px, 100%), 1fr))`, 8 px gap; tiles update when a step completes.
- **Trace timeline**, one entry per `TraceStep` in order: rail dot (green ring for system/model steps, filled ink for clinician steps; the last step filled) · bold name · time (mono 12 px) · tags (agent neutral, models black) · right-aligned "<duration> · <tokens> tok" for model steps · one-line summary · "Open trace" link on model steps (→ page with that step expanded). The Received step's agent tag is **Sample** or **Upload** by source, and its summary ends with "from sample S-AI2Y7" or "uploaded by DC · JPEG · 14 tags removed".
- **Footer.** Muted "Model steps run on Glimmer; segmentation on SAM 3.1." (from the manifest's model list) · ghost "Export trace" (downloads `HelioDX-<caseId>-trace.json`, no new tab).
- **Live.** Steps append in real time for a running case; a running step shows a pulsing dot and "running · <elapsed>" in place of duration; tiles update on completion.

Acceptance: opening the panel does not reflow the worklist columns; `Esc` closes; the four tile values equal the page's for the same run; selecting a worklist row changes the panel's case without navigating; a running case shows steps arriving without reload; Export trace downloads without opening a tab.

## 3. Page (`/console/:caseId`)

Mockup: `mockups/console.html`.

### 3.1 Layout

Flex row that wraps: `<aside aria-label="Agents and tools">` (`flex: 0 1 320px`, white, right border) + `<main>` (`flex: 1 1 560px`, padding 22 px 28 px). Below 1180 px the aside stacks above the main. The app header (logo, environment chip, breadcrumb `Worklist › Agent console`, avatar) is the shared shell.

### 3.2 Agents & tools panel (left, collapsible)

- **Header.** h2 "Agents & tools" · neutral chip "<agents> · <tools>" · spacer · 44 px collapse button (`aria-expanded="true"`, chevron-left-with-bar icon, `aria-label="Collapse the agents and tools panel"`).
- **Collapsed.** The aside becomes a 48 px rail holding one 44 px expand button with the same icon and `aria-label="Show agents and tools"`; the main grows; the trace table's columns do not shift. State persists per user (`localStorage`); default expanded at ≥ 1280 px, collapsed below.
- **Agents · N** (label right: "in run order"). One card per `AgentDef`, ordered by `order`: name (bold) · model tags (black `tag--model`, e.g. Glimmer, SAM 3.1) · spacer · status dot — green filled when the agent ran in the selected run, grey outline when it did not, pulsing green while running. Under the header, the agent's one-sentence `role` from the manifest. Expected set: Coordinator, Intake, Triage, Prep, Summary (render whatever the manifest lists).
- **Tools available · N** (label right: "calls in this run"). One row per `ToolDef`: `name(params)` in mono (params at weight 500, muted) · one- or two-line `description` · right-aligned call count `×N` in a grey pill (`×0` quiet, no pill). Clicking a row filters the trace table to steps that called that tool: the row shows a black "filtering" chip with a clear ×, the table header reads "Steps that called `measure` · 2", and the filter is also in the URL (`?tool=measure`).
- **Footer note.** "Read from the run manifest. These are the only tools the agents can call; a step that needs anything else escalates."

### 3.3 Run header

- Label "Run". A `<select>` of runs for this workspace, newest first, option text `run-<ISO stamp>-<caseId lower> · <patient label> · <status>` (min-width 360 px, 40 px tall). Beside it the run status chip: `Running` (neutral, pulse) · `Awaiting review` (neutral) · `Signed` / `Shared` (ink) · `Failed` / `Escalated` (red). Then, when any run is in progress, a link "N running · <patient> · <step> · <elapsed> s" with a pulse (→ that study's analyzing step).
- Second line, muted 13 px: patient label · source tag (`SAMPLE` dashed outline / `UPLOADED` black) · case ID (mono) · modality · view · age/sex · indication · "arrived <HH:MM:SS>" · clinician.
- Right: secondary "Export JSON" (downloads `HelioDX-<caseId>-trace.json`) · primary "Open in app" (→ `/study/:caseId`).
- Routing: `/console/:caseId` selects that case's latest run; `?run=<runId>` selects a specific run; `?step=<traceId>` opens with that step expanded and scrolled into view; `?tool=<name>` applies the tool filter.

### 3.4 Statistics row

Grid `repeat(auto-fit, minmax(min(128px, 100%), 1fr))`, 10 px gap; white tiles, 1 px border, radius 10 px; value mono 20 px weight 600, label 12 px muted. Seven tiles, one row at 1440, computed from the run's trace:

| Tile | Value | Note |
| --- | --- | --- |
| Tool calls | sum of `ToolCall`s across model steps | |
| Agent tokens | sum of `tokens` | thousands separated by a thin space: `6 568` |
| Agent time | sum of model-step `durationMs` | `31.9 s` |
| Observations | count proposed by Prep | |
| Checks failed | count of failed checks; label "· K passed" | value green at 0, red above |
| Clinician steps | count of `kind: 'clinician'` steps | |
| Arrival to shared | Received → Shared | "Arrival to now" while the run is open |

Tiles update live for a running run. (Agent turns, Measurements and Escalations were cut as noise: turns and measurements live in the expanded step rows; an escalation is shown by the status chip and the escalating step.)

### 3.5 Trace table

- Card, `min-width: 980px` inside an `overflow-x: auto` box. Header row on `#FAFBFC`. Columns `150px 84px minmax(160px,1fr) 80px 90px minmax(260px,2fr) 44px`: **Step · Started · Agent · Duration · Tokens · Summary · expand**.
- Row: dot (green for system/model, ink for clinician) + bold name · time (mono, muted) · tags (agent neutral; models black) · duration (mono; "—" for clinician steps) · tokens (mono; "—") · summary (ink-2; model steps end with "· N tool calls") · 44 px expand button (`aria-expanded`).
- **Expanded row** (ground `#F4F6F8`, top/bottom border `#C9CFD6`, padding 14 px 16 px 18 px 46 px): tabs **Summary · Tool calls · N · Prompt · Raw output · Timing** (36 px, current underlined black); Summary shows a three-column `auto-fit` grid — **Inputs** (bulleted) · **Output** (numbered, e.g. the six observations) · **Tool calls** (per-tool counts + "Checks: K passed · F failed"); the Tool calls tab lists every call in order: tool, arguments (truncated, expandable), duration, result (`ok` neutral / `failed` red / `escalated` red). Actions: secondary 36 px "Copy trace link" (copies `/console/:caseId?step=<id>`), ghost "Replay this step" with the muted note "Replay runs the same inputs again without touching the signed case."
- A running step shows a pulsing dot, "running · <elapsed>" in Duration and a skeleton summary; a failed step shows a red "Failed" chip in Summary and its expand opens on the Tool calls tab.

Acceptance: stats equal what the trace contains (verify against Export JSON); collapsing the panel keeps the trace columns in place and the state survives reload; agents and tools come from the manifest, so a tool added server-side appears without a UI change; the tool filter applies, is reflected in the URL and is clearable; expanding a row does not shift other rows' columns; Export JSON downloads without a new tab; every tile and chip is readable in greyscale.

## 4. Data

Interfaces in `types.ts`. Summary:

- **TraceStep** — `id`, `name` (`Received | Intake | Triage | Prep | Signed | Patient note | Shared | …`), `kind` (`system | model | clinician`), `startedAt`, `agents[]`, `models[]`, `durationMs?`, `tokens?`, `summary`, `traceId?`, `status` (`done | running | failed | escalated`), `detail?` (`inputs[]`, `outputs[]`, `measurements[]`, `calls: ToolCall[]`, `checks[]`, `prompt?`, `raw?`, `timing[]`).
- **ToolCall** — `tool`, `args`, `startedAt`, `durationMs`, `result` (`ok | failed | escalated`), `checks?`.
- **RunManifest** — `runId`, `caseId`, `agents: AgentDef[]`, `tools: ToolDef[]`.
- **AgentDef** — `id`, `name`, `models[]`, `role`, `order`, `status?` (`ran | running | idle`, for the selected run).
- **ToolDef** — `name`, `params[]`, `description`, `ownerAgentId?`, `callsInRun?`.
- **RunStats** — `runId`, `status`, `toolCalls`, `agentTokens`, `agentTimeMs`, `observations`, `checksPassed`, `checksFailed`, `clinicianSteps`, `arrivalToSharedMs?` (plus `agentTurns`, `measurements`, `escalations` kept in the type for exports; not shown as tiles).
- **ConsoleCase** — the row shape for the panel's case select and the page's run select: `caseId`, `runId`, `patientLabel`, `source`, `status`, `arrivedAt`, `running?: { step, elapsedMs }`.

Case IDs carry their source prefix (`S-…` sample, `U-…` upload) everywhere they appear.

## 5. Live behaviour

- One stream per workspace (SSE or WebSocket) carrying `trace_step` (new or updated step, including `status: 'running'` heartbeats with elapsed), `run_stats`, and `run_status` events; both surfaces subscribe to it and filter by run.
- A dropped stream shows a slim "Reconnecting…" line (panel: under the header; page: under the run header) and retries with backoff; nothing already rendered is cleared.
- Expected elapsed ("usually under 0:30") comes from a rolling median of recent runs.

## 6. Fixtures (case S-AI2Y7, run `run-20261028T142704Z-s-ai2y7`, status Shared)

Use these so both surfaces match the mockups before the backend is wired.

Manifest — agents in order: Coordinator (Glimmer) "Plans the run, calls the agents in order and escalates to the clinician when a check fails." · Intake (Glimmer, SAM 3.1) "Checks image quality, confirms the study type and view, segments the lungs and heart." · Triage (Glimmer) "Takes the five measurements and sets routine or urgent priority from them and the indication." · Prep (Glimmer) "Proposes observations with evidence, confidence and a region on the film, plus the overlays, for the clinician to review." · Summary (Glimmer) "Writes the patient note from the signed report only and checks every sentence against it."

Tools (name · params · description · calls): `check_quality(image)` sharpness, brightness, clipping and rotation; fails the run below the thresholds · 1 — `confirm_study(image)` modality, body part and view; flags films that are not frontal chest · 1 — `segment_regions(image)` lung and heart masks from SAM 3.1 · 1 — `measure(regions, kind)` CTR, lung areas, L/R density ratio, costophrenic blunting · 5 — `set_priority(measurements, context)` routine or urgent · 1 — `propose_observation(measurement, limit)` one observation with evidence, confidence and region; never a diagnosis · 6 — `draw_overlay(kind, regions)` marker and measurement overlays · 2 — `draft_report(decisions)` findings, impression, recommendation from accepted observations only; re-runs as decisions change · 2 — `write_patient_note(signed_report)` plain language at grade ≤ 7, each sentence mapped to a signed sentence · 1 — `check_note(note, signed_report)` fails if any claim is outside the signed text · 1 — `escalate(reason)` hands the case to the clinician with a flag and stops the run · 0.

Trace:

| step | kind | at | agents / models | duration · tokens | summary |
| --- | --- | --- | --- | --- | --- |
| Received | system | 14:27:04 | Sample | 831 ms | Chest X-ray · PA · 34 M · from sample S-AI2Y7 |
| Intake | model | 14:27:05 | Intake · Glimmer · SAM 3.1 | 2.7 s · 1 726 | Quality pass · sharpness 97 · brightness 102 · clipped 9% · 2/2 regions segmented · 3 tool calls |
| Triage | model | 14:27:08 | Triage · Glimmer | 2.6 s · 386 | Priority routine · CTR 0.45 · asymmetry 0.02 · density ratio 1.09 · blunting 0 / 0 — all within limits · 6 tool calls |
| Prep | model | 14:27:10 | Prep · Glimmer | 21.2 s · 2 807 | Draft ready · 6 proposed observations · 5 measurements · 2 overlays · 8 tool calls |
| Signed | clinician | 14:33:26 | Clinician | — | 6 accepted · 1 edited · 0 rejected · signed by Dr. Demo Clinician |
| Patient note | model | 14:34:02 | Summary · Glimmer | 4.6 s · 1 649 | 1 next step mapped to a signed sentence · 0 claims outside the signed text · grade 7 · 2 tool calls |
| Shared | clinician | 14:36:10 | Clinician | — | 1 share · PDF · consent recorded |

Prep expanded — Inputs: image 1024 × 1024, quality pass from Intake · 2 segmented regions (SAM 3.1) · 5 triage measurements · clinical context: cough for two weeks. Output: the six observations (cardiac silhouette within expected limits; lung areas symmetric; lung densities symmetric; costophrenic angles sharp; no focal consolidation left; no focal consolidation right). Tool calls: `propose_observation` ×6 · `draw_overlay` ×2 · checks 6 passed · 0 failed.

Stats: tool calls 21 · agent tokens 6 568 · agent time 31.9 s · observations 6 · checks failed 0 (7 passed) · clinician steps 2 · arrival to shared 9:06.

Other runs for the selects: `run-20261028T205812Z-u-hpcq · Upload 1 · 28 Oct · in review`; `run-20261028T143104Z-s-trvfh · Sample Patient 3 · running` (Prep · 12 s).

## 7. Open questions

- **Agent and tool naming.** The manifest contents above are a reconstruction from the existing trace. Confirm the real registry (names, params, one-line descriptions) — the UI needs no change, but the fixtures and screenshots will.
- **Replay.** "Replay this step" assumes the backend can re-run a step with stored inputs without writing to the case. If not, hide the action rather than disabling it.
- **Workspace scope of the run select.** Samples are shared; uploads are private to the uploader (§4.11 of the full spec). The run list should apply the same visibility.

## 8. As built (29 Oct 2026)

- **Agent and tool naming (§7):** the manifest is `functions/src/lib/consoleManifest.ts` and uses the names the pipeline actually traces (`segment_region`, `measure_quality`, `measure_ratio`, `compare_area`, `measure_angle`, `compare_density`, `render_overlay`, `set_priority`, `propose_observations`, `check_patient_summary`, `map_next_steps`, `share_gate`, `render_pdf`, …), not the reconstruction in §6. `functions/test/consoleManifest.test.ts` fails when a traced name is missing. Agents are Intake, Triage, Prep and Summary; there is no Coordinator agent in the pipeline yet, so none is listed.
- **Replay (§7):** hidden. The backend cannot re-run a step without writing to the case.
- **Run select (§7):** one run per case (`run-<arrival ISO>-<caseId>`), with the worklist's visibility: the account's uploads plus the workspace samples.
- **Tool calls tile:** calls across model steps only, so it equals the sum of the rows' "· N tool calls" (§3.4; the §6 fixture's 21 vs 19 is inconsistent).
- **Checks failed:** a failed check the step recovered from is not counted; the Tool calls tab shows it as "failed · retried" (the note check passing on its retry) or "failed · overridden" (the clinician chose "Analyze anyway"). Trace order is by time, since `seq` restarts in every run.
- **Live:** Firestore listeners rather than SSE. The chip reads "Connected" until the first server answer, then "Live"; offline or after an error, "Reconnecting…" (with backoff), never clearing what is shown.
- **Arrival to now:** shown only while a run is open; a failed run shows "—".
