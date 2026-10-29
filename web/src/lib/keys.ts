/** Single-key shortcuts are ignored while typing (SPEC §5.3). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit"].includes(type);
  }
  return tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
