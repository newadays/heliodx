# Known risks and how HelioDX handles them

Living list for the v1 pilot. Each entry names the risk, what the code does
today, and what remains open.

## AI drafting

- **Model refusals or safety blocks.** Safety is `BLOCK_ONLY_HIGH`; the
  system instruction frames output as draft observations for a licensed
  clinician. A refusal becomes `failed/model_refused`; the clinician can retry
  or start over. Open: no appeal path other than retry.
- **Confident errors.** Every finding is `pending` until the clinician
  accepts, edits or rejects it; summaries cannot be shared until each finding
  has a decision; every screen carries the "AI-drafted, not a diagnosis"
  disclaimer. Open: no second-reader workflow.
- **Approximate regions.** Boxes come from the model on a 0–1000 grid and are
  drawn as soft ellipses; a region can be absent. Clinicians review the image,
  not the box.
- **Normal studies.** The prompt asks for pertinent normals so a normal film
  still yields reviewable, shareable findings; an empty list is allowed when
  the image cannot be read.
- **Private model service is a single point of failure.** Clinical calls go
  only to our Cloud Run GPU (Muse Glimmer, SAM 3.1) and never fall back to a
  hosted API. If the GPU is down or cold, studies fail with
  `model_unavailable`. It must stay warm (min instances 1) during clinic
  hours; a cold start takes 1 to 4 minutes.
- **Draft quality.** Glimmer's findings quality is not yet measured against
  labelled films (the eval cards).
- **Hosted model ids and format.** Verified 2026-10-27 against the Meta Model
  API: `muse-wonder-1.0` and `muse-voice-transcribe-1.0` exist, and
  `json_schema` output works. Reasoning tokens count against `max_tokens`,
  so the client adds 4,000 tokens of headroom to every call. Dictation
  (verified 2026-10-29): `POST /v1/asr/transcribe`, multipart with a JSON
  `request` part (`model`, `audioEncoding: "WAV"`) and an `audio` part (mono
  PCM16 WAV); about 1 s for a short clip. Medical terms can be misheard
  ("pleural" came back as "plural"), so the clinician edits the text before
  saving.
- **Latency and cost.** Muse Glimmer is a dense 30B model. On one RTX PRO
  6000 at full precision it is expected to generate roughly 20 to 30 tokens
  a second, so upload to draft is estimated at 60 to 100 s with low reasoning.
  The 4-bit variant would be roughly three times faster at some quality risk.
  Measured in card B8. `maxInstances` caps
  concurrency; the project has a monthly budget alert.

## Data and privacy

- See `docs/phi-boundaries.md`. Logs carry ids and codes only.
- **Accounts.** Self sign-up is turned off in Firebase Authentication;
  accounts are created by an admin (`demo-user`, `invite`), and each password
  is set through a one-time link.
- **Patient note.** Only a PDF is produced for now (SPEC §4.6a); the
  clinician hands it over. Its download link lasts 15 minutes.
- **Uploads.** De-identified in the browser, but the clinician confirms the
  image has no identifiers; the burned-in text check reads only the film's
  edges and can miss text.
- **Clipboard** ("Copy report") holds clinician text without identifiers until
  the clinician pastes or copies something else.

## Operations

- **Signed URLs** need `roles/iam.serviceAccountTokenCreator` on the runtime
  service account; the error appears at call time, not deploy time. The role
  was granted in card 3.1; the emulator uses an unsigned fallback.
- **Storage trigger retries are off.** A redelivered event is ignored via
  `pipeline.runId`; a genuine failure is written to the study and the
  clinician retries through `retryPipeline`, which also unsticks a study that
  has gone quiet for four minutes.
- **EU data residency.** Firestore, Storage, the Cloud Functions and the
  GPU service all run in the EU, and images and clinical text stay
  there. Calls to the Meta Model API (de-identified queue state) leave the
  EU unless Meta states otherwise.
- **One Google Cloud project for dev and prod.** Data is not separated.
  Splitting projects later means a second `.firebaserc` alias and env files.
- **Emulators need Java 21+.** Documented in the README.

## Product gaps (v1)

- Compressed DICOM is not supported; the upload panel asks for an
  uncompressed DICOM, JPEG or PNG.
- No patient directory; each study carries its own details.
- No admin screens; members are added from the CLI.
