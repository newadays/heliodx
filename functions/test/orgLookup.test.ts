import { describe, expect, it } from "vitest";

import { displayNameFromEmail, domainOf, mayBindByDomain, toSummary } from "../src/lib/orgLookup";

describe("domainOf", () => {
  it("lowercases and trims the domain", () => {
    expect(domainOf("A.Smith@KubiMedical.org")).toBe("kubimedical.org");
    expect(domainOf("x@sub.clinic.co.uk ")).toBe("sub.clinic.co.uk");
  });

  it("returns null for malformed addresses", () => {
    expect(domainOf("")).toBeNull();
    expect(domainOf(null)).toBeNull();
    expect(domainOf("no-at-sign")).toBeNull();
    expect(domainOf("@kubimedical.org")).toBeNull();
    expect(domainOf("a@")).toBeNull();
    expect(domainOf("a@localhost")).toBeNull();
  });
});

describe("displayNameFromEmail", () => {
  it("builds the design's 'A. Smith' from a dotted local part", () => {
    expect(displayNameFromEmail("a.smith@kubimedical.org")).toBe("A. Smith");
  });

  it("capitalises words and drops digits", () => {
    expect(displayNameFromEmail("bola_okafor2@x.org")).toBe("Bola Okafor");
    expect(displayNameFromEmail("jdoe@x.org")).toBe("Jdoe");
  });

  it("falls back when nothing usable remains", () => {
    expect(displayNameFromEmail("12345@x.org")).toBe("Clinician");
  });
});

describe("toSummary", () => {
  it("fills defaults for a sparse organization document", () => {
    expect(toSummary("kubi-medical", { name: "Kubi Medical" })).toEqual({
      id: "kubi-medical",
      name: "Kubi Medical",
      legalName: "Kubi Medical",
      logoPath: null,
      adminName: "",
      sharePolicy: { whatsapp: true, email: true, pdf: true, linkExpiryDays: 7 },
    });
  });

  it("keeps an explicit share policy", () => {
    const s = toSummary("o", { name: "O", sharePolicy: { whatsapp: false, linkExpiryDays: 3 } });
    expect(s.sharePolicy).toEqual({ whatsapp: false, email: true, pdf: true, linkExpiryDays: 3 });
  });
});

describe("mayBindByDomain", () => {
  it("allows a verified email", () => {
    expect(mayBindByDomain({ email: "a.smith@kubimedical.org", email_verified: true })).toBe(true);
  });

  it("refuses an unverified email, the self-registration attack", () => {
    expect(mayBindByDomain({ email: "intruder@kubimedical.org", email_verified: false })).toBe(false);
  });

  it("refuses when verification is missing or not a real boolean", () => {
    expect(mayBindByDomain({ email: "a@kubimedical.org" })).toBe(false);
    expect(mayBindByDomain({ email: "a@kubimedical.org", email_verified: "true" })).toBe(false);
  });

  it("refuses when there is no email", () => {
    expect(mayBindByDomain({ email_verified: true })).toBe(false);
  });
});
