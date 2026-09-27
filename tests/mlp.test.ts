import { describe, expect, it } from "vitest";
import { predict, trainMlp } from "@/lib/ml/mlp";

function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("neural network (MLP)", () => {
  it("learns a non-linear (XOR-like) boundary that a linear model cannot", () => {
    const r = rand(7);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 400; i++) {
      const a = r(), b = r();
      X.push([a, b]);
      y.push((a > 0.5) !== (b > 0.5) ? 1 : 0);
    }
    const { model, valAccuracy } = trainMlp(X, y, ["a", "b"], { hidden: [16, 8], epochs: 600, learningRate: 0.02 });
    expect(valAccuracy).toBeGreaterThan(0.85);
    expect(predict(model, [0.9, 0.1])).toBeGreaterThan(0.5);
    expect(predict(model, [0.9, 0.9])).toBeLessThan(0.5);
  });

  it("is deterministic for a given seed", () => {
    const X = [[0, 0], [0, 1], [1, 0], [1, 1], [0.2, 0.8], [0.8, 0.2], [0.1, 0.1], [0.9, 0.9], [0.3, 0.7], [0.7, 0.3], [0.2, 0.2], [0.8, 0.8]];
    const y = [0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0];
    const a = trainMlp(X, y, ["a", "b"], { seed: 3, epochs: 50 });
    const b = trainMlp(X, y, ["a", "b"], { seed: 3, epochs: 50 });
    expect(predict(a.model, [0.4, 0.6])).toBe(predict(b.model, [0.4, 0.6]));
  });

  it("outputs probabilities in [0, 1] and rejects wrong-sized inputs", () => {
    const { model } = trainMlp([[0], [1], [0.2], [0.8]], [0, 1, 0, 1], ["x"], { epochs: 20 });
    const p = predict(model, [0.5]);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
    expect(() => predict(model, [1, 2])).toThrow();
  });

  it("rejects empty or mismatched training data", () => {
    expect(() => trainMlp([], [], [])).toThrow();
    expect(() => trainMlp([[1]], [1, 0], ["x"])).toThrow();
  });
});
