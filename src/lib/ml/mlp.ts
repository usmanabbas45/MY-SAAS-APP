/**
 * A small multi-layer perceptron (feed-forward neural network) for binary classification,
 * implemented without dependencies so it trains in-process in milliseconds.
 *
 * Architecture: input -> [dense + ReLU] x N hidden layers -> dense + sigmoid.
 * Training: mini-batch Adam, binary cross-entropy with class weighting, L2 weight decay,
 * He initialisation, deterministic seeded shuffling, early stopping on a validation split.
 */

export interface MlpModel {
  version: 1;
  layers: { w: number[][]; b: number[] }[]; // w[out][in]
  featureNames: readonly string[];
}

export interface TrainOptions {
  hidden?: number[];
  epochs?: number;
  learningRate?: number;
  batchSize?: number;
  l2?: number;
  validationSplit?: number;
  patience?: number;
  seed?: number;
}

export interface TrainResult {
  model: MlpModel;
  valAccuracy: number;
  valLoss: number;
  epochsRun: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

function forward(model: MlpModel, x: number[]): { activations: number[][]; output: number } {
  const activations: number[][] = [x];
  let a = x;
  model.layers.forEach((layer, li) => {
    const last = li === model.layers.length - 1;
    a = layer.w.map((row, j) => {
      let z = layer.b[j];
      for (let i = 0; i < row.length; i++) z += row[i] * a[i];
      return last ? sigmoid(z) : Math.max(0, z);
    });
    activations.push(a);
  });
  return { activations, output: a[0] };
}

export function predict(model: MlpModel, x: number[]): number {
  if (x.length !== model.layers[0].w[0].length) throw new Error("Feature vector size does not match the model");
  return forward(model, x).output;
}

function bce(p: number, y: number): number {
  const e = 1e-7;
  return -(y * Math.log(Math.max(p, e)) + (1 - y) * Math.log(Math.max(1 - p, e)));
}

function evaluate(model: MlpModel, X: number[][], y: number[]) {
  let loss = 0;
  let correct = 0;
  X.forEach((x, i) => {
    const p = predict(model, x);
    loss += bce(p, y[i]);
    if ((p >= 0.5 ? 1 : 0) === y[i]) correct++;
  });
  return { loss: loss / Math.max(1, X.length), accuracy: correct / Math.max(1, X.length) };
}

export function trainMlp(X: number[][], y: number[], featureNames: readonly string[], opts: TrainOptions = {}): TrainResult {
  if (X.length !== y.length || X.length === 0) throw new Error("Training data is empty or mismatched");
  const {
    hidden = [16, 8],
    epochs = 400,
    learningRate = 0.01,
    batchSize = 16,
    l2 = 1e-4,
    validationSplit = 0.2,
    patience = 40,
    seed = 42,
  } = opts;
  const rand = rng(seed);

  // Deterministic stratified-ish shuffle, then split.
  const idx = X.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const nVal = X.length >= 10 ? Math.max(2, Math.round(X.length * validationSplit)) : 0;
  const valIdx = idx.slice(0, nVal);
  const trainIdx = idx.slice(nVal);
  const Xv = valIdx.map((i) => X[i]);
  const yv = valIdx.map((i) => y[i]);

  // Class weights so a rare "wrong answer" class is not ignored.
  const pos = trainIdx.filter((i) => y[i] === 1).length;
  const neg = trainIdx.length - pos;
  const wPos = pos ? trainIdx.length / (2 * pos) : 1;
  const wNeg = neg ? trainIdx.length / (2 * neg) : 1;

  const sizes = [X[0].length, ...hidden, 1];
  const model: MlpModel = {
    version: 1,
    featureNames,
    layers: sizes.slice(1).map((out, li) => {
      const fanIn = sizes[li];
      const scale = Math.sqrt(2 / fanIn);
      return {
        w: Array.from({ length: out }, () => Array.from({ length: fanIn }, () => gaussian(rand) * scale)),
        b: Array(out).fill(0),
      };
    }),
  };

  // Adam state
  const m = model.layers.map((l) => ({ w: l.w.map((r) => r.map(() => 0)), b: l.b.map(() => 0) }));
  const v = model.layers.map((l) => ({ w: l.w.map((r) => r.map(() => 0)), b: l.b.map(() => 0) }));
  const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
  let step = 0;

  let best = { loss: Infinity, weights: JSON.stringify(model.layers), epoch: 0 };
  let epochsRun = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    epochsRun = epoch + 1;
    for (let i = trainIdx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [trainIdx[i], trainIdx[j]] = [trainIdx[j], trainIdx[i]];
    }
    for (let start = 0; start < trainIdx.length; start += batchSize) {
      const batch = trainIdx.slice(start, start + batchSize);
      const gW = model.layers.map((l) => l.w.map((r) => r.map(() => 0)));
      const gB = model.layers.map((l) => l.b.map(() => 0));

      for (const n of batch) {
        const { activations, output } = forward(model, X[n]);
        const weight = y[n] === 1 ? wPos : wNeg;
        let delta = [(output - y[n]) * weight]; // dL/dz for sigmoid + BCE
        for (let li = model.layers.length - 1; li >= 0; li--) {
          const aPrev = activations[li];
          const layer = model.layers[li];
          for (let j = 0; j < delta.length; j++) {
            gB[li][j] += delta[j];
            for (let i = 0; i < aPrev.length; i++) gW[li][j][i] += delta[j] * aPrev[i];
          }
          if (li > 0) {
            const next = Array(aPrev.length).fill(0);
            for (let i = 0; i < aPrev.length; i++) {
              if (aPrev[i] <= 0) continue; // ReLU derivative
              let s = 0;
              for (let j = 0; j < delta.length; j++) s += layer.w[j][i] * delta[j];
              next[i] = s;
            }
            delta = next;
          }
        }
      }

      step++;
      const bc1 = 1 - Math.pow(beta1, step);
      const bc2 = 1 - Math.pow(beta2, step);
      model.layers.forEach((layer, li) => {
        layer.w.forEach((row, j) => {
          row.forEach((wji, i) => {
            const g = gW[li][j][i] / batch.length + l2 * wji;
            m[li].w[j][i] = beta1 * m[li].w[j][i] + (1 - beta1) * g;
            v[li].w[j][i] = beta2 * v[li].w[j][i] + (1 - beta2) * g * g;
            row[i] -= (learningRate * (m[li].w[j][i] / bc1)) / (Math.sqrt(v[li].w[j][i] / bc2) + eps);
          });
          const g = gB[li][j] / batch.length;
          m[li].b[j] = beta1 * m[li].b[j] + (1 - beta1) * g;
          v[li].b[j] = beta2 * v[li].b[j] + (1 - beta2) * g * g;
          layer.b[j] -= (learningRate * (m[li].b[j] / bc1)) / (Math.sqrt(v[li].b[j] / bc2) + eps);
        });
      });
    }

    if (nVal > 0) {
      const { loss } = evaluate(model, Xv, yv);
      if (loss < best.loss - 1e-5) best = { loss, weights: JSON.stringify(model.layers), epoch };
      else if (epoch - best.epoch >= patience) break;
    }
  }

  if (nVal > 0) model.layers = JSON.parse(best.weights);
  const evalSet = nVal > 0 ? { X: Xv, y: yv } : { X, y };
  const { loss, accuracy } = evaluate(model, evalSet.X, evalSet.y);
  return { model, valAccuracy: accuracy, valLoss: loss, epochsRun };
}
