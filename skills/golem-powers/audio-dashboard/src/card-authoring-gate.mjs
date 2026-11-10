/**
 * CARD-AUTHORING BUILD gate (decision-flow).
 *
 * Etan, 2026-11-10, via orc, about the 03:00 dashboard: "the full transcript repeated
 * inside card details; letter/number options he couldn't decode; a single voice saying
 * 'look below'". Each rule below closes one of those, by name, from the job file alone.
 *
 *   ASK_MISSING           a decision with options or a checklist has no `ask`
 *   ASK_NOT_SPOKEN        the `ask` is not an ordered subsequence of one of its own scene scripts
 *   OPTION_LABEL_CODE     an option label, checklist item or group title begins with a bare code
 *                         (one letter, 1-2 letters + 1-3 digits, or digits, then a separator),
 *                         or maps one code to another anywhere ("B3→J6", "C2+J14")
 *   DECISION_SINGLE_VOICE a decision with options or a checklist lacks a host or an expert scene
 *   SCREEN_REFERENCE      a scene script points at the screen ("below", "tick", "on screen", ...)
 *
 * FAIL-CLOSED: any violation rejects the build. No job-level override. Reads the job only (no audio).
 */
import { tokens } from "./card-text-audio-gate.mjs";
import { sceneVoiceRole } from "./voice-role-gate.mjs";

/** Words and phrases that only make sense while looking at the page. Whole words, any case. */
export const SCREEN_REFERENCE_WORDS = Object.freeze(["below", "above", "tick", "ticked", "scroll", "on screen", "on this card"]);

// A bare code prefix (lead ruling, r2): a single letter, one or two letters followed by one to
// three digits, or digits alone; then a separator. Two letters with no digit are a word, not a code
// ("No: keep it", "OK: ship it", "Go: start now").
// "." and "-" count only when followed by whitespace ("A. Move", "1 - Merge"), so "Re-run",
// "1.5x" and "No." stay words; ":" never before a digit, so "10:30" stays a time.
const LABEL_CODE = /^\s*(?:[A-Za-z]{1,2}\d{1,3}|[A-Za-z]|\d+)\s*(?:[·)–—→]|:(?!\d)|[.-](?=\s))/;

// A code-to-code mapping anywhere in a label ("7 merges: B3→J6, C2+J14") is the same legend problem.
const CODE_PAIR = /(?<![\p{L}\p{N}])[A-Za-z]{1,2}\d{1,3}\s*[→+]\s*[A-Za-z]{1,2}\d{1,3}(?![\p{L}\p{N}])/u;

export function labelHasCode(label) {
  const text = String(label ?? "");
  return LABEL_CODE.test(text) || CODE_PAIR.test(text);
}

const hasOptions = decision => Array.isArray(decision?.options) && decision.options.length > 0;
const hasChecklist = decision => decision?.checklist !== undefined && !(Array.isArray(decision.checklist) && decision.checklist.length === 0);
const asksQuestion = decision => hasOptions(decision) || hasChecklist(decision);

function isOrderedSubsequence(needle, haystack) {
  let at = 0;
  for (const word of haystack) if (word === needle[at]) at += 1;
  return at === needle.length;
}

function labelFields(decision) {
  const fields = [];
  for (const [index, option] of (Array.isArray(decision.options) ? decision.options : []).entries()) {
    const label = typeof option === "string" ? option : option?.label ?? option?.title ?? option?.value;
    fields.push([`option ${index} label`, label]);
  }
  for (const [index, entry] of (Array.isArray(decision.checklist) ? decision.checklist : []).entries()) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      fields.push([`checklist group ${index} title`, entry.title ?? entry.group]);
      for (const [itemIndex, item] of (Array.isArray(entry.items) ? entry.items : []).entries()) {
        fields.push([`checklist group ${index} item ${itemIndex}`, item]);
      }
    } else {
      fields.push([`checklist item ${index}`, entry]);
    }
  }
  return fields;
}

export function screenReferences(script) {
  const spoken = ` ${tokens(script).join(" ")} `;
  return SCREEN_REFERENCE_WORDS.filter(word => spoken.includes(` ${word} `));
}

export function analyzeCardAuthoring({ decisions = [], scenes = [] } = {}) {
  const sceneById = new Map(scenes.map(scene => [scene?.id, scene]));
  const violations = [];
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const owned = (Array.isArray(decision?.sceneIds) ? decision.sceneIds : []).map(id => sceneById.get(id)).filter(Boolean);
    const ask = typeof decision?.ask === "string" ? decision.ask.trim() : "";
    if (asksQuestion(decision) && !ask) {
      violations.push({ segment: decision.id, metric: "ASK_MISSING",
        detail: "a decision with options or a checklist needs `ask`: one short spoken sentence, the question the card puts to the operator" });
    }
    if (ask) {
      const wanted = tokens(ask);
      if (!wanted.length || !owned.some(scene => isOrderedSubsequence(wanted, tokens(scene.script)))) {
        violations.push({ segment: decision.id, metric: "ASK_NOT_SPOKEN",
          detail: `ask "${ask}" is not said, in order, by any one of this card's scenes (${owned.map(scene => scene.id).join(", ") || "none"})` });
      }
    }
    for (const [field, label] of labelFields(decision)) {
      if (labelHasCode(label)) {
        violations.push({ segment: decision.id, metric: "OPTION_LABEL_CODE",
          detail: `${field} "${String(label)}" begins with a code or maps codes; use plain words a listener understands without a legend` });
      }
    }
    if (asksQuestion(decision)) {
      const roles = new Set(owned.map(sceneVoiceRole));
      const lacking = ["host", "expert"].filter(role => !roles.has(role));
      if (lacking.length) {
        violations.push({ segment: decision.id, metric: "DECISION_SINGLE_VOICE",
          detail: `a decision card needs the host to ask and the expert to explain; no ${lacking.join(" or ")} scene among sceneIds` });
      }
    }
  }
  for (const scene of scenes) {
    if (scene?.screenWordsOk === true) continue;
    for (const word of screenReferences(scene?.script)) {
      violations.push({ segment: scene.id, metric: "SCREEN_REFERENCE",
        detail: `script says "${word}"; the audio must make sense with the screen off (set screenWordsOk: true only for a non-screen use)` });
    }
  }
  return {
    verdict: violations.length ? "REJECT" : "PASS",
    violations,
    thresholds: { screenReferenceWords: [...SCREEN_REFERENCE_WORDS], labelCode: LABEL_CODE.source, labelCodePair: CODE_PAIR.source },
  };
}

export const CARD_AUTHORING_RUNBOOK = "Give every decision with options or a checklist a short spoken `ask` (the answer sheet shows it instead of the narration), label options and checklist items in plain words without letter/number codes, pair a host question with an expert answer on each decision card, and keep narration free of screen words (below, above, tick, scroll, on screen).";

export function formatCardAuthoringReport(result) {
  if (result.verdict === "PASS") return "card-authoring gate PASS";
  return `card-authoring gate REJECT\n${result.violations.map(v => `- ${v.metric} segment=${v.segment} ${v.detail}`).join("\n")}\n\n${CARD_AUTHORING_RUNBOOK}`;
}
