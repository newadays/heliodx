/** Per-viewer conveniences in localStorage; every access may throw (private mode), so all are guarded. */
export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Not persisted; the choice still holds for this visit.
  }
}
