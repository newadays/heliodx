/** design/CLAUDE.md non-negotiables: no native dialogs, no window.open, no icon font. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

describe("web non-negotiables", () => {
  const src = files(join(__dirname, ".."));
  it.each([
    ["alert(", /\b(window\.)?alert\(/],
    ["confirm(", /\b(window\.)?confirm\(/],
    ["prompt(", /\bwindow\.prompt\(|[^.\w]prompt\(/],
    ["window.open", /window\.open\b/],
    ["icon fonts", /vector-icons|MaterialIcons|font-awesome/i],
  ])("never uses %s", (_name, pattern) => {
    const hits = src.filter((f) => pattern.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  // As built: Muse Wonder coordinates, Muse Glimmer runs the agents. A design
  // package re-sync once brought back "Muse Spark"; fail the build instead.
  it("never names Muse Spark in the app or the design docs", () => {
    const docs = [join(__dirname, "../../../design/SPEC.md"), join(__dirname, "../../../design/mockups/welcome.html")];
    const hits = [...src, ...docs].filter((f) => /Muse Spark/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
