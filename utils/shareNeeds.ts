/**
 * Plain-text versions of the backend's share refusals (card B17), mirroring
 * `NEED_TEXT` in `functions/src/callables/shareStudy.ts`.
 */
export type ShareNeed =
  | "write_summary"
  | "confirm_steps"
  | "consent"
  | "step_adds_instruction"
  | "body_names_condition"
  | "channel_off"
  | "no_phone"
  | "no_email";

const TEXT: Record<ShareNeed, string> = {
  write_summary: "Write the patient summary from your signed report.",
  confirm_steps: "Confirm each next step.",
  consent: "Record that the patient agreed to receive it.",
  step_adds_instruction: "A next step says something your signed report doesn't. Edit it to match the report.",
  body_names_condition: "The summary names a condition your signed impression doesn't. Edit it.",
  channel_off: "Your organization has turned this channel off.",
  no_phone: "Add the patient's phone number first.",
  no_email: "Add the patient's email address first.",
};

export function shareNeedText(need: string, steps: number[] = []): string {
  if (need === "step_adds_instruction" && steps.length) {
    const which = steps.length === 1 ? `Step ${steps[0]} says` : `Steps ${steps.join(", ")} say`;
    return `${which} something your signed report doesn't. Edit to match the report.`;
  }
  return TEXT[need as ShareNeed] ?? "Something needs attention before sharing.";
}

/** Consent wording for the share sheet. */
export function consentLabel(firstName: string, channel: "whatsapp" | "email" | "pdf"): string {
  const how = channel === "whatsapp" ? "by WhatsApp" : channel === "email" ? "by email" : "as a printed or saved PDF";
  return `${firstName} agreed to receive this ${how}.`;
}
