import { describe, expect, it } from "vitest";

import { assertsCondition } from "../src/lib/vocabulary";
import { describeBox, describeMeasurement, describeQuality, measurementTool } from "../src/lib/traceText";

describe("traceText", () => {
  const flags = [{ measurementId: "density_ratio" as const, level: "flag" as const, value: 1.31, threshold: 1.25 }];

  it("states each measurement against its threshold", () => {
    expect(describeMeasurement({ id: "density_ratio", value: 1.3149, maskIds: [] }, flags)).toBe("L/R density ratio 1.31 · threshold 1.25 · exceeded (flag)");
    expect(describeMeasurement({ id: "cardiothoracic_ratio", value: 0.4412, maskIds: [] }, [])).toBe("CTR 0.44 · threshold 0.55 · within limits");
    expect(measurementTool("cardiothoracic_ratio")).toBe("measure_ratio");
  });

  it("describes quality and boxes with numbers only", () => {
    expect(describeQuality({ sharpness: 58.83, mean: 113.2, p1: 3, p99: 250, clipped: 0.021, width: 2048, height: 2500 }, true)).toBe(
      "pass · sharpness 58.8 · brightness 113 · clipped 2% · 2048×2500",
    );
    expect(describeBox([412.2, 436, 556.7, 724], 0.957)).toBe("box 412,436→557,724 · score 0.96");
    expect(describeBox([0.512, 0.04, 0.951, 0.88], 0.79)).toBe("box 0.51,0.04→0.95,0.88 · score 0.79");
  });

  it("never names a condition", () => {
    const lines = [
      describeMeasurement({ id: "lung_area_asymmetry", value: 0.3, maskIds: [] }, [{ measurementId: "lung_area_asymmetry", level: "critical", value: 0.3, threshold: 0.25 }]),
      describeMeasurement({ id: "cp_blunting_left", value: 0.7, maskIds: [] }, [{ measurementId: "cp_blunting_left", level: "flag", value: 0.7, threshold: 0.6 }]),
      describeMeasurement({ id: "cardiothoracic_ratio", value: 0.6, maskIds: [] }, [{ measurementId: "cardiothoracic_ratio", level: "urgent", value: 0.6, threshold: 0.55 }]),
    ];
    for (const l of lines) expect(assertsCondition(l), l).toBe(false);
  });
});
