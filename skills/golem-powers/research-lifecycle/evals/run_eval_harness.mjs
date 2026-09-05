#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsPath = path.join(here, "evals.json");
const gatePath = path.join(here, "..", "scripts", "lifecycle-gate.mjs");

let gatePromise;

export function loadLifecycleGate() {
  gatePromise ??= import(pathToFileURL(gatePath).href).catch(() => null);
  return gatePromise;
}

function scoreAssertion(assertion, behaviorProbes) {
  switch (assertion.name) {
    case "completion-refused":
      return behaviorProbes.staleDriveRejected;
    case "drive-route-required":
      return behaviorProbes.routeOmissionsRejected;
    case "real-auth-required":
      return behaviorProbes.falseAuthEvidenceRejected;
    case "grounding-required":
      return behaviorProbes.groundingOmissionRejected;
    case "no-attach-instruction":
      return behaviorProbes.attachInstructionRejected;
    default:
      throw new Error(`eval assertion is not executable: ${assertion.name ?? assertion.text}`);
  }
}

export async function runEvalCase(caseId) {
  const spec = JSON.parse(readFileSync(evalsPath, "utf8"));
  const evalCase = spec.evals.find((entry) => entry.id === caseId);
  if (!evalCase) throw new Error(`eval case not found: ${caseId}`);
  if (!evalCase.fixture) throw new Error(`eval case ${caseId} has no executable fixture`);

  const fixturePath = path.join(here, evalCase.fixture);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(fixture.canonicalLocalFiles)) {
    throw new Error(`eval case ${caseId} fixture has no canonical local inventory`);
  }
  const gate = await loadLifecycleGate();
  if (!gate) {
    return {
      caseId,
      name: evalCase.name,
      lifecycleVerdict: "ERROR",
      failedChecks: ["EXECUTABLE_GATE_MISSING"],
      passedAssertions: 0,
      totalAssertions: evalCase.assertions.length,
      assertions: evalCase.assertions.map((assertion) => ({ name: assertion.name, passed: false })),
    };
  }

  const preflight = gate.evaluateGeminiPreflight(fixture.geminiPrompt);
  const lifecycle = gate.evaluateLifecycleReceipt(
    fixture.receipt,
    preflight,
    fixture.canonicalLocalFiles,
  );
  const withoutDriveUsage = structuredClone(fixture.receipt);
  withoutDriveUsage.driveRoute.resolvedWith = ["/braindrive"];
  const withoutBrainDrive = structuredClone(fixture.receipt);
  withoutBrainDrive.driveRoute.resolvedWith = ["/drive-usage"];
  const failedAuthCall = structuredClone(fixture.receipt);
  failedAuthCall.driveAuth.callSucceeded = false;
  const notAuthed = structuredClone(fixture.receipt);
  notAuthed.driveAuth.authed = false;
  const missingGrounding = gate.evaluateGeminiPreflight("# Scope\nVerify current search ranking.");
  const attachInstruction = gate.evaluateGeminiPreflight(
    '# Grounding\n- "BrainLayer Architecture Notes"\n\nPlease attach the document.',
  );
  const evaluateMutation = (receipt) =>
    gate.evaluateLifecycleReceipt(receipt, preflight, fixture.canonicalLocalFiles);
  const behaviorProbes = {
    staleDriveRejected:
      lifecycle.verdict === "FAIL" && lifecycle.failedChecks.includes("DRIVE_FRESHNESS"),
    routeOmissionsRejected:
      lifecycle.checks.DRIVE_ROUTE.pass &&
      !evaluateMutation(withoutDriveUsage).checks.DRIVE_ROUTE.pass &&
      !evaluateMutation(withoutBrainDrive).checks.DRIVE_ROUTE.pass,
    falseAuthEvidenceRejected:
      lifecycle.checks.DRIVE_AUTH.pass &&
      !evaluateMutation(failedAuthCall).checks.DRIVE_AUTH.pass &&
      !evaluateMutation(notAuthed).checks.DRIVE_AUTH.pass,
    groundingOmissionRejected:
      preflight.checks.GROUNDING_SOURCE.pass &&
      !missingGrounding.pass &&
      missingGrounding.failedChecks.includes("GROUNDING_BLOCK") &&
      missingGrounding.failedChecks.includes("GROUNDING_SOURCE"),
    attachInstructionRejected:
      preflight.checks.NO_ATTACH_INSTRUCTION.pass &&
      !attachInstruction.checks.NO_ATTACH_INSTRUCTION.pass,
  };
  const assertions = evalCase.assertions.map((assertion) => ({
    name: assertion.name,
    passed: scoreAssertion(assertion, behaviorProbes),
  }));

  return {
    caseId,
    name: evalCase.name,
    lifecycleVerdict: lifecycle.verdict,
    failedChecks: lifecycle.failedChecks,
    passedAssertions: assertions.filter((assertion) => assertion.passed).length,
    totalAssertions: assertions.length,
    behaviorProbes,
    assertions,
  };
}

async function main() {
  const requested = process.argv[2] ? Number(process.argv[2]) : 7;
  const result = await runEvalCase(requested);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.passedAssertions === result.totalAssertions ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
