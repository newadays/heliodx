/**
 * Files are saved through a Blob and an `<a download>` click, never by opening
 * a tab a pop-up blocker can eat (SPEC §5.5).
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  saveBlob(await res.blob(), filename);
}

export function saveJson(data: unknown, filename: string): void {
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
}

/**
 * Hand-off to WhatsApp / the mail app in the same tab context, without
 * opening a window from script: a plain anchor click with target=_blank is a user-initiated
 * navigation the browser allows.
 */
export function openExternal(href: string, target: "_self" | "_blank" = href.startsWith("mailto:") ? "_self" : "_blank"): void {
  const a = document.createElement("a");
  a.href = href;
  a.target = target;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
