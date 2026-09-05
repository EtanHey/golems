import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadLifecycleGate, runEvalCase } from "./run_eval_harness.mjs";

const namedPrompt = `# Grounding
- "BrainLayer Architecture Notes"

# Scope
Verify current search ranking.`;

function validReceipt() {
  return {
    driveRoute: {
      canonical: true,
      resolvedWith: ["/drive-usage", "/braindrive"],
    },
    driveAuth: { callSucceeded: true, authed: true },
    accountVerification: {
      callSucceeded: true,
      drive_account: "research-account@example.com",
      notebooklm_account: "research-account@example.com",
      expected: "research-account@example.com",
      match: true,
    },
    localFiles: [
      {
        name: "01-context.md",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        modifiedTime: "2026-08-02T10:00:00Z",
      },
    ],
    driveFiles: [
      {
        name: "01-context.md",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        modifiedTime: "2026-08-02T10:01:00Z",
      },
    ],
    notebooklm: { exists: false },
  };
}

function canonicalInventory() {
  return validReceipt().localFiles.map((file) => ({ ...file }));
}

function evaluateReceipt(gate, receipt, prompt = namedPrompt, canonicalFiles = canonicalInventory()) {
  return gate.evaluateLifecycleReceipt(
    receipt,
    gate.evaluateGeminiPreflight(prompt),
    canonicalFiles,
  );
}

test("eval #7 executes the known stale-Drive answer", async () => {
  const result = await runEvalCase(7);

  assert.equal(result.caseId, 7);
  assert.equal(result.lifecycleVerdict, "FAIL");
  assert.deepEqual(result.failedChecks, ["DRIVE_FRESHNESS"]);
  assert.equal(result.passedAssertions, 5);
  assert.equal(result.totalAssertions, 5);
  assert.deepEqual(result.behaviorProbes, {
    staleDriveRejected: true,
    routeOmissionsRejected: true,
    falseAuthEvidenceRejected: true,
    groundingOmissionRejected: true,
    attachInstructionRejected: true,
  });
});

test("a fully verified lifecycle receipt passes", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const result = evaluateReceipt(gate, validReceipt());

  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.failedChecks, []);
});

test("the completion gate rejects duplicate or unexpected Drive files", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const duplicate = validReceipt();
  duplicate.driveFiles.push({ ...duplicate.driveFiles[0] });
  const extra = validReceipt();
  extra.driveFiles.push({
    name: "stale-context.md",
    sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    modifiedTime: "2026-08-02T10:02:00Z",
  });

  assert.equal(
    evaluateReceipt(gate, duplicate).checks.DRIVE_FILESET.pass,
    false,
  );
  assert.equal(
    evaluateReceipt(gate, extra).checks.DRIVE_FILESET.pass,
    false,
  );
});

test("the completion gate rejects missing, empty, or non-relative managed names", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  for (const invalidName of [undefined, "", "/absolute-context.md", "../escaped-context.md"]) {
    const receipt = validReceipt();
    receipt.localFiles[0].name = invalidName;
    receipt.driveFiles[0].name = invalidName;

    assert.equal(
      evaluateReceipt(gate, receipt).checks.DRIVE_FILESET.pass,
      false,
    );
  }
});

test("the completion gate rejects auth, content, and timestamp false-greens", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const authFailure = validReceipt();
  authFailure.driveAuth.authed = false;
  const contentMismatch = validReceipt();
  contentMismatch.driveFiles[0].sha256 =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const staleTimestamp = validReceipt();
  staleTimestamp.driveFiles[0].modifiedTime = "2026-08-02T09:59:59Z";

  assert.equal(evaluateReceipt(gate, authFailure).checks.DRIVE_AUTH.pass, false);
  assert.equal(evaluateReceipt(gate, contentMismatch).checks.DRIVE_FRESHNESS.pass, false);
  assert.equal(evaluateReceipt(gate, staleTimestamp).checks.DRIVE_FRESHNESS.pass, false);
});

test("the completion gate rejects missing or mismatched Drive account verification", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const missing = validReceipt();
  delete missing.accountVerification;
  const wrongAccount = validReceipt();
  wrongAccount.accountVerification.drive_account = "wrong-account@example.com";

  assert.equal(evaluateReceipt(gate, missing).checks.DRIVE_ACCOUNT.pass, false);
  assert.equal(evaluateReceipt(gate, wrongAccount).checks.DRIVE_ACCOUNT.pass, false);
});

test("the completion gate rejects a receipt that omits canonical local files", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const subset = validReceipt();
  subset.localFiles = [];
  subset.driveFiles = [];
  const result = evaluateReceipt(gate, subset);

  assert.equal(result.checks.LOCAL_INVENTORY.pass, false);
  assert.equal(result.checks.DRIVE_FILESET.pass, false);
});

test("the canonical inventory is derived recursively from local files", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const root = mkdtempSync(path.join(tmpdir(), "research-lifecycle-inventory-"));
  try {
    mkdirSync(path.join(root, "nested"));
    writeFileSync(path.join(root, "01-context.md"), "root context\n");
    writeFileSync(path.join(root, "nested", "02-context.md"), "nested context\n");

    const inventory = gate.collectLocalInventory(root);
    assert.deepEqual(
      inventory.map((file) => file.name),
      ["01-context.md", "nested/02-context.md"],
    );
    assert.equal(inventory.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
    assert.equal(inventory.every((file) => Number.isFinite(Date.parse(file.modifiedTime))), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NotebookLM freshness requires replacement and stale-source readback evidence", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const verified = validReceipt();
  verified.notebooklm = {
    exists: true,
    expectedReplacementIds: ["source-new"],
    indexedSourceIds: ["source-new"],
    staleSourceIds: ["source-old"],
  };
  const bareBoolean = validReceipt();
  bareBoolean.notebooklm = { exists: true, fresh: true };
  const staleStillPresent = validReceipt();
  staleStillPresent.notebooklm = {
    exists: true,
    expectedReplacementIds: ["source-new"],
    indexedSourceIds: ["source-new", "source-old"],
    staleSourceIds: ["source-old"],
  };

  assert.equal(evaluateReceipt(gate, verified).checks.NOTEBOOKLM_FRESHNESS.pass, true);
  assert.equal(evaluateReceipt(gate, bareBoolean).checks.NOTEBOOKLM_FRESHNESS.pass, false);
  assert.equal(evaluateReceipt(gate, staleStillPresent).checks.NOTEBOOKLM_FRESHNESS.pass, false);
});

test("Gemini preflight accepts named/web-only grounding and rejects silent omissions", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const webOnly = "# Grounding\nNone — web-only research\n\n# Scope\nSurvey primary sources.";
  const missing = "# Scope\nSurvey primary sources.";
  const vague = "# Grounding\nUse my architecture notes.\n\n# Scope\nSurvey primary sources.";
  const attach = '# Grounding\n- "Architecture Notes"\n\nPlease attach the document.';
  const unrelatedNegation = '# Grounding\n- "Architecture Notes"\n\nDo not search the web and attach the file.';
  const compoundProhibition = '# Grounding\n- "Architecture Notes"\n\nDo not drag and drop the file.';
  const postpositiveProhibition = '# Grounding\n- "Architecture Notes"\n\nYou should attach no documents. Upload no files.';
  const postpositiveException = '# Grounding\n- "Architecture Notes"\n\nAttach nothing but the report.';
  const placeholder = '# Grounding\n- "<Exact Google Doc name 1>"\n\n# Scope\nSurvey primary sources.';
  const mixedPlaceholder = '# Grounding\n- "Architecture Notes"\n- "<Exact Google Doc name 2>"\n\n# Scope\nSurvey primary sources.';
  const duplicateEquivalentHeader = '# Grounding\n- "Architecture Notes"\n\n# Scope\nSurvey primary sources.\n\n# Grounding #\nNone — web-only research';

  assert.equal(gate.evaluateGeminiPreflight(namedPrompt).pass, true);
  assert.equal(gate.evaluateGeminiPreflight(webOnly).pass, true);
  assert.equal(gate.evaluateGeminiPreflight(missing).pass, false);
  assert.equal(gate.evaluateGeminiPreflight(vague).pass, false);
  assert.equal(gate.evaluateGeminiPreflight(attach).pass, false);
  assert.equal(gate.evaluateGeminiPreflight(unrelatedNegation).pass, false);
  assert.equal(gate.evaluateGeminiPreflight(compoundProhibition).pass, true);
  assert.equal(gate.evaluateGeminiPreflight(postpositiveProhibition).pass, true);
  assert.equal(gate.evaluateGeminiPreflight(postpositiveException).pass, false);
  assert.equal(gate.evaluateGeminiPreflight(placeholder).pass, false);
  assert.equal(gate.evaluateGeminiPreflight(mixedPlaceholder).pass, false);
  assert.equal(gate.evaluateGeminiPreflight(duplicateEquivalentHeader).pass, false);
});

test("Gemini preflight accepts the canonical companion-skill Grounding header", async () => {
  const gate = await loadLifecycleGate();
  assert.ok(gate, "executable lifecycle gate is missing");

  const canonical = `# Grounding (Drive workspace — CONNECTED; REQUIRED block)
- "BrainLayer Architecture Notes"

# Scope
Verify current search ranking.`;
  const closingMarker = `# Grounding #
- "BrainLayer Architecture Notes"

# Scope
Verify current search ranking.`;

  assert.equal(gate.evaluateGeminiPreflight(canonical).pass, true);
  assert.equal(gate.evaluateGeminiPreflight(closingMarker).pass, true);
});
