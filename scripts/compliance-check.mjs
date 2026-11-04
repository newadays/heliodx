#!/usr/bin/env node
/**
 * Compliance · fails when a banned term (compliance/banned-terms.txt) appears in
 * what HelioDX shows or prompts with: the web app and results site sources, the
 * model prompts and the README. Phrases in compliance/allowed-phrases.txt
 * (disclaimers, negations, the public datasets' own labels) are blanked first.
 * A line may opt out with a `compliance-allow: <reason>` comment.
 *
 *   node scripts/compliance-check.mjs            # exit 1 on a hit
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const patterns = (p) =>
  read(p)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => (l.startsWith("case:") ? new RegExp(l.slice(5), "g") : new RegExp(l, "gi")));

const banned = patterns("compliance/banned-terms.txt");
const allowed = patterns("compliance/allowed-phrases.txt");

/** UI sources: every non-test .ts/.tsx/.html under these folders. */
const SOURCE_DIRS = ["web/src", "site/src", "types", "functions/src/schemas"];
/** Model-facing and published text. */
const FILES = [
  "README.md",
  "web/index.html",
  "site/index.html",
  "functions/src/models/prompts.ts",
  "functions/src/lib/patterns.ts",
  "functions/src/lib/consoleManifest.ts",
  "functions/src/lib/sharePdf.ts",
  "functions/src/coordinator/plan.ts",
  "functions/src/models/fixtures.ts",
  "functions/scripts/seed.ts",
];
/** Tests hold banned words on purpose (they check the guard). */
const SKIP = [/\.test\.tsx?$/];

function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return walk(p);
    return /\.(tsx?|html)$/.test(n) && !SKIP.some((r) => r.test(p)) ? [p] : [];
  });
}

/** README: the eval results and citations describe public datasets' labels, not HelioDX output. */
function readmeScope(text) {
  const start = text.indexOf("## Eval results");
  const end = text.indexOf("\n## ", start + 1);
  const cite = text.indexOf("## License");
  return text
    .split("\n")
    .map((line, i, all) => {
      const at = all.slice(0, i).join("\n").length;
      return (start >= 0 && at >= start && at < end) || (cite >= 0 && at >= cite) ? "" : line;
    })
    .join("\n");
}

/** Code comments are not shown to anyone: blank them in .ts/.tsx (a `//` after a colon is a URL). */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const hits = [];
for (const file of [...FILES, ...SOURCE_DIRS.flatMap(walk)]) {
  let text = read(file);
  if (file === "README.md") text = readmeScope(text);
  if (/\.tsx?$/.test(file)) {
    // Keep the opt-out marker visible to the line check below.
    text = text.split("\n").map((l) => (l.includes("compliance-allow") ? "compliance-allow" : l)).join("\n");
    text = stripComments(text);
  }
  text.split("\n").forEach((raw, i) => {
    if (raw.includes("compliance-allow")) return;
    let line = raw;
    for (const a of allowed) line = line.replace(a, " ");
    for (const b of banned) {
      b.lastIndex = 0;
      const m = b.exec(line);
      if (m) hits.push(`${relative(ROOT, join(ROOT, file))}:${i + 1}: "${m[0]}" in ${raw.trim().slice(0, 140)}`);
    }
  });
}

if (hits.length) {
  console.error(`Compliance check failed: ${hits.length} banned term(s).\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("Compliance check passed: no banned terms.");
