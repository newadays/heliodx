import { describe, expect, it } from "vitest";

import { canRetry, STALE_AFTER_MS } from "../src/callables/retryPipeline";
import { inviteAllowed, parseRole } from "../src/lib/members";

describe("inviteAllowed", () => {
  const domains = ["kubimedical.org", "kubi.health"];

  it("accepts a normalized email on an organization domain", () => {
    expect(inviteAllowed("  B.Okafor@KubiMedical.org ", domains)).toEqual({ ok: true, email: "b.okafor@kubimedical.org" });
    expect(inviteAllowed("x@kubi.health", domains).ok).toBe(true);
  });

  it("refuses other domains and malformed addresses", () => {
    expect(inviteAllowed("x@gmail.com", domains)).toEqual({ ok: false, reason: "domain_not_in_org" });
    expect(inviteAllowed("not-an-email", domains)).toEqual({ ok: false, reason: "invalid_email" });
    expect(inviteAllowed("x@sub.kubimedical.org", domains).ok).toBe(false);
  });
});

describe("canRetry", () => {
  const now = 1_000_000_000;

  it("allows failed and queued studies", () => {
    expect(canRetry("failed", now - 1000, now)).toEqual({ ok: true });
    expect(canRetry("queued", null, now)).toEqual({ ok: true });
  });

  it("refuses studies that are not uploaded, already ready, or actively running", () => {
    expect(canRetry("uploading", null, now)).toEqual({ ok: false, reason: "not_uploaded" });
    expect(canRetry("ready", now, now)).toEqual({ ok: false, reason: "already_ready" });
    expect(canRetry("detecting", now - 30_000, now)).toEqual({ ok: false, reason: "in_progress" });
  });

  it("allows an in-flight study once it has gone quiet", () => {
    expect(canRetry("detecting", now - STALE_AFTER_MS, now)).toEqual({ ok: true });
    expect(canRetry("summarizing", null, now)).toEqual({ ok: false, reason: "in_progress" });
  });
});

describe("parseRole", () => {
  it("accepts the three roles and falls back to clinician for anything else", () => {
    expect(parseRole("admin")).toBe("admin");
    expect(parseRole("radiologist")).toBe("radiologist");
    expect(parseRole("clinician")).toBe("clinician");
    for (const bad of [undefined, null, "", "superuser", "ADMIN", 1]) expect(parseRole(bad)).toBe("clinician");
  });
});

