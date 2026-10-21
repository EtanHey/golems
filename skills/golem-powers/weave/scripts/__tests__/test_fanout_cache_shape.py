"""Weave fan-out prompt-shape contract; passing does not prove provider cache reuse.

Run from the repository root with:
python3 -B -m unittest discover -s skills/golem-powers/weave/scripts/__tests__ \
    -p test_fanout_cache_shape.py -v
"""
from pathlib import Path
import re
import unittest


WEAVE = Path(__file__).resolve().parents[2]
SKILL = WEAVE / "SKILL.md"
HEADING = re.compile(
    r"^#{1,6} Fan[- ]out prompt shape \(cache economics\)\s*$", re.I | re.M
)


def normalize(text):
    return " ".join(re.sub(r"[*`]", "", text).lower().split())


class FanoutCacheShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = SKILL.read_text()
        cls.documents = {SKILL: cls.skill}
        cls.documents.update(
            (path, path.read_text()) for path in sorted((WEAVE / "references").glob("*.md"))
        )
        cls.sections = []
        cls.section_paths = []
        for path, text in cls.documents.items():
            for heading in HEADING.finditer(text):
                tail = text[heading.end():]
                end = re.search(r"^#{1,6} ", tail, re.M)
                cls.sections.append(tail[:end.start()] if end else tail)
                cls.section_paths.append(path)
        cls.contract = normalize("\n".join(cls.sections))

    def require(self, pattern, message):
        self.assertRegex(self.contract, pattern, message)

    def test_contract_is_reachable_from_skill(self):
        self.assertTrue(self.sections, "Missing Fan-out prompt shape (cache economics) contract")
        links = {
            (WEAVE / target.split("#")[0]).resolve()
            for target in re.findall(r"\]\((references/[^)]+\.md(?:#[^)]*)?)\)", self.skill)
        }
        for path in self.section_paths:
            self.assertTrue(path == SKILL or path.resolve() in links,
                            f"SKILL.md must link to {path.relative_to(WEAVE)}")

    def test_static_block_is_identical_first_and_item_data_last(self):
        self.require(r"byte[- ]identical.{0,60}static.{0,60}first",
                     "Require a byte-identical STATIC block first")
        for term in ("rules", "schema", "output contract"):
            self.assertIn(term, self.contract, f"STATIC must include {term}")
        self.require(r"(?:per[- ]item|item)[- ](?:data|specific data).{0,60}last",
                     "Require per-item data LAST")

    def test_static_excludes_variable_metadata(self):
        self.require(r"(?:no|exclude|keep out).{0,140}(?:static|prefix)|"
                     r"(?:static|prefix).{0,60}(?:no|exclude|must not contain)",
                     "Explicitly exclude changing metadata from STATIC")
        for term in (r"\bids?\b", r"\btimestamps?\b", r"\b(?:indices|indexes|index)\b", r"\bwave names?\b"):
            self.require(term, f"STATIC exclusions must cover {term}")

    def test_each_miner_batches_default_k_with_context_bound(self):
        self.require(r"(?:each|per) miner.{0,100}\bk\b.{0,50}(?:items|sessions)",
                     "Each miner must handle K items, not one")
        self.require(r"default.{0,40}8\s*(?:[-–—]|to)\s*12",
                     "Document default K approximately 8-12")
        self.require(r"(?:bound|limit|fit|adjust)\w*.{0,70}context|context.{0,70}(?:bound|limit)",
                     "Bound K by context capacity")

    def test_batching_explains_fresh_agent_startup_cost(self):
        self.require(r"(?:fresh|new|every) agent.{0,100}(?:startup|write)|"
                     r"startup.{0,100}(?:fresh|new|every) agent",
                     "Explain the startup write paid by every fresh agent")
        self.require(r"28(?:[.,]3)?\s*k|28,?000", "Retain the approximate 28k startup-write rationale")
        self.require(r"(?:harness|serializ).{0,150}task.{0,60}before.{0,100}(?:skill|reminder|claude)",
                     "Explain task-before-startup-context serialization")

    def test_conditional_warm_seed_before_siblings_and_cap_concurrency(self):
        self.require(r"(?:await|wait for).{0,80}(?:one|first|seed) agent.{0,60}first item.{0,80}before.{0,60}(?:siblings|fan[- ]out)",
                     "Await one agent's first item before launching siblings")
        self.require(r"only once.{0,50}reusable common boundary",
                     "Warming requires an existing reusable common boundary")
        self.require(r"k=1 seed|await the full seed batch",
                     "Seed wait must be executable with end-of-batch receipts")
        self.require(r"(?:cap|bound|limit)\w*.{0,40}concurrency|concurrency.{0,40}(?:cap|bound|limit)",
                     "Cap sibling concurrency")

    def test_routing_is_pointer_only(self):
        self.require(r"routing: follow /agent-routing for dispatch policy\.",
                     "Keep dispatch policy behind the routing SSOT pointer")
        self.assertNotRegex(self.contract, r"\b(?:luna|haiku|codex)\b",
                            "Do not assign models in the cache-shape contract")

    def test_no_conflicting_one_miner_per_session_instructions_remain(self):
        stale = re.compile(r"one\s+miner\s+(?:=|per)\s+(?:one\s+)?session|"
                           r"one\s+(?:session\s+per\s+miner|miner\s+agent\s+per\s+session)|"
                           r"mine\s+one\s+session|all n miners fan out over n sessions", re.I)
        conflicts = []
        for path, text in self.documents.items():
            clean = re.sub(r"[*`]", "", text)
            for match in stale.finditer(clean):
                line_number = clean.count("\n", 0, match.start()) + 1
                conflicts.append(f"{path.relative_to(WEAVE)}:{line_number}: {match.group()!r}")
        self.assertEqual(conflicts, [], "Replace obsolete one-item dispatch instructions")

    def test_packet_size_budget(self):
        # PREP-A allows <=40 added lines; the fetched SKILL.md baseline is 92.
        # This is a packet-specific ceiling, not an existing global body budget.
        self.assertLessEqual(len(self.skill.splitlines()), 92 + 40)
        self.assertLessEqual(sum(len(section.strip().splitlines()) + 1
                                 for section in self.sections), 40)


if __name__ == "__main__":
    unittest.main()
