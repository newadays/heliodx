# Agent console components

One reference implementation per component, lifted from `mockups/console.html` and `mockups/worklist-console.html`. Values reference `tokens.css`; the literal hex is given so the mockup CSS and the tokens line up.

Conventions: real elements (`<button>`, `<a href>`, `<select>` + `<label>`); hit targets 44 px (36 px only in the panel header); inline SVG icons 16 px, `fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`, `aria-hidden="true"`. Font: IBM Plex Sans; numbers in IBM Plex Mono with `font-variant-numeric: tabular-nums`.

## Shell (shared with the app)

Header 56 px, white, bottom border `#E1E5EA`: logo lockup (`assets/heliodx-lockup.png`, 34 px high) · environment chip `.hx-chip--env` ("Research prototype · synthetic data · not for clinical use") · spacer · breadcrumb (13 px, muted; current item ink 600) · 34 px black avatar disc.

## Chips and tags

```css
.hx-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:600;line-height:1;white-space:nowrap}
.hx-chip--ok{background:#E6F4EA;color:#137A3A}        /* Live */
.hx-chip--warn{background:#FDECEA;color:#B42318}      /* Failed · Escalated */
.hx-chip--neutral{background:#EDF0F3;color:#3D444D}   /* counts · Running · Awaiting review · filtering */
.hx-chip--ink{background:#15181C;color:#fff}          /* Signed · Shared */
.hx-chip--env{background:#fff;color:#15181C;border:1px solid #15181C}
.hx-tag{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;font-size:11.5px;font-weight:600;background:#EDF0F3;color:#3D444D;white-space:nowrap}   /* agent: Intake · Clinician · Sample · Upload */
.hx-tag--model{background:#15181C;color:#fff}         /* Glimmer · SAM 3.1 */
.hx-src{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:5px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1}
.hx-src--sample{background:#fff;color:#5F6873;border:1px dashed #9AA0A6}
.hx-src--up{background:#15181C;color:#fff}
```

Uppercase label: `font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#5F6873`.

## Buttons

```css
.hx-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border-radius:8px;font:inherit;font-weight:600;font-size:14px;border:1px solid transparent;white-space:nowrap;color:#15181C}
.hx-btn--primary{background:#15181C;color:#fff} .hx-btn--primary:hover{background:#000}
.hx-btn--secondary{background:#fff;border-color:#C9CFD6} .hx-btn--secondary:hover{background:#F4F6F8}
.hx-btn--secondary.is-on{background:#15181C;color:#fff;border-color:#15181C}   /* the worklist's "Agent console" while the panel is open; aria-pressed="true" */
.hx-btn--ghost{background:transparent;color:#15181C;padding:0 10px}
.hx-btn--sm{min-height:36px;padding:0 12px;font-size:13px}
.hx-ib{width:44px;height:44px;padding:0;border-radius:8px;border:1px solid transparent;background:transparent;color:#3D444D;display:inline-flex;align-items:center;justify-content:center} .hx-ib:hover{background:#EDF0F3;color:#15181C}
.hx-ib--sm{width:36px;height:36px}      /* panel header only */
```

## Pulse dot

`.hx-pulse{width:8px;height:8px;border-radius:50%;background:#16A34A;animation:pulse 1.2s ease-in-out infinite}` with `@keyframes pulse{0%,100%{transform:scale(.8);opacity:.5}50%{transform:scale(1.15);opacity:1}}`. Under `prefers-reduced-motion: reduce` the dot is static.

## Statistics tile

```css
.hx-stat{display:flex;flex-direction:column;gap:3px;padding:12px 14px;background:#fff;border:1px solid #E1E5EA;border-radius:10px;min-width:0}
.hx-stat__v{font-family:mono;font-size:20px;font-weight:600;line-height:1.1}
.hx-stat__k{font-size:12px;color:#5F6873}
.hx-stat--good .hx-stat__v{color:#137A3A}   /* checks failed = 0 */
.hx-stat--bad .hx-stat__v{color:#B42318}    /* checks failed > 0 */
```
Panel variant: `padding:10px 12px;background:#F4F6F8;border:0;border-radius:8px`, value 15 px, label 11.5 px. Grids: page `repeat(auto-fit, minmax(min(128px,100%),1fr))` gap 10 px; panel `repeat(auto-fit, minmax(min(96px,100%),1fr))` gap 8 px.

## Side panel

```html
<aside aria-label="Agent console" class="hx-panel">     <!-- flex 0 1 480px; max-width 100%; white; border-left 1px #E1E5EA; column -->
  <div class="hx-panel__hd">                             <!-- flex; gap 10px; padding 12px 16px 12px 20px; border-bottom -->
    <h2>Agent console</h2> <span class="hx-chip hx-chip--ok"><span class="hx-pulse"></span>Live</span>
    <div style="flex:1 1 auto"></div>
    <a class="hx-btn hx-btn--secondary hx-btn--sm" href="/console/S-AI2Y7">Open full console</a>
    <button class="hx-ib hx-ib--sm" aria-label="Close console">×</button>
  </div>
  <div class="hx-panel__body">                           <!-- padding 16px 20px; column; gap 16px; flex 1 -->
    <a class="hx-running" href="…">…Running now…</a>     <!-- flex; gap 10px; padding 10px 12px; border 1px #BFE3CB; bg #F0FAF3; radius 8px; 13px -->
    <label>Case <select>…</select></label>               <!-- select: min-height 40px; border 1px #C9CFD6; radius 8px; width 100% -->
    <div class="hx-stats">…4 tiles…</div>
    <ol class="hx-timeline">…</ol>
  </div>
  <div class="hx-panel__ft">…note · Export trace…</div>  <!-- padding 12px 20px; border-top -->
</aside>
```

Timeline entry:

```css
.hx-ev{display:grid;grid-template-columns:18px minmax(0,1fr);gap:12px;align-items:start}
.hx-ev__rail{display:flex;flex-direction:column;align-items:center;align-self:stretch}
.hx-ev__rail>span{width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #137A3A;margin-top:6px}     /* system / model */
.hx-ev__rail>i{display:block;width:2px;flex:1 1 auto;background:#E1E5EA;min-height:16px}
.hx-ev--human .hx-ev__rail>span{border-color:#15181C;background:#15181C}                                                /* clinician */
.hx-ev--last .hx-ev__rail>i{display:none}
.hx-ev__body{display:flex;flex-direction:column;gap:5px;padding-bottom:16px;min-width:0}
```
Body: title row (`<strong>` · mono 12 px time · tags · spacer · mono 12 px "2.7 s · 1 726 tok") · 13 px summary in `#3D444D` · "Open trace" 12.5 px 600 link on model steps.

## Agents & tools panel (page)

`<aside aria-label="Agents and tools">`, `flex: 0 1 320px`, white, right border. Header: h2 + neutral chip "5 · 11" + 44 px collapse button (`aria-expanded`). Collapsed: a 48 px rail with one 44 px expand button.

```css
.hx-agent{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid #E1E5EA;border-radius:10px;background:#fff}
.hx-agent__hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}      /* name · .hx-tag--model… · spacer · status dot */
.hx-agent p{font-size:12.5px;color:#3D444D}
.hx-dot{width:8px;height:8px;border-radius:50%;background:#137A3A}          /* ran */
.hx-dot--idle{background:transparent;border:1.5px solid #C9CFD6}           /* did not run */
.hx-dot--running{background:#16A34A;animation:pulse 1.2s ease-in-out infinite}

.hx-tool{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 0;border-top:1px solid #E1E5EA} .hx-tool:first-child{border-top:0}
.hx-tool code{font-family:mono;font-size:12.5px;font-weight:600;color:#15181C;word-break:break-word} .hx-tool code span{font-weight:500;color:#5F6873}
.hx-tool p{font-size:12px;color:#5F6873;margin-top:3px}
.hx-tool__ct{font-family:mono;font-size:12px;color:#3D444D;background:#EDF0F3;border-radius:5px;padding:2px 6px} .hx-tool__ct.is-zero{color:#9AA0A6;background:transparent}
.hx-tool.is-filtering{background:#F4F6F8;margin:0 -18px;padding-left:18px;padding-right:18px}   /* + a .hx-chip--ink "filtering" with a clear × */
```

## Run header

Label "Run" · `<select aria-label="Select a run">` (min-width 360 px, 40 px, border `#C9CFD6`, radius 8 px) · status chip · running link (pulse + 13 px text). Second line 13 px muted with the source tag and mono case ID. Right: `.hx-btn--secondary` Export JSON · `.hx-btn--primary` Open in app.

## Trace table

```css
.hx-tr{display:grid;grid-template-columns:150px 84px minmax(160px,1fr) 80px 90px minmax(260px,2fr) 44px;gap:14px;align-items:center;padding:10px 16px;border-top:1px solid #E1E5EA;font-size:13.5px}
.hx-tr--head{border-top:0;background:#FAFBFC}           /* uppercase label cells */
.hx-tr.is-open{background:#F4F6F8}
.hx-tr__dot{width:8px;height:8px;border-radius:50%;background:#137A3A;display:inline-block} .hx-tr__dot--human{background:#15181C}
.hx-detail{background:#F4F6F8;border-top:1px solid #C9CFD6;border-bottom:1px solid #C9CFD6;padding:14px 16px 18px 46px;display:flex;flex-direction:column;gap:14px}
.hx-ptab{display:inline-flex;align-items:center;min-height:36px;padding:0 2px;border-bottom:2px solid transparent;font-weight:500;color:#5F6873;font-size:13px} .hx-ptab.is-cur{color:#15181C;border-color:#15181C;font-weight:600}
```
Card wrapper: `min-width: 980px` inside `overflow-x: auto`. The expand control is a 44 px `.hx-ib` `<button aria-expanded>` with a chevron that flips when open. Detail grid: `repeat(auto-fit, minmax(min(280px,100%),1fr))`, gap 20 px; lists 13.5 px in `#3D444D`; actions row: `.hx-btn--secondary.hx-btn--sm` "Copy trace link" · `.hx-btn--ghost.hx-btn--sm` "Replay this step" · muted 12.5 px note.

## Toast

Bottom-centre, 360–480 px, ink background, white 14 px text, radius 10 px, padding 12 px 16 px, close button 36 px, `role="status"`, 5 s, one at a time. Used here for "Trace link copied", "Export ready", and stream errors with a Retry action.
