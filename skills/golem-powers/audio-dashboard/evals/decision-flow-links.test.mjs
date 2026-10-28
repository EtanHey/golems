import { expect, test } from "bun:test";
import { findBareReferences, renderDecisionFlow } from "../src/decision-flow.mjs";
import { scene } from "./decision-flow-harness.mjs";

// AD-16 (Etan, 2026-10-28 dashboard feedback): a PR the card names must be a real link.
const PR = "https://github.com/EtanHey/golems/pull/39";
const card = (rail, extra = {}) => ({ id: "a", title: "Gate", options: ["Keep"], sceneIds: ["a1"], rail, ...extra });
const render = (rail, extra) => renderDecisionFlow({ scenes: [scene("a1")], decisions: [card(rail, extra)] });
const railOf = html => html.match(/<dl class="df-rail">.*?<\/dl>/s)[0];

test("a rail record with a PR href renders a real anchor labelled repo#number", () => {
  const rail = railOf(render([{ label: "PR", value: "#39", href: PR }]));
  expect(rail).toContain(`<a class="df-rail-link" href="${PR}" rel="noopener noreferrer" title="Pull request EtanHey/golems#39">golems#39</a>`);
  expect(rail).not.toContain("target=");
});

test("issue hrefs and descriptive values keep their label and gain the qualified reference", () => {
  const rail = railOf(render([
    { label: "Issue", href: "https://github.com/EtanHey/golems/issues/12" },
    { label: "Fix", value: "Close the comparison stall", href: PR },
  ]));
  expect(rail).toContain('title="Issue EtanHey/golems#12">golems#12</a>');
  expect(rail).toContain('title="Pull request EtanHey/golems#39">Close the comparison stall <span class="df-rail-ref">golems#39</span></a>');
});

test("other http(s) hrefs link their value", () => {
  const rail = railOf(render([{ label: "Doc", value: "Design note", href: "https://example.com/a?b=1&c=2" }]));
  expect(rail).toContain('<a class="df-rail-link" href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">Design note</a>');
});

test("unsafe or non-http hrefs never become anchors", () => {
  const unsafe = [
    "javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd", "./local.html", "//evil.example/x", "https://",
    "javascript&colon;alert(1)", " javascript&colon;alert(1)",
    // Review r1: these carry a hostname, so only the protocol allowlist stops them.
    "javascript://example.com/%0Aalert(1)", "JavaScript://example.com/%0Aalert(1)", "ftp://example.com/x", "data://example.com/x", "file://example.com/x", "ws://example.com/x",
  ];
  for (const href of unsafe) {
    const rail = railOf(render([{ label: "PR", value: "#39", href }]));
    expect(rail).not.toContain("<a ");
    expect(rail).toContain("<dd>#39</dd>");
  }
});

test("a PR href whose number contradicts the value fails closed", () => {
  expect(() => render([{ label: "PR", value: "#40", href: PR }])).toThrow(/#40.*#39|#39.*#40/);
});

test("a bare #number without href stays text and the producer check flags it", () => {
  const decisions = [card([{ label: "PR", value: "#39" }], { body: "Merged in #41, see owner/repo#7 and &#39; entities." })];
  expect(railOf(renderDecisionFlow({ scenes: [scene("a1")], decisions }))).toContain("<dd>#39</dd>");
  expect(findBareReferences(decisions)).toEqual([
    { decision: "a", field: "body", ref: "#41" },
    { decision: "a", field: "rail PR", ref: "#39" },
  ]);
});

test("a bare #number is fine once the card links that number with a repository-qualified href", () => {
  const decisions = [card([{ label: "PR", value: "#39", href: PR }], { summary: "PR #39 adds the gate." })];
  expect(findBareReferences(decisions)).toEqual([]);
});

// Review r1 B1: a "#N" with its own href must link that PR/issue; a generic URL labelled "#39" is not a target.
test("a reference token needs a matching repository-qualified href, while plain docs links stay allowed", () => {
  const check = rail => findBareReferences([card(rail)]);
  expect(check([{ label: "PR", value: "#39", href: "https://example.com/" }])).toEqual([{ decision: "a", field: "rail PR", ref: "#39" }]);
  expect(check([{ label: "PR", value: "#39", href: "https://github.com/EtanHey/golems/issues/40" }])).toEqual([{ decision: "a", field: "rail PR", ref: "#39" }]);
  expect(check([{ label: "PR", value: "#39", href: PR }])).toEqual([]);
  expect(check([{ label: "Doc", value: "Design note", href: "https://example.com/design" }])).toEqual([]);
});

// Review r1 B2: "#N" is a reference in prose and rail values, but not in a code span or after a colour word.
test("numeric CSS colours are not references; real references in prose still are", () => {
  const refs = body => findBareReferences([card(undefined, { body })]).map(found => found.ref);
  expect(refs("Use CSS color #123.")).toEqual([]);
  expect(refs("Set background: #123456 and fill=#333 on the bars.")).toEqual([]);
  expect(refs("Run `code #123456` to check.")).toEqual([]);
  expect(refs("see #39")).toEqual(["#39"]);
  expect(refs("fixed in #39")).toEqual(["#39"]);
  expect(refs("Issue #123 tracks the colour bug.")).toEqual(["#123"]);
  expect(refs("The color issue is #123456.")).toEqual(["#123456"]);
});
