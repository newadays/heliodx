/**
 * F11 · Demo mode: a synthetic organization whose accounts an admin creates
 * for the judges (scripts/demo-user.ts), sample studies created by the server
 * from curated images, and limits. Pure helpers here; accounts in
 * lib/demoAccounts.ts, studies in callables/createDemoStudy.ts.
 */
export const DEMO_ORG = "demo";
export const DEMO_ROLE = "demo";
/** Studies a demo account may start per rolling hour (judges may share one account). */
export const DEMO_STUDIES_PER_HOUR = 20;

export const DEMO_ORGANIZATION = {
  name: "HelioDX Demo",
  legalName: "HelioDX demo clinic (synthetic)",
  domains: [] as string[],
  sharePolicy: { whatsapp: true, email: true, pdf: true, linkExpiryDays: 1 },
  demo: true,
};

export const DEMO_PROFILE = {
  displayName: "Demo Clinician",
  title: "Dr.",
  simulated: true,
};

/** Obviously fake contacts: the +1 555 01xx range is reserved for fiction; .invalid never resolves. */
export function demoPatient(n: number): { name: string; phone: string; email: string } {
  const k = ((n % 100) + 100) % 100;
  return {
    name: `Sample Patient ${k}`,
    phone: `+1555010${String(k).padStart(2, "0")}`,
    email: `sample.patient${k}@example.invalid`,
  };
}

/** Starts within the rolling hour, for the per-account cap. */
export function recentCount(createdAtMs: number[], nowMs: number): number {
  return createdAtMs.filter((t) => nowMs - t < 60 * 60 * 1000).length;
}
