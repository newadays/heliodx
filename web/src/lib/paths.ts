import type { Study } from "@/types/study";
import { caseIdOf, type Step } from "~/data/model";

export function studyPath(study: Pick<Study, "id" | "caseId">, step?: Step): string {
  return `/study/${caseIdOf(study)}${step ? `?step=${step}` : ""}`;
}

export function consolePath(study: Pick<Study, "id" | "caseId"> | null, traceStep?: string): string {
  if (!study) return "/console";
  return `/console/${caseIdOf(study)}${traceStep ? `?step=${encodeURIComponent(traceStep)}` : ""}`;
}
