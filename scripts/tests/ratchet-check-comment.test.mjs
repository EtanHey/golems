import { describe, expect, test } from "bun:test";

import { checkVerdict } from "../ratchet/check-comment.mjs";
import { findSticky, markerComment, upsertComment } from "../ratchet/table.mjs";

const HEAD = "c".repeat(40);
const comment = (verdict, { marker = "mac", login = "EtanHey" } = {}) => ({
  user: { login },
  body: `${markerComment(marker)}\n<!-- ratchet-verdict: ${JSON.stringify(verdict)} -->\n| table |`,
});
const pass = { head: HEAD, ok: true, real_pass: 2, real_total: 2, bootstrap: false };
const check = (comments, extra = {}) => checkVerdict({ comments, marker: "mac", head: HEAD, expectedReal: 2, authors: ["EtanHey"], baseHasRows: true, ...extra });

describe("checkVerdict", () => {
  test("passes on an all-PASS verdict for this exact head", () => {
    expect(check([comment(pass)]).ok).toBe(true);
  });

  test("nonboolean success and malformed row counts fail closed", () => {
    for (const ok of ["false", 1, null]) expect(check([comment({ ...pass, ok })]).ok).toBe(false);
    for (const count of ["false", "2", null, true, -1, 1.5]) {
      expect(check([comment({ ...pass, real_pass: count, real_total: count })], { expectedReal: count }).ok).toBe(false);
    }
    expect(check([comment({ ...pass, real_pass: 1, real_total: 1 })], { expectedReal: 1 }).ok).toBe(true);
  });

  test("missing, stale, failing or short verdicts fail", () => {
    expect(check([]).reason).toMatch(/no .* comment/);
    expect(check([comment({ ...pass, head: "d".repeat(40) })]).reason).toMatch(/stale/);
    expect(check([comment({ ...pass, ok: false, real_pass: 1 })]).ok).toBe(false);
    expect(check([comment({ ...pass, real_pass: 1, real_total: 1 })]).reason).toMatch(/1 real rows, expected 2/);
  });

  test("a bootstrap verdict FAILs when the base branch has a row file, and passes only when it has none", () => {
    expect(check([comment({ ...pass, bootstrap: true })]).reason).toMatch(/bootstrap/);
    expect(check([comment({ ...pass, bootstrap: true })], { baseHasRows: false }).ok).toBe(true);
    expect(check([comment({ head: HEAD, ok: true, real_pass: 2, real_total: 2 })]).reason).toMatch(/bootstrap/);
  });

  test("a marker comment from anyone outside the allowed authors is ignored", () => {
    expect(check([comment(pass, { login: "someone" })]).reason).toMatch(/no .* comment/);
  });

  test("a verdict anywhere but the fixed second line is not read (no forged detail line)", () => {
    const forged = { user: { login: "EtanHey" }, body: `${markerComment("mac")}\n| table |\n<!-- ratchet-verdict: ${JSON.stringify(pass)} -->` };
    expect(check([forged]).ok).toBe(false);
  });

  test("the producer and CI select the SAME comment when two marker comments exist (the oldest)", () => {
    const stale = { id: 1, ...comment({ ...pass, head: "d".repeat(40) }) };
    const fresh = { id: 2, ...comment(pass) };
    expect(findSticky([stale, fresh], "mac", ["EtanHey"]).id).toBe(1);
    expect(check([stale, fresh]).reason).toMatch(/stale/);
    const calls = [];
    upsertComment({ repo: "o/r", pr: 1, marker: "mac", author: "EtanHey", body: "x", gh: (args) => { calls.push(args); return args.includes("--paginate") ? JSON.stringify([[stale, fresh]]) : "{}"; } });
    expect(calls[1]).toContain("repos/o/r/issues/comments/1");
  });

  test("an unparseable verdict fails closed", () => {
    expect(check([{ user: { login: "EtanHey" }, body: `${markerComment("mac")}\n<!-- ratchet-verdict: {nope -->` }]).ok).toBe(false);
  });
});

test("only the explicitly configured disk warning can satisfy aggregate without fake real PASS", () => {
  const measurement={free_gb:13,floor:60,merged_worktrees:148,ceiling:25,health:false};
  const report=[{id:"disk-free-floor",measurement}];
  const verdict={...pass,real_pass:1,report_only:report};
  expect(check([comment(verdict)],{expectedReportOnly:["disk-free-floor"]}).ok).toBe(true);
  expect(check([comment(verdict)]).ok).toBe(false);
  expect(check([comment({...verdict,report_only:[]})],{expectedReportOnly:["disk-free-floor"]}).ok).toBe(false);
  expect(check([comment({...verdict,report_only:[{id:"other",measurement}]})],{expectedReportOnly:["disk-free-floor"]}).ok).toBe(false);
  expect(check([comment({...verdict,report_only:[{id:"disk-free-floor",measurement:{...measurement,health:true}}]})],{expectedReportOnly:["disk-free-floor"]}).ok).toBe(false);
  expect(check([comment({...verdict,ok:false})],{expectedReportOnly:["disk-free-floor"]}).ok).toBe(false);
});
