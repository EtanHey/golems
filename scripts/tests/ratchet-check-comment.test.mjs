import { describe, expect, test } from "bun:test";

import { checkVerdict } from "../ratchet/check-comment.mjs";
import { markerComment } from "../ratchet/table.mjs";

const HEAD = "c".repeat(40);
const comment = (verdict, { marker = "mac", login = "EtanHey" } = {}) => ({
  user: { login },
  body: `${markerComment(marker)}\n| table |\n<!-- ratchet-verdict: ${JSON.stringify(verdict)} -->`,
});
const pass = { head: HEAD, ok: true, real_pass: 2, real_total: 2 };
const check = (comments, extra = {}) => checkVerdict({ comments, marker: "mac", head: HEAD, expectedReal: 2, authors: ["EtanHey"], ...extra });

describe("checkVerdict", () => {
  test("passes on an all-PASS verdict for this exact head", () => {
    expect(check([comment(pass)]).ok).toBe(true);
  });

  test("missing, stale, failing or short verdicts fail", () => {
    expect(check([]).reason).toMatch(/no .* comment/);
    expect(check([comment({ ...pass, head: "d".repeat(40) })]).reason).toMatch(/stale/);
    expect(check([comment({ ...pass, ok: false, real_pass: 1 })]).ok).toBe(false);
    expect(check([comment({ ...pass, real_pass: 1, real_total: 1 })]).reason).toMatch(/1 real rows, expected 2/);
  });

  test("a marker comment from anyone outside the allowed authors is ignored", () => {
    expect(check([comment(pass, { login: "someone" })]).reason).toMatch(/no .* comment/);
  });

  test("an unparseable verdict fails closed", () => {
    expect(check([{ user: { login: "EtanHey" }, body: `${markerComment("mac")}\n<!-- ratchet-verdict: {nope -->` }]).ok).toBe(false);
  });
});
