# Where patient data may and may not go

HelioDX handles protected health information (PHI): patient details,
clinical context, medical images and the findings and notes drafted from
them. This page is the contract every new code path is held to.

## May hold PHI

| Place | Why | Guard |
|---|---|---|
| Firestore `studies/*`, `organizations/*`, `users/*` | the product's data | `firestore.rules`: organization-scoped by the `orgId` claim; uploads owner-only, workspace samples shared in the demo org |
| Cloud Storage `studies/{org}/{uid}/{studyId}/*` | originals, thumbnails, overlays, note PDFs | `storage.rules`: owner read, owner write of the original only; samples readable in their org |
| Clinical model calls (our private Cloud GPU: Muse Glimmer, SAM 3.1) | the model needs the image and clinical context to draft | server-side only, route `clinical` in `functions/src/models/routes.ts`; prompts never include names; no fallback to any hosted API |
| The patient note PDF | the patient receives their own note | written from the signed report only and checked against it (`functions/src/lib/shareRules.ts`, `sharePdf.ts`); never findings or the image |
| The clipboard ("Copy report") | the clinician pastes into a record system | `utils/reportText.ts` omits patient identifiers |

## Must never hold PHI

| Place | Guard |
|---|---|
| Coordination calls (Meta Model API: Muse Wonder) | route `coordination` refuses images and any context key outside an allowlist of de-identified queue fields |
| Uploaded files, before they leave the browser | `web/src/upload/`: only the decoded pixels go up, as a PNG; DICOM tags, photo metadata and the file name stay local; burned-in text is redacted or explicitly kept; ages over 89 become 90+ |
| The OCR download | tesseract.js fetches its engine and English model from a CDN; no image data is sent |
| Cloud Functions logs | structured `{studyId, step, code, ms, tokens}`; never prompt or response text, never image bytes |
| Trace `prompt` / raw output | stored for the demo organization only (tested) |
| URLs and deep links | study ids and case ids only |

## Review checklist for a new call site

1. Is the value an enum, a count, a boolean or a document id? Then it may be logged.
2. Does it come from `study.patient`, `clinicalContext`, a finding or a note? Then it may not go anywhere in the "never" table.
3. For Functions, log through `logger.*` with an object, not a template string.

```sh
grep -rn "logger\.\(info\|warn\|error\)" functions/src | grep -i "patient\|prompt\|text"
```

This returns nothing.
