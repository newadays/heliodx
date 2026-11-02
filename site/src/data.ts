/**
 * E18 · Loads the public results file (E17) and keeps it for the session.
 * The URL comes from VITE_RESULTS_URL at build time; `?run=<file>` swaps
 * `latest.json` for `runs/<file>` in the same folder. Every file is checked
 * against the schema the eval code writes with, so a half-published or
 * outdated file shows the empty state instead of wrong numbers.
 */
import { useEffect, useState } from "react";

import { PublicResultsSchema, type PublicResults } from "@/functions/src/eval/publicSchema";

export type LoadState = { status: "loading" } | { status: "ready"; data: PublicResults } | { status: "missing" } | { status: "invalid"; issue: string };

/** The file to fetch: `latest.json`, or `runs/<file>` next to it when `?run=` names one. */
export function resultsUrl(base: string | undefined, search: string): string | null {
  if (!base) return null;
  const run = new URLSearchParams(search).get("run");
  if (!run || !/^[\w.-]+\.json$/.test(run)) return base;
  return base.replace(/[^/]*$/, `runs/${run}`);
}

export async function loadResults(url: string | null, fetcher: typeof fetch = fetch): Promise<LoadState> {
  if (!url) return { status: "missing" };
  let body: unknown;
  try {
    const res = await fetcher(url, { cache: "no-cache" });
    if (!res.ok) return { status: "missing" };
    body = await res.json();
  } catch {
    return { status: "missing" };
  }
  const parsed = PublicResultsSchema.safeParse(body);
  if (!parsed.success) return { status: "invalid", issue: parsed.error.issues[0]?.path.join(".") || "shape" };
  return { status: "ready", data: parsed.data };
}

let cache: { url: string | null; promise: Promise<LoadState> } | null = null;

export function useResults(): LoadState {
  const url = resultsUrl(import.meta.env.VITE_RESULTS_URL, window.location.search);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    if (!cache || cache.url !== url) cache = { url, promise: loadResults(url) };
    let live = true;
    void cache.promise.then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/** Where the "Results JSON" link points. */
export function resultsLink(): string | null {
  return resultsUrl(import.meta.env.VITE_RESULTS_URL, window.location.search);
}
