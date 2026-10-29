import { describe, expect, it } from "vitest";

import { parseOriginalPath, stagingPath, studyDir, studyDirOf } from "../src/lib/storagePaths";

describe("storage layout", () => {
  it("puts every study and staged upload under its owner", () => {
    expect(studyDir("org", "u1", "s1")).toBe("studies/org/u1/s1");
    expect(stagingPath("org", "u1", "abcdefgh12")).toBe("studies/org/u1/staging/abcdefgh12.png");
  });

  it("finds a study's folder from its image, so older studies keep their place", () => {
    expect(studyDirOf("s1", { orgId: "org", clinicianUid: "u1", image: { storagePath: "studies/org/u1/s1/original.png" } })).toBe("studies/org/u1/s1");
    expect(studyDirOf("s1", { orgId: "org", clinicianUid: "u1", image: { storagePath: "studies/org/s1/original.jpg" } })).toBe("studies/org/s1");
    expect(studyDirOf("s1", { orgId: "org", clinicianUid: "u1" })).toBe("studies/org/u1/s1");
  });

  it("recognises originals in both layouts and nothing else", () => {
    expect(parseOriginalPath("studies/org/u1/s1/original.png")).toEqual({ orgId: "org", uid: "u1", studyId: "s1" });
    expect(parseOriginalPath("studies/org/s1/original.jpg")).toEqual({ orgId: "org", uid: null, studyId: "s1" });
    for (const name of ["studies/org/u1/s1/thumb.jpg", "studies/org/u1/staging/original.png", "studies/org/u1/s1/overlays/original.png", "uploads/u1/x.png", "studies/org/u1/staging/abcdefgh12.png"]) {
      expect(parseOriginalPath(name)).toBeNull();
    }
  });
});
