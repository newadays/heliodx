/** Small display helpers shared by the screens. */

export function initials(name: string): string {
  const words = name.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

/** "14:27" */
export function hhmm(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "14:27:04" */
export function hhmmss(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** "0:27", "1:05" */
export function mss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "831 ms", "2.7 s", "1:05" for durations. */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return mss(ms);
}

/** "6 568" with a thin space, as in the mockups. */
export function tokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}

/** Numbers in prose: at most two decimals, trailing zeros dropped. */
export function num(value: number, decimals = 2): string {
  return String(Number(value.toFixed(decimals)));
}

/** "today 14:33" or "28 Oct 14:33" */
export function dayTime(ms: number | null, now = Date.now()): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const same = new Date(now).toDateString() === d.toDateString();
  return same ? `today ${hhmm(ms)}` : `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${hhmm(ms)}`;
}
