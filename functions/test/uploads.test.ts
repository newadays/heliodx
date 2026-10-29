import { describe, expect, it } from "vitest";

import { describeUpload, validateUpload } from "../src/lib/uploads";
import { assertsCondition } from "../src/lib/vocabulary";

const meta = { fileName: "study.dcm", format: "dicom", removedTags: 14, kept: { modality: "CR", viewPosition: "PA" }, redactions: [{ x: 0.66, y: 0.04, w: 0.3, h: 0.09 }], textKept: false, overrides: [], pixelHash: "a".repeat(64), width: 2048, height: 2048 };

describe("uploads", () => {
  it("needs the research contribution and a label", () => {
    expect(validateUpload({ uploadId: "abcdefgh12", details: { label: "Upload 1" }, meta, contribution: false })).toMatchObject({ ok: false });
    expect(validateUpload({ uploadId: "abcdefgh12", details: { label: " " }, meta, contribution: true })).toMatchObject({ ok: false });
    expect(validateUpload({ uploadId: "../x", details: { label: "Upload 1" }, meta, contribution: true })).toMatchObject({ ok: false });
  });

  it("never stores the original file name, which can carry the patient's name", () => {
    const v = validateUpload({ uploadId: "abcdefgh12", details: { label: "Upload 1" }, meta: { ...meta, fileName: "DOE_JANE_MRN123.dcm" }, contribution: true });
    expect(v.ok && JSON.stringify(v.meta)).not.toMatch(/DOE|fileName/);
  });

  it("stores every age over 89 as 90", () => {
    const at = (age: number) => {
      const v = validateUpload({ uploadId: "abcdefgh12", details: { label: "Upload 1", age }, meta, contribution: true });
      return v.ok ? v.details.age : undefined;
    };
    expect([at(89), at(90), at(104), at(121)]).toEqual([89, 90, 90, null]);
  });

  it("normalizes details and metadata", () => {
    const v = validateUpload({ uploadId: "abcdefgh12", details: { label: "Upload 1 · 28 Oct", age: 47.4, sex: "F", view: "PA", indication: "Cough." }, meta: { ...meta, kept: { modality: "CR", "bad key!": "x" }, redactions: [{ x: 2, y: -1, w: 0.3, h: 0.1 }] }, contribution: true });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.details).toEqual({ label: "Upload 1 · 28 Oct", age: 47, sex: "F", view: "PA", indication: "Cough." });
    expect(v.meta.kept).toEqual({ modality: "CR" });
    expect(v.meta.redactions[0]).toEqual({ x: 1, y: 0, w: 0.3, h: 0.1 });
  });

  it("describes what the browser removed, never a condition", () => {
    const line = describeUpload({ ...meta, format: "dicom" } as never);
    expect(line).toBe("dicom · 14 identifying tags removed in the browser · 1 text area redacted");
    expect(assertsCondition(line)).toBe(false);
    expect(describeUpload({ ...meta, format: "jpeg", redactions: [], overrides: ["image small"] } as never)).toBe("jpeg · metadata removed in the browser · no text on film · analyzed anyway: image small");
  });
});
