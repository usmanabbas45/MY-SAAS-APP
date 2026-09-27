import { all, get, run, transaction } from "../db";
import { FEATURE_NAMES } from "../judge/features";
import type { Verdict } from "../judge/types";
import { predict, trainMlp, type MlpModel } from "./mlp";

export const MIN_TRAINING_LABELS = 20;

/** Before a project has trained its own model, risk is derived from the judge's verdict and confidence. */
export function priorRisk(verdict: Verdict, confidence: number): number {
  if (verdict === "correct") return (1 - confidence) * 0.5;
  if (verdict === "unclear") return 0.4 + confidence * 0.2;
  return 0.5 + confidence * 0.5;
}

export function loadModel(projectId: number): MlpModel | null {
  const row = get<{ weights_json: string }>("SELECT weights_json FROM risk_models WHERE project_id = ?", projectId);
  if (!row) return null;
  const model = JSON.parse(row.weights_json) as MlpModel;
  // A model trained on an older feature layout is ignored rather than mis-applied.
  return model.featureNames.join() === FEATURE_NAMES.join() ? model : null;
}

export function riskScore(model: MlpModel | null, features: number[], verdict: Verdict, confidence: number): number {
  return model ? predict(model, features) : priorRisk(verdict, confidence);
}

export interface TrainingExample {
  features: number[];
  label: 0 | 1;
  verdict: Verdict;
  correctedVerdict: Verdict | null;
  question: string;
  answer: string;
}

export function trainingExamples(projectId: number): TrainingExample[] {
  const rows = all<{ features_json: string; verdict: Verdict; corrected_verdict: Verdict | null; question: string; answer: string }>(
    `SELECT i.features_json, i.verdict, i.corrected_verdict, i.question, i.answer
       FROM audit_items i JOIN audits a ON a.id = i.audit_id
      WHERE a.project_id = ? AND i.feedback IS NOT NULL`,
    projectId,
  );
  return rows.map((r) => {
    const truth = r.corrected_verdict ?? r.verdict;
    return {
      features: JSON.parse(r.features_json) as number[],
      label: truth === "correct" ? 0 : 1,
      verdict: r.verdict,
      correctedVerdict: r.corrected_verdict,
      question: r.question,
      answer: r.answer,
    };
  });
}

export type RetrainOutcome =
  | { ok: true; samples: number; valAccuracy: number; baselineAccuracy: number; rescored: number }
  | { ok: false; reason: string };

/** Trains this project's neural risk model on its human-labelled verdicts, then re-scores every audit item. */
export function retrainRiskModel(projectId: number): RetrainOutcome {
  const examples = trainingExamples(projectId);
  if (examples.length < MIN_TRAINING_LABELS) {
    return { ok: false, reason: `Need at least ${MIN_TRAINING_LABELS} reviewed answers to train (you have ${examples.length}).` };
  }
  const positives = examples.filter((e) => e.label === 1).length;
  if (positives === 0 || positives === examples.length) {
    return { ok: false, reason: "Review some good answers and some bad answers - the model needs both to learn the difference." };
  }
  const X = examples.map((e) => e.features);
  const y = examples.map((e) => e.label);
  const result = trainMlp(X, y, FEATURE_NAMES);

  // Baseline: how often the judge's own verdict already matched the human label.
  const baselineAccuracy = examples.filter((e) => (e.verdict === "correct" ? 0 : 1) === e.label).length / examples.length;

  const items = all<{ id: number; features_json: string }>(
    "SELECT i.id, i.features_json FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ?",
    projectId,
  );
  transaction(() => {
    run(
      `INSERT INTO risk_models (project_id, weights_json, n_samples, val_accuracy, trained_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET weights_json = excluded.weights_json, n_samples = excluded.n_samples,
         val_accuracy = excluded.val_accuracy, trained_at = excluded.trained_at`,
      projectId, JSON.stringify(result.model), examples.length, result.valAccuracy,
    );
    for (const item of items) {
      run("UPDATE audit_items SET risk = ? WHERE id = ?", predict(result.model, JSON.parse(item.features_json)), item.id);
    }
  });
  return { ok: true, samples: examples.length, valAccuracy: result.valAccuracy, baselineAccuracy, rescored: items.length };
}

/** JSONL export of human-reviewed examples, ready for fine-tuning a larger model later. */
export function exportTrainingJsonl(projectId: number): string {
  return trainingExamples(projectId)
    .map((e) =>
      JSON.stringify({
        question: e.question,
        answer: e.answer,
        judge_verdict: e.verdict,
        human_verdict: e.correctedVerdict ?? e.verdict,
        is_bad_answer: e.label === 1,
        features: Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, e.features[i]])),
      }),
    )
    .join("\n");
}
