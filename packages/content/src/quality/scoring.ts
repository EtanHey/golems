/**
 * Quality scoring pipeline for generated images.
 *
 * Evaluates images against quality gates:
 * - CLIP Score (prompt adherence) >= 0.25
 * - LAION Aesthetic Score >= 5.5 (social) / >= 6.0 (print)
 * - BRISQUE (perceptual quality) <= 40
 *
 * Uses Python scripts via child_process since the ML models
 * (CLIP, LAION Aesthetic Predictor, BRISQUE) are Python-only.
 *
 * Auto-retry with new seed up to 3x, then flag for human review.
 */

import { spawn } from "child_process";
import { join } from "path";

// --- Types ---

export type QualityScores = {
  /** CLIP Score — prompt adherence (0-1, higher = better) */
  clipScore: number;
  /** LAION Aesthetic Score (1-10, higher = better) */
  aestheticScore: number;
  /** BRISQUE score — perceptual quality (0-100, lower = better) */
  brisqueScore: number;
  /** Overall pass/fail */
  passed: boolean;
  /** Which gates failed */
  failedGates: string[];
};

export type QualityThresholds = {
  /** Minimum CLIP score (default: 0.25) */
  minClipScore?: number;
  /** Minimum aesthetic score (default: 5.5) */
  minAestheticScore?: number;
  /** Maximum BRISQUE score (default: 40) */
  maxBrisqueScore?: number;
};

export type QualityPreset = "social" | "print" | "draft";

// --- Presets ---

const QUALITY_PRESETS: Record<QualityPreset, QualityThresholds> = {
  social: {
    minClipScore: 0.25,
    minAestheticScore: 5.5,
    maxBrisqueScore: 40,
  },
  print: {
    minClipScore: 0.25,
    minAestheticScore: 6.0,
    maxBrisqueScore: 30,
  },
  draft: {
    minClipScore: 0.2,
    minAestheticScore: 4.0,
    maxBrisqueScore: 60,
  },
};

/**
 * Get quality thresholds for a preset.
 */
export function getThresholds(preset: QualityPreset): QualityThresholds {
  return QUALITY_PRESETS[preset];
}

// --- Python Bridge ---

const PYTHON_SCORING_SCRIPT = join(
  import.meta.dir ?? __dirname,
  "..",
  "..",
  "scripts",
  "quality-score.py",
);

/**
 * Run the Python quality scoring script on an image.
 * Returns parsed scores or null if scoring fails.
 */
async function runPythonScoring(
  imagePath: string,
  prompt?: string,
): Promise<Omit<QualityScores, "passed" | "failedGates"> | null> {
  return new Promise((resolve) => {
    const args = [PYTHON_SCORING_SCRIPT, imagePath];
    if (prompt) {
      args.push("--prompt", prompt);
    }

    const proc = spawn("python3", args, {
      timeout: 60_000,
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`Quality scoring failed (exit ${code}): ${stderr}`);
        resolve(null);
        return;
      }

      try {
        const scores = JSON.parse(stdout.trim());
        resolve({
          clipScore: scores.clip_score ?? 0,
          aestheticScore: scores.aesthetic_score ?? 0,
          brisqueScore: scores.brisque_score ?? 100,
        });
      } catch {
        console.error(`Failed to parse scoring output: ${stdout}`);
        resolve(null);
      }
    });
  });
}

/**
 * Score an image against quality gates.
 */
export async function scoreImage(
  imagePath: string,
  prompt?: string,
  thresholds?: QualityThresholds,
): Promise<QualityScores> {
  const t = thresholds ?? QUALITY_PRESETS.social;
  const scores = await runPythonScoring(imagePath, prompt);

  if (!scores) {
    return {
      clipScore: 0,
      aestheticScore: 0,
      brisqueScore: 100,
      passed: false,
      failedGates: ["scoring_failed"],
    };
  }

  const failedGates: string[] = [];

  if (t.minClipScore && scores.clipScore < t.minClipScore) {
    failedGates.push(`clip_score (${scores.clipScore.toFixed(3)} < ${t.minClipScore})`);
  }
  if (t.minAestheticScore && scores.aestheticScore < t.minAestheticScore) {
    failedGates.push(
      `aesthetic_score (${scores.aestheticScore.toFixed(2)} < ${t.minAestheticScore})`,
    );
  }
  if (t.maxBrisqueScore && scores.brisqueScore > t.maxBrisqueScore) {
    failedGates.push(`brisque (${scores.brisqueScore.toFixed(1)} > ${t.maxBrisqueScore})`);
  }

  return {
    ...scores,
    passed: failedGates.length === 0,
    failedGates,
  };
}

/**
 * Format quality scores for display (Telegram preview, CLI).
 */
export function formatScores(scores: QualityScores): string {
  const status = scores.passed ? "PASS" : "FAIL";
  const lines = [
    `Quality: ${status}`,
    `  CLIP Score:     ${scores.clipScore.toFixed(3)}`,
    `  Aesthetic:      ${scores.aestheticScore.toFixed(2)}/10`,
    `  BRISQUE:        ${scores.brisqueScore.toFixed(1)}`,
  ];

  if (scores.failedGates.length > 0) {
    lines.push(`  Failed gates:   ${scores.failedGates.join(", ")}`);
  }

  return lines.join("\n");
}
