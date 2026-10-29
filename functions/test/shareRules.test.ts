import { describe, expect, it } from "vitest";

import { buildSharePdf, formatShareDate, pdfPatientName } from "../src/lib/sharePdf";
import { DEFAULT_SHARE_POLICY, isShareChannel, shareDecisions, shareNeeds, sharePolicyOf, type ShareableStudy, SENDING_CHANNELS_ENABLED } from "../src/lib/shareRules";

const study = (over: Partial<NonNullable<ShareableStudy["patientSummary"]>> = {}, top: Partial<ShareableStudy> = {}): ShareableStudy => ({
  signed: { reportHash: "sha256:r", name: "Dr. A. Smith" },
  report: { summary: { impression: ["Right lower zone opacity, possibly pneumonia."], recommendation: "Clinical correlation. Repeat chest X-ray in 6 weeks." } },
  patient: { name: "Jane Doe", phone: "+15550100", email: "jane@example.invalid" },
  patientSummary: {
    title: "A note",
    body: "Your X-ray shows a cloudy patch. It may be pneumonia.",
    nextSteps: [
      { text: "Your doctor will check how you feel.", mapsTo: 0, confirmed: true },
      { text: "You will have another X-ray in 6 weeks.", mapsTo: 1, confirmed: true },
    ],
    generatedFromReportHash: "sha256:r",
    generated: { body: "Your X-ray shows a cloudy patch. It may be pneumonia.", steps: ["Your doctor will check how you feel.", "You will have another X-ray in 6 weeks."] },
    ...over,
  },
  ...top,
});
const ok = { channel: "whatsapp" as const, consent: true };

describe("shareNeeds", () => {
  it("passes a confirmed summary written from the signed report, with consent", () => {
    expect(shareNeeds(study(), ok, DEFAULT_SHARE_POLICY)).toEqual({ needs: [], stepsAddingInstructions: [] });
  });

  it("refuses a summary not written from the signed report (missing, other hash, old string shape)", () => {
    expect(shareNeeds(study({}, { patientSummary: null }), ok, DEFAULT_SHARE_POLICY).needs).toEqual(["write_summary"]);
    expect(shareNeeds(study({ generatedFromReportHash: "sha256:other" }), ok, DEFAULT_SHARE_POLICY).needs).toEqual(["write_summary"]);
    expect(shareNeeds(study({ nextSteps: "Talk to your doctor." }), ok, DEFAULT_SHARE_POLICY).needs).toEqual(["write_summary"]);
  });

  it("§4.6a: a PDF needs neither step ticks nor consent; sending channels still need consent", () => {
    const s = study({ nextSteps: [{ text: "Your doctor will check how you feel.", mapsTo: 0, confirmed: true }, { text: "You will have another X-ray in 6 weeks.", mapsTo: 1, confirmed: false }] });
    expect(shareNeeds(s, { channel: "pdf", consent: false }, DEFAULT_SHARE_POLICY).needs).toEqual([]);
    expect(shareNeeds(s, { channel: "whatsapp", consent: false }, DEFAULT_SHARE_POLICY).needs).toEqual(["consent"]);
  });

  it("§4.6a: WhatsApp and email are off until sending returns, whatever the organization allows", () => {
    expect(SENDING_CHANNELS_ENABLED).toBe(false);
    const policy = sharePolicyOf({ whatsapp: true, email: true });
    expect(shareNeeds(study(), ok, policy).needs).toEqual(["channel_off"]);
    expect(shareNeeds(study(), { channel: "pdf", consent: true }, policy).needs).toEqual([]);
  });

  it("re-runs the B16 checks on the final text: an edited step or body can't add what the report lacks", () => {
    const s = study({
      body: "This could be cancer.",
      nextSteps: [
        { text: "Take antibiotics for 7 days.", mapsTo: 0, confirmed: true },
        { text: "You will have another X-ray in 6 weeks.", mapsTo: 1, confirmed: true },
      ],
    });
    expect(shareNeeds(s, ok, DEFAULT_SHARE_POLICY)).toEqual({ needs: ["step_adds_instruction", "body_names_condition"], stepsAddingInstructions: [1] });
  });

  it("checks the channel against policy and the study's contact details", () => {
    expect(shareNeeds(study(), ok, sharePolicyOf({ whatsapp: false })).needs).toEqual(["channel_off"]);
    expect(shareNeeds(study({}, { patient: { name: "J" } }), ok, DEFAULT_SHARE_POLICY).needs).toEqual(["no_phone"]);
    expect(shareNeeds(study({}, { patient: { name: "J" } }), { channel: "email", consent: true }, DEFAULT_SHARE_POLICY).needs).toEqual(["no_email"]);
    expect(shareNeeds(study({}, { patient: { name: "J" } }), { channel: "pdf", consent: true }, DEFAULT_SHARE_POLICY).needs).toEqual([]);
    expect(isShareChannel("sms")).toBe(false);
  });
});

describe("shareDecisions", () => {
  it("records confirmed and edited steps against the generated text", () => {
    const s = study({
      nextSteps: [
        { text: "Your doctor will check how you feel.", mapsTo: 0, confirmed: true },
        { text: "Another X-ray in 6 weeks will check it has cleared.", mapsTo: 1, confirmed: true, fromSignedText: true },
      ],
    });
    expect(shareDecisions(s)).toEqual({
      generatedFromReportHash: "sha256:r",
      summaryEdited: true,
      bodyEdited: false,
      steps: [
        { mapsTo: 0, confirmed: true, edited: false, fromSignedText: false },
        { mapsTo: 1, confirmed: true, edited: true, fromSignedText: false },
      ],
    });
    expect(shareDecisions(study()).summaryEdited).toBe(false);
  });
});

describe("sharePdf", () => {
  it("never prints an upload's pseudonym label as the patient's name", () => {
    expect(pdfPatientName({ source: "upload", patient: { name: "Upload 1 · 28 Oct" } })).toBe("");
    expect(pdfPatientName({ source: "sample", patient: { name: "Sample Patient 1" } })).toBe("Sample Patient 1");
    expect(pdfPatientName({})).toBe("");
  });

  it("renders a PDF and formats the date", async () => {
    const pdf = await buildSharePdf({
      orgName: "Kubi Medical",
      orgLegalName: "Kubi Medical Foundation",
      date: formatShareDate(new Date("2026-10-28T12:00:00Z")),
      patientName: "Jane Doe",
      title: "A note from Dr. A. Smith about your chest X-ray",
      body: "Your X-ray shows a cloudy patch.",
      steps: ["Your doctor will check how you feel.", "You will have another X-ray in 6 weeks."],
      attribution: "Reviewed and approved by Dr. A. Smith",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(formatShareDate(new Date("2026-10-28T12:00:00Z"))).toBe("28 October 2026");
  });
});

