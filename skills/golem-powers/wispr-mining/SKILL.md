---
name: wispr-mining
description: "Mine Wispr SQLite for ASR vocabulary gaps/corrections. Triggers: wispr mining, ASR errors, voice vocabulary."
paths:
  - "**/wispr*"
  - "**/flow.sqlite"
---

# Wispr Flow Mining

> Extract ASR misrecognition patterns from Wispr Flow's SQLite database and generate clean, importable dictionary files.

## Database Location

```
~/Library/Application Support/Wispr Flow/flow.sqlite
```

**CRITICAL: Always work on a COPY.** Before any operation:

```bash
cp ~/Library/Application\ Support/Wispr\ Flow/flow.sqlite /tmp/wispr-flow-readonly.sqlite
```

Then query `/tmp/wispr-flow-readonly.sqlite` exclusively. Never write to the production database.

## Schema Reference

### Dictionary Table
| Column | Type | Purpose |
|--------|------|---------|
| `id` | VARCHAR(36) | UUID primary key |
| `phrase` | VARCHAR(255) | The dictionary entry (vocabulary word or trigger phrase) |
| `replacement` | VARCHAR(255) | NULL = vocabulary entry. Non-NULL = replacement mapping |
| `frequencyUsed` | INTEGER | How often this entry has fired |
| `isDeleted` | TINYINT(1) | Soft delete flag |
| `isSnippet` | TINYINT(1) | Snippet (long-form expansion), not a correction |
| `manualEntry` | TINYINT(1) | User-added vs auto-detected |
| `createdAt` | DATETIME | When added |
| `lastUsed` | DATETIME | Last trigger time |

### History Table
| Column | Type | Purpose |
|--------|------|---------|
| `transcriptEntityId` | VARCHAR(36) | UUID primary key |
| `asrText` | TEXT | Raw ASR output (what the mic heard) |
| `formattedText` | TEXT | After Wispr's formatter + dictionary |
| `editedText` | TEXT | User's manual correction (NULL if no edit) |
| `app` | VARCHAR(255) | Which app was active |
| `timestamp` | DATETIME | When dictated |
| `numWords` | INTEGER | Word count |
| `isArchived` | TINYINT(1) | Archive flag |

## Mining Workflow

### Step 1: Copy Database

```bash
cp ~/Library/Application\ Support/Wispr\ Flow/flow.sqlite /tmp/wispr-flow-readonly.sqlite
```

### Step 2: Current Dictionary Audit

```sql
-- Active dictionary entries (not deleted, not snippets)
SELECT phrase, replacement, frequencyUsed, lastUsed
FROM Dictionary
WHERE isDeleted = 0 AND isSnippet = 0
ORDER BY frequencyUsed DESC;

-- Unused entries (candidates for cleanup)
SELECT phrase, replacement, createdAt
FROM Dictionary
WHERE isDeleted = 0 AND isSnippet = 0 AND frequencyUsed = 0
ORDER BY createdAt;

-- Snippets (long-form expansions)
SELECT phrase, replacement FROM Dictionary
WHERE isDeleted = 0 AND isSnippet = 1;
```

### Step 3: Find ASR Misrecognition Patterns

```sql
-- Words that ASR consistently gets wrong (asrText differs from formattedText)
-- Group by the ASR mistake to find systematic patterns
SELECT
  LOWER(asrText) as asr_pattern,
  formattedText as corrected_to,
  COUNT(*) as occurrences,
  GROUP_CONCAT(DISTINCT app) as apps
FROM History
WHERE asrText IS NOT NULL
  AND formattedText IS NOT NULL
  AND asrText != formattedText
  AND isArchived = 0
  AND LENGTH(asrText) < 100
GROUP BY LOWER(asrText)
HAVING COUNT(*) >= 3
ORDER BY occurrences DESC
LIMIT 50;
```

### Step 4: Find User Edit Patterns

```sql
-- Cases where user manually corrected the formatted text
-- These are the HIGHEST-SIGNAL gaps
SELECT
  formattedText,
  editedText,
  app,
  timestamp
FROM History
WHERE editedText IS NOT NULL
  AND editedText != formattedText
  AND isArchived = 0
  AND LENGTH(editedText) < 200
ORDER BY timestamp DESC
LIMIT 50;
```

**IMPORTANT: Classify edits into two buckets:**
1. **Whitespace-only edits** (trailing spaces, leading newlines, paragraph breaks) — LOW signal, ignore for dictionary purposes
2. **Real content corrections** (word changes, missing words, ASR errors) — HIGH signal, these drive new entries

Use `TRIM(formattedText) != TRIM(editedText)` to filter out whitespace-only edits. Report both counts but only act on content corrections.

### Step 5: Cross-Reference with Existing Dictionary

For each ASR pattern found in Step 3, check if it's already covered:

```sql
-- Check if a misrecognition is already in dictionary
SELECT phrase, replacement
FROM Dictionary
WHERE isDeleted = 0
  AND (phrase LIKE '%<pattern>%' OR replacement LIKE '%<pattern>%');
```

Only recommend NEW entries that aren't already covered.

### Step 6: Generate Output Files

**OUTPUT FORMAT IS CRITICAL.** Wispr Flow imports CSV files literally — every line becomes a dictionary entry.

#### Vocabulary File (new words to recognize)

**File:** `wispr-vocabulary-update.csv`
**Format:** One word per line. NO headers. NO comments. NO blank lines. NO quotes unless the word itself contains a comma.

```
toml
TOML
golems.toml
agentic
```

#### Replacements File (trigger → correction mappings)

**File:** `wispr-replacements.csv`
**Format:** `trigger,replacement` per line. NO headers. NO comments. NO blank lines. NO quotes unless values contain commas.

```
tomo,toml
golems.tomo,golems.toml
Claw.md,CLAUDE.md
```

## Output Validation Gate

**MANDATORY before declaring done.** Run these checks on every generated file:

```bash
# Check 1: No comment lines (lines starting with #)
grep -c '^#' OUTPUT_FILE && echo "FAIL: Comments found" || echo "PASS: No comments"

# Check 2: No blank lines
grep -c '^$' OUTPUT_FILE && echo "FAIL: Blank lines found" || echo "PASS: No blank lines"

# Check 3: No header lines (common CSV headers)
grep -ciE '^(phrase|word|trigger|replacement|vocabulary|category)' OUTPUT_FILE && echo "FAIL: Header found" || echo "PASS: No headers"

# Check 4: Replacements file has exactly one comma per line
awk -F',' 'NF!=2 {print "FAIL line " NR ": " $0; exit 1}' REPLACEMENTS_FILE && echo "PASS: Format correct" || true

# Check 5: No markdown formatting
grep -cE '^\||\*\*|^##|^-' OUTPUT_FILE && echo "FAIL: Markdown found" || echo "PASS: No markdown"
```

**If ANY check fails, fix the file and re-validate. Do NOT declare success with failing validation.**

## Anti-Patterns

| DO NOT | WHY | DO INSTEAD |
|--------|-----|------------|
| Add `# comment` lines to CSV | Wispr imports them as dictionary entries | Keep files pure data only |
| Add CSV headers (`phrase,replacement`) | Imported as a dictionary entry | Start with data directly |
| Put stats/analysis in the CSV | Gets imported as entries | Write analysis to a separate .md file |
| Add blank lines for readability | May create empty dictionary entries | No blank lines ever |
| Combine vocabulary + replacements | Different import workflows | Two separate files always |
| Query the production database | Risk of corruption | Copy to /tmp first |
| Add entries without checking existing | Creates duplicates | Always cross-reference Step 5 |

## Output Deliverables

Every run MUST produce exactly 3 files:

1. **`wispr-vocabulary-update.csv`** — New vocabulary words (one per line, no metadata)
2. **`wispr-replacements.csv`** — New trigger→replacement mappings (trigger,replacement per line)
3. **`wispr-mining-report.md`** — Analysis report with:
   - Total records analyzed
   - Top ASR misrecognition patterns (with counts)
   - User edit patterns found
   - Dictionary effectiveness stats (% of entries with >0 uses)
   - Recommended entries with justification
   - Gap analysis (high-frequency misrecognitions not in dictionary)

**The .md report is where analysis goes. The CSVs are PURE DATA ONLY.**

## Periodic Mining Schedule

Run this skill quarterly or when:
- User reports frequent voice corrections in a new domain
- New project vocabulary emerges (new repo names, tool names, client names)
- Dictionary cleanup needed (removing unused entries)
