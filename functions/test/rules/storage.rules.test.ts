import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { member, ORG_A, ORG_B, setupEnv, UID_A1, UID_A2, UID_B1, unbound } from "./helpers";

let env: RulesTestEnvironment;

const jpeg = new Uint8Array(1024);
const pdf = new Uint8Array(1024);
const png = new Uint8Array(512);

// Every study's files sit under its owner: studies/{org}/{uid}/{study}/….
const S1 = "study0000000001";
const S2 = "study0000000002";
const dir = (study: string, uid = UID_A1, org = ORG_A) => `studies/${org}/${uid}/${study}`;

beforeAll(async () => {
  env = await setupEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.storage();
    for (const [path, type] of [
      [`${dir(S1)}/original.jpg`, "image/jpeg"],
      [`${dir(S1)}/thumb.jpg`, "image/jpeg"],
      [`${dir(S1)}/overlays/m1.png`, "image/png"],
      [`${dir(S1)}/shares/summary.pdf`, "application/pdf"],
      [`organizations/${ORG_A}/logo.png`, "image/png"],
      // A study stored before the per-user layout.
      [`studies/${ORG_A}/s1/original.jpg`, "image/jpeg"],
      [`studies/${ORG_A}/s1/overlays/m1.png`, "image/png"],
    ] as const) {
      await uploadBytes(ref(s, path), jpeg, { contentType: type });
    }
  });
});

describe("studies/{org}/{uid}/{study}/ — owner only", () => {
  it("the owner reads the original, thumbnail, overlays and share PDFs", async () => {
    const mine = member(env, UID_A1, ORG_A).storage();
    for (const f of ["original.jpg", "thumb.jpg", "overlays/m1.png", "shares/summary.pdf"]) {
      await assertSucceeds(getBytes(ref(mine, `${dir(S1)}/${f}`)));
    }
  });

  it("colleagues in the same organization, other organizations and unbound users can't read them", async () => {
    for (const ctx of [member(env, UID_A2, ORG_A), member(env, UID_A2, ORG_A, "admin"), member(env, UID_B1, ORG_B), unbound(env)]) {
      await assertFails(getBytes(ref(ctx.storage(), `${dir(S1)}/original.jpg`)));
      await assertFails(getBytes(ref(ctx.storage(), `${dir(S1)}/overlays/m1.png`)));
    }
    // Not even with a uid claim that names another org's folder.
    await assertFails(getBytes(ref(member(env, UID_A1, ORG_B).storage(), `${dir(S1)}/original.jpg`)));
  });

  it("no client writes an original, even the owner; the backend copies the staged upload in", async () => {
    await assertFails(
      uploadBytes(ref(member(env, UID_A1, ORG_A).storage(), `${dir(S2)}/original.jpg`), jpeg, {
        contentType: "image/jpeg",
        customMetadata: { clinicianUid: UID_A1 },
      }),
    );
  });

  it("rejects a missing or foreign tag, another person's folder, non-images and odd folder names", async () => {
    const s = member(env, UID_A1, ORG_A).storage();
    const path = `${dir(S2)}/original.jpg`;
    await assertFails(uploadBytes(ref(s, path), jpeg, { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(s, path), jpeg, { contentType: "image/jpeg", customMetadata: { clinicianUid: UID_A2 } }));
    await assertFails(uploadBytes(ref(s, path), pdf, { contentType: "application/pdf", customMetadata: { clinicianUid: UID_A1 } }));
    await assertFails(
      uploadBytes(ref(member(env, UID_A2, ORG_A).storage(), path), jpeg, { contentType: "image/jpeg", customMetadata: { clinicianUid: UID_A2 } }),
    );
    // (`staging/original.png` is just a staged upload; the pipeline trigger ignores staging/.)
    for (const folder of ["overlays", "shares"]) {
      await assertFails(uploadBytes(ref(s, `${dir(folder)}/original.png`), png, { contentType: "image/png", customMetadata: { clinicianUid: UID_A1 } }));
    }
  });

  it("thumbnails, overlays and share PDFs are never client-writable, not even by the owner", async () => {
    const s = member(env, UID_A1, ORG_A).storage();
    const meta = { customMetadata: { clinicianUid: UID_A1 } };
    await assertFails(uploadBytes(ref(s, `${dir(S1)}/thumb.jpg`), jpeg, { contentType: "image/jpeg", ...meta }));
    await assertFails(uploadBytes(ref(s, `${dir(S1)}/overlays/m2.png`), png, { contentType: "image/png", ...meta }));
    await assertFails(uploadBytes(ref(s, `${dir(S1)}/shares/note.pdf`), pdf, { contentType: "application/pdf", ...meta }));
  });
});

describe("studies/{org}/{uid}/staging/ (§4.10 uploads)", () => {
  const staged = (uid = UID_A1, name = "abcdefgh12.png") => `studies/${ORG_A}/${uid}/staging/${name}`;

  it("lets members stage a PNG in their own folder only", async () => {
    const mine = member(env, UID_A1, ORG_A).storage();
    await assertSucceeds(uploadBytes(ref(mine, staged()), png, { contentType: "image/png" }));
    await assertSucceeds(getBytes(ref(mine, staged())));
    await assertSucceeds(deleteObject(ref(mine, staged())));
    await assertFails(uploadBytes(ref(mine, staged(UID_A2)), png, { contentType: "image/png" }));
    await assertFails(getBytes(ref(member(env, UID_A2, ORG_A).storage(), staged())));
  });

  it("refuses other types, names and accounts without an organization", async () => {
    const mine = member(env, UID_A1, ORG_A).storage();
    await assertFails(uploadBytes(ref(mine, staged(UID_A1, "abcdefgh13.dcm")), png, { contentType: "application/dicom" }));
    await assertFails(uploadBytes(ref(mine, staged(UID_A1, "abcdefgh14.png")), png, { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(unbound(env, "uid-x").storage(), `studies/${ORG_A}/uid-x/staging/abcdefgh15.png`), png, { contentType: "image/png" }));
  });

  it("the old top-level uploads/ folder is closed", async () => {
    await assertFails(uploadBytes(ref(member(env, UID_A1, ORG_A).storage(), `uploads/${UID_A1}/abcdefgh12.png`), png, { contentType: "image/png" }));
  });
});

describe("the old studies/{org}/{studyId}/ layout", () => {
  it("is closed: no reads, no writes", async () => {
    await assertFails(getBytes(ref(member(env, UID_A2, ORG_A).storage(), `studies/${ORG_A}/s1/original.jpg`)));
    await assertFails(
      uploadBytes(ref(member(env, UID_A1, ORG_A).storage(), `studies/${ORG_A}/s3/original.jpg`), jpeg, {
        contentType: "image/jpeg",
        customMetadata: { clinicianUid: UID_A1 },
      }),
    );
  });
});

describe("studies/{org}/samples/ (§4.11)", () => {
  it("members of the organization read sample files; nobody writes them from a client", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "studies/demo/samples/study0000000009/original.jpg"), jpeg, { contentType: "image/jpeg" });
    });
    const path = "studies/demo/samples/study0000000009/original.jpg";
    await assertSucceeds(getBytes(ref(member(env, "uid-demo-1", "demo", "demo").storage(), path)));
    await assertSucceeds(getBytes(ref(member(env, "uid-demo-2", "demo", "demo").storage(), path)));
    await assertFails(getBytes(ref(member(env, UID_A1, ORG_A).storage(), path)));
    await assertFails(
      uploadBytes(ref(member(env, "uid-demo-1", "demo", "demo").storage(), "studies/demo/samples/study0000000010/original.jpg"), jpeg, {
        contentType: "image/jpeg",
        customMetadata: { clinicianUid: "uid-demo-1" },
      }),
    );
  });
});

describe("organizations/", () => {
  it("members read the logo; others and writes are denied", async () => {
    await assertSucceeds(getBytes(ref(member(env, UID_A1, ORG_A).storage(), `organizations/${ORG_A}/logo.png`)));
    await assertFails(getBytes(ref(member(env, UID_B1, ORG_B).storage(), `organizations/${ORG_A}/logo.png`)));
    await assertFails(
      uploadBytes(ref(member(env, UID_A1, ORG_A, "admin").storage(), `organizations/${ORG_A}/logo.png`), jpeg, { contentType: "image/png" }),
    );
  });
});

describe("samples/* (F11)", () => {
  it("demo accounts read sample images; nobody writes them from a client", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "samples/s1.jpg"), jpeg, { contentType: "image/jpeg" });
    });
    await assertSucceeds(getBytes(ref(member(env, "uid-demo", "demo", "demo").storage(), "samples/s1.jpg")));
    await assertFails(getBytes(ref(member(env, UID_A1, ORG_A).storage(), "samples/s1.jpg")));
    await assertFails(uploadBytes(ref(member(env, "uid-demo", "demo", "demo").storage(), "samples/s2.jpg"), jpeg, { contentType: "image/jpeg" }));
  });
});
