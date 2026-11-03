/**
 * Deterministic drafts used when MODEL_MOCK=1 (emulator, CI) and as the
 * shapes the real pipeline (card 2.6) must produce. Nothing here is clinical
 * advice; the text exists to exercise the review and sharing screens.
 */
import { findingColor } from "../lib/colors";

export type Modality = "xray" | "ct_mri" | "ultrasound" | "lab" | "skin";
export type FindingStatus = "pending" | "accepted" | "edited" | "rejected";

export interface DraftFinding {
  id: string;
  index: number;
  title: string;
  description: string;
  confidence: number;
  region: { shape: "ellipse" | "rect"; x: number; y: number; w: number; h: number } | null;
  color: string;
  status: FindingStatus;
  editedText?: string;
  reviewedAt: unknown | null;
  /** B25: the model's abnormal call, its location and the zone drawn for it. */
  abnormal?: boolean;
  location?: string | null;
  outlines?: { kind: "zone" | "lung" | "heart"; side: "left" | "right" | null; zone: "upper" | "middle" | "lower" | null; box: [number, number, number, number] }[];
  /** B26: "pattern_of_concern" or "none" (lib/patterns.ts); older studies may hold "tb_suggestive". */
  pattern?: "pattern_of_concern" | "tb_suggestive" | "none";
}

export interface DraftSummaries {
  clinicianSummary: {
    findings: string;
    impression: string[];
    recommendation: string;
    highlights: { findingId: string; start: number; end: number }[];
    generatedFromReviewHash: string | null;
    editedByClinician: boolean;
    /** Legacy (B26, removed for compliance): never written now; older studies may hold them. */
    considerations?: string[];
    considerationsAdopted?: string[];
  };
}

export interface MockDraft {
  quality: { ok: true; score: number; issues: string[] };
  studyType: string;
  findings: DraftFinding[];
  summaries: DraftSummaries;
}

const finding = (
  index: number,
  title: string,
  description: string,
  confidence: number,
  region: DraftFinding["region"],
): DraftFinding => ({
  id: `f${index + 1}`,
  index,
  title,
  description,
  confidence,
  region,
  color: findingColor(index),
  status: "pending",
  reviewedAt: null,
});

/** Resolve highlight offsets from the finding titles quoted in the text. */
function highlightsFor(text: string, findings: DraftFinding[]) {
  return findings.flatMap((f) => {
    const start = text.indexOf(f.title);
    return start >= 0 ? [{ findingId: f.id, start, end: start + f.title.length }] : [];
  });
}

export function mockDraft(modality: Modality, reviewedBy: string): MockDraft {
  switch (modality) {
    case "xray": {
      const findings = [
        {
          // B25: an abnormal observation with its zone, so the outline shows on the emulators.
          // The patient's right lung is on the image's left.
          ...finding(0, "Right upper zone opacity", "Patchy nodular opacity in the right upper zone with a small lucent area.", 91, {
            shape: "ellipse", x: 0.14, y: 0.15, w: 0.3, h: 0.25,
          }),
          abnormal: true,
          pattern: "pattern_of_concern" as const,
          location: "right lung upper zone",
          outlines: [{ kind: "zone" as const, side: "right" as const, zone: "upper" as const, box: [0.14, 0.15, 0.44, 0.4] as [number, number, number, number] }],
        },
        finding(1, "Blunted right costophrenic angle", "Loss of the sharp costophrenic angle on the right.", 78, {
          shape: "ellipse", x: 0.7, y: 0.78, w: 0.18, h: 0.1,
        }),
        finding(2, "Borderline cardiac silhouette", "Cardiothoracic ratio at the upper limit of normal on this projection.", 84, {
          shape: "rect", x: 0.3, y: 0.4, w: 0.4, h: 0.3,
        }),
      ];
      const text = `${findings[0].title} with ${findings[1].title}. ${findings[2].title}; no pneumothorax.`;
      return {
        quality: { ok: true, score: 92, issues: [] },
        studyType: "Chest X-ray (PA)",
        findings,
        summaries: {
          clinicianSummary: {
            findings: text,
            impression: ["Right upper zone opacity.", "Blunted right costophrenic angle."],
            recommendation: "Interpret alongside the clinical picture and any prior imaging.",
            highlights: highlightsFor(text, findings),
            generatedFromReviewHash: null,
            editedByClinician: false,
          },
        },
      };
    }
    case "skin": {
      const findings = [
        finding(0, "Asymmetric pigmented lesion", "Irregular pigmentation with two distinct colour zones.", 72, {
          shape: "ellipse", x: 0.45, y: 0.45, w: 0.22, h: 0.2,
        }),
        finding(1, "Irregular border", "Notched, poorly defined margin on the inferior edge.", 69, {
          shape: "ellipse", x: 0.5, y: 0.6, w: 0.16, h: 0.08,
        }),
      ];
      const text = `${findings[0].title} with ${findings[1].title}.`;
      return {
        quality: { ok: true, score: 88, issues: [] },
        studyType: "Skin lesion photo",
        findings,
        summaries: {
          clinicianSummary: {
            findings: text,
            impression: ["Pigmented lesion with atypical features."],
            recommendation: "Dermatology review; consider dermoscopy or excision biopsy.",
            highlights: highlightsFor(text, findings),
            generatedFromReviewHash: null,
            editedByClinician: false,
          },
        },
      };
    }
    default: {
      const label = modality === "ct_mri" ? "CT / MRI slice" : modality === "ultrasound" ? "Ultrasound still" : "Lab report";
      const findings = [
        finding(0, "No acute abnormality identified", "Reviewed region appears within normal limits on this image.", 81, null),
      ];
      const text = `${findings[0].title}.`;
      return {
        quality: { ok: true, score: 85, issues: [] },
        studyType: label,
        findings,
        summaries: {
          clinicianSummary: {
            findings: text,
            impression: ["Unremarkable on the submitted image."],
            recommendation: "Interpret alongside the full study and clinical picture.",
            highlights: highlightsFor(text, findings),
            generatedFromReviewHash: null,
            editedByClinician: false,
          },
        },
      };
    }
  }
}
