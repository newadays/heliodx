import { describe, expect, it } from "vitest";

import { consentLabel, shareNeedText } from "./shareNeeds";

describe("shareNeedText", () => {
  it("names the steps that add an instruction", () => {
    expect(shareNeedText("step_adds_instruction", [2])).toBe("Step 2 says something your signed report doesn't. Edit to match the report.");
    expect(shareNeedText("step_adds_instruction", [1, 3])).toBe("Steps 1, 3 say something your signed report doesn't. Edit to match the report.");
    expect(shareNeedText("consent")).toBe("Record that the patient agreed to receive it.");
    expect(shareNeedText("unknown_need")).toBe("Something needs attention before sharing.");
  });
});

describe("consentLabel", () => {
  it("says how the patient agreed to receive it", () => {
    expect(consentLabel("Jane", "whatsapp")).toBe("Jane agreed to receive this by WhatsApp.");
    expect(consentLabel("Jane", "pdf")).toBe("Jane agreed to receive this as a printed or saved PDF.");
  });
});
