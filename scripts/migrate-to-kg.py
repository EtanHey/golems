#!/usr/bin/env python3
"""Phase 5b: Knowledge Migration to BrainLayer KG.

Migrates knowledge from scattered golems files into BrainLayer:
1. Rules files → digested with entity extraction
2. Package CLAUDE.md → project/technology entities
3. SOUL.md → golem identity entities
4. .claude/memory/ → indexed memories
5. docs.local/ high-priority files → indexed content
6. Skills → skill entities

Uses brainlayer Python API directly (bypasses MCP server).
Idempotent: checks for existing digests before re-processing.
"""

import hashlib
import json
import logging
import os
import sys
import time
import uuid
from pathlib import Path

# Resolve local dependencies and source data without assuming a developer username.
BRAINLAYER_ROOT = Path(os.environ.get("BRAINLAYER_ROOT", Path.home() / "Gits/brainlayer"))
BRAINLAYER_SRC = BRAINLAYER_ROOT / "src"
sys.path.insert(0, str(BRAINLAYER_SRC))

from brainlayer.vector_store import VectorStore
from brainlayer.embeddings import get_embedding_model

# Use brainlayer's own path resolution (prefers legacy zikaron.db if it exists)
from brainlayer.paths import DEFAULT_DB_PATH
BRAINLAYER_DB = DEFAULT_DB_PATH
GOLEMS_ROOT = Path(os.environ.get("GOLEMS_ROOT", Path(__file__).resolve().parents[1]))
project_slug = "-" + str(GOLEMS_ROOT).strip("/").replace("/", "-")
MEMORY_DIR = Path(
    os.environ.get(
        "CLAUDE_PROJECT_MEMORY_DIR",
        Path.home() / ".claude/projects" / project_slug / "memory",
    )
)
OWNER_NAME = os.environ.get("GOLEMS_OWNER_NAME", "Repository Owner")
SUPABASE_PROJECT_REF = os.environ.get("GOLEMS_SUPABASE_PROJECT_REF")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("migrate")

def make_entity_id(entity_type: str, name: str) -> str:
    """Generate a stable entity ID from type+name (idempotent)."""
    key = f"{entity_type}:{name.lower()}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


# Track stats
stats = {
    "digested": 0,
    "stored": 0,
    "skipped": 0,
    "errors": 0,
    "entities_created": 0,
}


def get_store():
    return VectorStore(BRAINLAYER_DB)


def get_embed_fn():
    """Get embedding function — uses embed_query (the FIXED path)."""
    model = get_embedding_model()
    return model.embed_query


def is_already_digested(store, title):
    """Check if content with this title has already been digested."""
    try:
        results = store.search(f"title:{title}", num_results=3)
        for r in results:
            meta = r.get("metadata", {})
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except:
                    meta = {}
            if meta.get("title") == title and r.get("source") == "digest":
                return True
    except:
        pass
    return False


def digest_file(file_path, title, project="golems", participants=None):
    """Digest a file through the Phase 3 pipeline."""
    from brainlayer.pipeline.digest import digest_content

    content = file_path.read_text(encoding="utf-8", errors="replace")
    if not content.strip():
        log.warning(f"  Empty file: {file_path.name}")
        stats["skipped"] += 1
        return None

    store = get_store()

    # Idempotency check
    if is_already_digested(store, title):
        log.info(f"  Already digested: {title}")
        stats["skipped"] += 1
        return None

    try:
        result = digest_content(
            content=content,
            store=store,
            embed_fn=get_embed_fn(),
            title=title,
            project=project,
            participants=participants,
        )
        n_entities = len(result.get("entities", []))
        n_relations = len(result.get("relations", []))
        log.info(
            f"  ✓ {title}: {n_entities} entities, {n_relations} relations, "
            f"sentiment={result.get('sentiment', {}).get('label', 'n/a')}"
        )
        stats["digested"] += 1
        stats["entities_created"] += n_entities
        return result
    except Exception as e:
        log.error(f"  ✗ {title}: {e}")
        stats["errors"] += 1
        return None


def store_knowledge(content, title, content_type="learning", project="golems", tags=None):
    """Store knowledge as a simple chunk (for small items that don't need full digest)."""
    store = get_store()
    embed_fn = get_embed_fn()

    if is_already_digested(store, title):
        log.info(f"  Already stored: {title}")
        stats["skipped"] += 1
        return None

    try:
        import uuid

        chunk_id = f"migrate-{uuid.uuid4().hex[:12]}"
        embedding = embed_fn(content)

        metadata = {"title": title}
        if tags:
            metadata["tags"] = tags

        chunks = [
            {
                "id": chunk_id,
                "content": content,
                "metadata": metadata,
                "source_file": "migration",
                "project": project,
                "content_type": content_type,
                "char_count": len(content),
                "source": "digest",
            }
        ]
        store.upsert_chunks(chunks, [embedding])
        log.info(f"  ✓ Stored: {title} ({len(content)} chars)")
        stats["stored"] += 1
        return chunk_id
    except Exception as e:
        log.error(f"  ✗ Store failed for {title}: {e}")
        stats["errors"] += 1
        return None


# ── Migration Categories ──────────────────────────────────────────────


def migrate_rules():
    """Migrate .claude/rules/*.md → KG entities via digest."""
    log.info("═══ RULES FILES ═══")
    rules_dir = GOLEMS_ROOT / ".claude/rules"
    if not rules_dir.exists():
        log.warning("Rules dir not found")
        return

    for rule_file in sorted(rules_dir.glob("*.md")):
        # Skip symlinks to external files (owner-profile is managed separately)
        if rule_file.is_symlink():
            log.info(f"  Skipping symlink: {rule_file.name}")
            stats["skipped"] += 1
            continue

        title = f"Golems Rule: {rule_file.stem}"
        digest_file(rule_file, title=title, project="golems")


def migrate_claude_mds():
    """Migrate packages/*/CLAUDE.md → project/technology entities."""
    log.info("═══ PACKAGE CLAUDE.md FILES ═══")
    packages_dir = GOLEMS_ROOT / "packages"
    if not packages_dir.exists():
        log.warning("Packages dir not found")
        return

    for claude_md in sorted(packages_dir.glob("*/CLAUDE.md")):
        # Skip node_modules
        if "node_modules" in str(claude_md):
            continue
        pkg_name = claude_md.parent.name
        title = f"Golems Package: {pkg_name}"
        digest_file(claude_md, title=title, project=f"golems-packages-{pkg_name}")

    # Also digest the root shared instructions, with legacy fallback
    root_agents = GOLEMS_ROOT / "AGENTS.md"
    root_claude = GOLEMS_ROOT / "CLAUDE.md"
    root_instructions = root_agents if root_agents.exists() else root_claude
    if root_instructions.exists():
        digest_file(root_instructions, title="Golems Root CLAUDE.md", project="golems")


def migrate_soul():
    """Migrate SOUL.md → golem identity entities."""
    log.info("═══ SOUL.md (Golem Identity) ═══")
    soul_file = GOLEMS_ROOT / "packages/claude/SOUL.md"
    if soul_file.exists():
        digest_file(
            soul_file,
            title="ClaudeGolem Identity (SOUL.md)",
            project="golems",
            participants=["ClaudeGolem", OWNER_NAME],
        )


def migrate_owner_profile():
    """Migrate owner-profile.md → person entity."""
    log.info("═══ OWNER PROFILE ═══")
    profile_value = os.environ.get("GOLEMS_PROFILE_PATH")
    profile = Path(profile_value) if profile_value else None
    if profile and profile.exists():
        digest_file(
            profile,
            title=f"Owner Profile: {OWNER_NAME}",
            project="golems",
            participants=[OWNER_NAME],
        )


def migrate_memory():
    """Migrate .claude/memory/ files → indexed memories."""
    log.info("═══ PROJECT MEMORY FILES ═══")
    if not MEMORY_DIR.exists():
        log.warning("Memory dir not found")
        return

    for mem_file in sorted(MEMORY_DIR.glob("*.md")):
        title = f"Claude Memory: {mem_file.stem}"
        digest_file(mem_file, title=title, project="golems")


def migrate_skills():
    """Migrate skill SKILL.md files → skill entities.

    Uses store_knowledge (not full digest) because skills are
    structured reference docs, not conversation content.
    """
    log.info("═══ SKILLS (Ralph) ═══")
    skills_dir = GOLEMS_ROOT / "packages/ralph/skills/golem-powers"
    if not skills_dir.exists():
        log.warning("Skills dir not found")
        return

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue

        content = skill_md.read_text(encoding="utf-8", errors="replace")
        if not content.strip():
            continue

        skill_name = skill_dir.name
        word_count = len(content.split())
        title = f"Skill: golem-powers:{skill_name}"

        # Flag large skills (>500 words per recurring-protocols.md)
        if word_count > 500:
            log.warning(f"  ⚠ Large skill ({word_count} words): {skill_name}")

        store_knowledge(
            content=content,
            title=title,
            content_type="learning",
            project="golems",
            tags=["ralph", "skill", skill_name],
        )


def migrate_docs_local_high_priority():
    """Migrate high-priority docs.local files → indexed content.

    HIGH priority directories: plan/, research/, reference/
    Skip: logs/, linkedin/, stalker-golem/ (too large), transcripts/ (needs brain_digest with audio)
    """
    log.info("═══ DOCS.LOCAL (High Priority) ═══")
    docs_local = GOLEMS_ROOT / "docs.local"
    if not docs_local.exists():
        log.warning("docs.local not found")
        return

    # High-priority directories
    high_priority_dirs = ["plan", "research", "reference", "learning", "learnings"]
    # Medium-priority standalone files (in docs.local root)
    skip_dirs = {"logs", "linkedin", "linkedin-data", "stalker-golem", "transcripts", "finance", "scratch"}

    processed = 0

    # Process high-priority subdirectories
    for subdir_name in high_priority_dirs:
        subdir = docs_local / subdir_name
        if not subdir.exists():
            continue
        for md_file in sorted(subdir.rglob("*.md")):
            if md_file.stat().st_size > 500_000:  # Skip files > 500KB
                log.info(f"  Skipping large file: {md_file.name} ({md_file.stat().st_size // 1024}KB)")
                stats["skipped"] += 1
                continue
            rel_path = md_file.relative_to(docs_local)
            title = f"docs.local/{rel_path}"
            digest_file(md_file, title=title, project="golems")
            processed += 1

    # Process root-level .md files in docs.local
    for md_file in sorted(docs_local.glob("*.md")):
        if md_file.stat().st_size > 500_000:
            stats["skipped"] += 1
            continue
        title = f"docs.local/{md_file.name}"
        digest_file(md_file, title=title, project="golems")
        processed += 1

    log.info(f"  Processed {processed} docs.local files")


def migrate_meeting_layer_research():
    """Migrate meeting-layer research files specifically (KG design decisions)."""
    log.info("═══ MEETING LAYER RESEARCH ═══")
    research_dir = GOLEMS_ROOT / "docs.local/plan/meeting-layer"
    if not research_dir.exists():
        log.warning("Meeting layer dir not found")
        return

    for md_file in sorted(research_dir.glob("*.md")):
        if md_file.name in ("collab.md", "README.md"):
            # These are live docs, skip
            continue
        title = f"KG Research: {md_file.stem}"
        digest_file(md_file, title=title, project="brainlayer")


def create_golem_entities():
    """Seed explicit golem entities in the KG."""
    log.info("═══ SEEDING GOLEM ENTITIES ═══")
    store = get_store()

    golems = [
        {
            "name": "golemsClaude",
            "type": "golem",
            "metadata": {
                "role": "orchestrator",
                "package": "packages/claude",
                "telegram": True,
                "description": "Telegram bot, orchestrator, external face of the golem ecosystem",
            },
        },
        {
            "name": "brainClaude",
            "type": "golem",
            "metadata": {
                "role": "memory",
                "package": "brainlayer",
                "description": "Memory layer engineer, manages BrainLayer knowledge graph",
            },
        },
        {
            "name": "coachClaude",
            "type": "golem",
            "metadata": {
                "role": "coach",
                "package": "packages/coach",
                "description": "Calendar management, daily planning, habit tracking, priority management",
            },
        },
        {
            "name": "recruiterGolem",
            "type": "golem",
            "metadata": {
                "role": "recruiter",
                "package": "packages/recruiter",
                "description": "Outreach, interview practice with Elo tracking, contact management",
            },
        },
        {
            "name": "contentGolem",
            "type": "golem",
            "metadata": {
                "role": "content",
                "package": "packages/content",
                "description": "Visual content factory, publishing, LinkedIn posts",
            },
        },
        {
            "name": "tellerGolem",
            "type": "golem",
            "metadata": {
                "role": "finance",
                "package": "packages/teller",
                "description": "Finance tracking, subscriptions, tax calculations",
            },
        },
        {
            "name": "Ralph",
            "type": "golem",
            "metadata": {
                "role": "autonomous-coder",
                "package": "packages/ralph",
                "description": "Autonomous PRD execution with CodeRabbit review gates",
            },
        },
    ]

    for golem in golems:
        try:
            eid = make_entity_id(golem["type"], golem["name"])
            entity_id = store.upsert_entity(
                entity_id=eid,
                entity_type=golem["type"],
                name=golem["name"],
                metadata=golem["metadata"],
            )
            log.info(f"  ✓ Seeded golem entity: {golem['name']} → {entity_id}")
            stats["entities_created"] += 1
        except Exception as e:
            log.error(f"  ✗ Failed to seed {golem['name']}: {e}")
            stats["errors"] += 1


def create_project_entities():
    """Seed explicit project entities in the KG."""
    log.info("═══ SEEDING PROJECT ENTITIES ═══")
    store = get_store()

    projects = [
        {
            "name": "golems",
            "type": "project",
            "metadata": {
                "description": "Autonomous AI agent ecosystem — Bun workspace with 13 packages",
                "stack": "TypeScript, Bun, Supabase, Claude API, Grammy",
                "repo": "github.com/EtanHey/golems",
            },
        },
        {
            "name": "brainlayer",
            "type": "project",
            "metadata": {
                "description": "Memory layer for Claude Code — Python + sqlite-vec + sentence-transformers",
                "stack": "Python, sqlite-vec, sentence-transformers, MCP",
                "repo": "github.com/EtanHey/brainlayer",
            },
        },
        {
            "name": "voicelayer",
            "type": "project",
            "metadata": {
                "description": "Voice I/O layer for Claude Code — MCP server, edge-tts, whisper.cpp",
                "stack": "TypeScript, MCP, edge-tts, whisper.cpp",
                "repo": "github.com/EtanHey/voicelayer",
            },
        },
        {
            "name": "etanheyman.com",
            "type": "project",
            "metadata": {
                "description": "Portfolio + Golems dashboard",
                "stack": "Next.js 15.3, Vercel, Supabase Auth",
                "repo": "github.com/EtanHey/etanheyman.com",
            },
        },
    ]

    for project in projects:
        try:
            eid = make_entity_id(project["type"], project["name"])
            entity_id = store.upsert_entity(
                entity_id=eid,
                entity_type=project["type"],
                name=project["name"],
                metadata=project["metadata"],
            )
            log.info(f"  ✓ Seeded project entity: {project['name']} → {entity_id}")
            stats["entities_created"] += 1
        except Exception as e:
            log.error(f"  ✗ Failed to seed {project['name']}: {e}")
            stats["errors"] += 1


def create_technology_entities():
    """Seed key technology entities in the KG."""
    log.info("═══ SEEDING TECHNOLOGY ENTITIES ═══")
    store = get_store()

    supabase_metadata = {"category": "database", "use": "Postgres + Auth + Storage + RLS"}
    if SUPABASE_PROJECT_REF:
        supabase_metadata["project_id"] = SUPABASE_PROJECT_REF

    technologies = [
        {"name": "Supabase", "type": "technology", "metadata": supabase_metadata},
        {"name": "Ollama", "type": "technology", "metadata": {"category": "llm", "model": "GLM-4.7-Flash", "use": "Local LLM for enrichment/scoring"}},
        {"name": "Gemini", "type": "technology", "metadata": {"category": "llm", "model": "Gemini 2.5 Flash-Lite", "use": "Free cloud LLM for scoring/research"}},
        {"name": "ElevenLabs", "type": "technology", "metadata": {"category": "stt", "model": "Scribe v2", "cost": "$0.0067/min", "use": "Hebrew STT winner"}},
        {"name": "CodeRabbit", "type": "technology", "metadata": {"category": "review", "plan": "Free (3/hr)", "use": "AI code review on PRs"}},
        {"name": "Grammy", "type": "technology", "metadata": {"category": "framework", "use": "Telegram bot framework"}},
        {"name": "GLiNER", "type": "technology", "metadata": {"category": "ner", "model": "multi-v2.1", "use": "Bilingual entity extraction"}},
    ]

    for tech in technologies:
        try:
            eid = make_entity_id(tech["type"], tech["name"])
            entity_id = store.upsert_entity(
                entity_id=eid,
                entity_type=tech["type"],
                name=tech["name"],
                metadata=tech["metadata"],
            )
            log.info(f"  ✓ Seeded tech entity: {tech['name']} → {entity_id}")
            stats["entities_created"] += 1
        except Exception as e:
            log.error(f"  ✗ Failed to seed {tech['name']}: {e}")
            stats["errors"] += 1


def create_person_entities():
    """Seed known person entities."""
    log.info("═══ SEEDING PERSON ENTITIES ═══")
    store = get_store()

    people = [
        {"name": OWNER_NAME, "type": "person", "metadata": {"role": "owner"}},
    ]

    for person in people:
        try:
            eid = make_entity_id(person["type"], person["name"])
            entity_id = store.upsert_entity(
                entity_id=eid,
                entity_type=person["type"],
                name=person["name"],
                metadata=person["metadata"],
            )
            log.info(f"  ✓ Seeded person entity: {person['name']} → {entity_id}")
            stats["entities_created"] += 1
        except Exception as e:
            log.error(f"  ✗ Failed to seed {person['name']}: {e}")
            stats["errors"] += 1


def create_relations():
    """Create key relationships between entities."""
    log.info("═══ SEEDING RELATIONS ═══")
    store = get_store()

    relations = [
        # Golem → Project ownership
        ("golemsClaude", "golems", "orchestrates"),
        ("brainClaude", "brainlayer", "maintains"),
        ("coachClaude", "golems", "coaches"),
        ("recruiterGolem", "golems", "recruits_for"),
        ("contentGolem", "golems", "creates_content_for"),
        ("Ralph", "golems", "executes_prds_for"),
        # Person → Project
        (OWNER_NAME, "golems", "owns"),
        (OWNER_NAME, "brainlayer", "owns"),
        (OWNER_NAME, "voicelayer", "owns"),
        (OWNER_NAME, "etanheyman.com", "owns"),
        # Technology → Project usage
        ("Supabase", "golems", "database_for"),
        ("Ollama", "brainlayer", "enriches"),
        ("ElevenLabs", "voicelayer", "transcribes_for"),
        ("GLiNER", "brainlayer", "extracts_for"),
        ("CodeRabbit", "golems", "reviews"),
        ("Grammy", "golems", "framework_for"),
    ]

    created = 0
    for source_name, target_name, rel_type in relations:
        try:
            # Look up entity IDs by name
            source = store.search_entities(source_name, limit=1)
            target = store.search_entities(target_name, limit=1)
            if source and target:
                rel_id = hashlib.sha256(f"{source[0]['id']}:{target[0]['id']}:{rel_type}".encode()).hexdigest()[:16]
                store.add_relation(
                    relation_id=rel_id,
                    source_id=source[0]["id"],
                    target_id=target[0]["id"],
                    relation_type=rel_type,
                    confidence=1.0,
                )
                log.info(f"  ✓ {source_name} --[{rel_type}]--> {target_name}")
                created += 1
            else:
                missing = []
                if not source:
                    missing.append(source_name)
                if not target:
                    missing.append(target_name)
                log.warning(f"  ⚠ Missing entities: {', '.join(missing)}")
        except Exception as e:
            # Relation might already exist (UNIQUE constraint)
            if "UNIQUE" in str(e):
                log.info(f"  Already exists: {source_name} --[{rel_type}]--> {target_name}")
            else:
                log.error(f"  ✗ Relation failed: {source_name} → {target_name}: {e}")
                stats["errors"] += 1

    log.info(f"  Created {created} relations")


# ── Main ──────────────────────────────────────────────────────────────


def main():
    start = time.time()
    log.info("╔════════════════════════════════════════╗")
    log.info("║  Phase 5b: Knowledge Migration to KG   ║")
    log.info("╚════════════════════════════════════════╝")
    log.info(f"DB: {BRAINLAYER_DB}")
    log.info(f"Golems root: {GOLEMS_ROOT}")
    log.info("")

    # Phase 1: Seed explicit entities (foundation)
    create_golem_entities()
    create_project_entities()
    create_technology_entities()
    create_person_entities()

    # Phase 2: Create relationships
    create_relations()

    # Phase 3: Digest knowledge files
    migrate_rules()
    migrate_claude_mds()
    migrate_soul()
    migrate_owner_profile()
    migrate_memory()

    # Phase 4: Index skills
    migrate_skills()

    # Phase 5: Digest high-priority docs.local
    migrate_docs_local_high_priority()
    migrate_meeting_layer_research()

    # Summary
    elapsed = time.time() - start
    log.info("")
    log.info("╔════════════════════════════════════════╗")
    log.info("║  Migration Complete                     ║")
    log.info("╚════════════════════════════════════════╝")
    log.info(f"  Digested:         {stats['digested']}")
    log.info(f"  Stored:           {stats['stored']}")
    log.info(f"  Skipped:          {stats['skipped']}")
    log.info(f"  Errors:           {stats['errors']}")
    log.info(f"  Entities created: {stats['entities_created']}")
    log.info(f"  Time:             {elapsed:.1f}s")


if __name__ == "__main__":
    main()
