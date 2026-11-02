# HelioDX evaluation site

Card E18. A static site that shows the evaluation of HelioDX against the
MedGemma 27B baseline, task by task. It reads one public results file at load
time: the file `npm run eval -- export … --bucket` writes (E17, see
`eval/README.md`), validated against `PublicResultsSchema`
(`functions/src/eval/publicSchema.ts`). No sign-in, no Firebase SDK, no
cookies or analytics, and no result data in the build: publishing new results
needs no redeploy.

- `/`: the results by family, TB screening (sensitivity and specificity with
  95% intervals), triage, hardware and models.
- `/tasks`: the task library, with family tabs, search and a grading filter.
- `/tasks/<id>`: one task, the recorded run per system, and each criterion
  with what earns credit (`src/criteria.ts`).
- `/methods`: what is held equal, the pipeline, grading, limits and
  attribution.
- `?run=<file>` on any page loads `results/runs/<file>` instead of
  `latest.json`.

## Develop

```sh
cd site && npm install
echo 'VITE_RESULTS_URL=https://storage.googleapis.com/<bucket>/results/latest.json' >> ../.env.development
npm run dev          # http://localhost:5180
npm test
```

The URL lives in the repo's gitignored `.env.<mode>` files, never in code. To
work offline, export a local file (`npm run eval -- export <runIds>` in
`functions/`) and point `VITE_RESULTS_URL` at a copy served by the dev server.

## Deploy (second Firebase Hosting site)

`firebase.json` has two Hosting targets: `app` (the clinician app, `dist/`)
and `evals` (this site, `site/dist/`). Once per machine:

```sh
npx firebase hosting:sites:create heliodx-evals --project heliodx
npx firebase target:apply hosting app heliodx --project heliodx
npx firebase target:apply hosting evals heliodx-evals --project heliodx
```

Then, with `VITE_RESULTS_URL` in `.env.production`:

```sh
npm run build:site                                          # site/ → site/dist
npx firebase deploy --only hosting:evals --project heliodx  # leaves the app untouched
```

## Custom domain (not done yet)

Firebase console → Hosting → the `heliodx-evals` site → Add custom domain →
`heliodx.com`. Add the TXT record it shows to prove ownership, then the A
records it lists, at the domain's DNS host. The certificate is issued once
the records resolve (up to 24 hours).
