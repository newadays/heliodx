import { describe, expect, it } from "vitest";

import { initials, provenanceLine, receivedLine, studyLine } from "@/utils/studySource";

const upload = {
  source: "upload" as const,
  clinicianName: "Dr. Demo Clinician",
  studyType: "Chest X-ray (PA)",
  caseId: "U-7K2P",
  details: { age: 47, sex: "F" as const, indication: null, view: "PA" as const },
  upload: { format: "dicom" as const, removedTags: 14, kept: {}, redactions: [{ x: 0, y: 0, w: 1, h: 1 }], textKept: false, overrides: [], pixelHash: "", width: 1, height: 1, contribution: { given: true, text: "", at: null } },
};
const sample = { source: "sample" as const, clinicianName: "Dr. Demo Clinician", studyType: "Chest X-ray (AP)", caseId: "S-AI2Y7", demo: { sampleId: "s1", age: 34, sex: "M" as const, indication: null } };

describe("study source wording (§4.11)", () => {
  it("reads uploads and samples apart in words", () => {
    expect(studyLine(upload)).toBe("PA · DICOM · 14 tags removed · 1 redaction");
    expect(studyLine(sample)).toBe("AP · NIH ChestX-ray14");
    expect(receivedLine(upload)).toBe("Chest X-ray · PA · 47 F · uploaded by DC · DICOM · 14 tags removed · 1 redaction");
    expect(receivedLine(sample)).toBe("Chest X-ray · AP · 34 M · from sample S-AI2Y7");
    expect(provenanceLine(upload)).toBe("Uploaded DICOM · de-identified in browser · 14 tags removed · 1 redaction");
    expect(provenanceLine(sample)).toBe("NIH ChestX-ray14 · synthetic patient");
  });

  it("JPEG and PNG uploads say their metadata was removed", () => {
    expect(studyLine({ ...upload, upload: { ...upload.upload, format: "jpeg", removedTags: 0, redactions: [] } })).toBe("PA · JPEG · metadata removed");
  });

  it("initials drop titles", () => {
    expect(initials("Dr. Demo Clinician")).toBe("DC");
    expect(initials("Ada")).toBe("A");
    expect(initials("")).toBe("—");
  });
});
