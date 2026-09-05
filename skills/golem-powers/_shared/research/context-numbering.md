# Research Context Numbering

Canonical numbering for Drive-backed research context. Define it once here and reference it from the research skills.

## Ranges

| Range | Category | Source | Format |
|-------|----------|--------|--------|
| `00` | Code map | Repo structure, key files, focus areas | `.md` |
| `01-19` | Source code | Core implementation files | `.py.txt`, `.ts.txt`, `.tsx.txt` |
| `20-29` | Hooks and scripts | `~/.claude/hooks/`, automation glue | `.py.txt`, `.sh.txt` |
| `30-39` | Config | Repo root config, MCP config, launch agents | `.json.txt`, `.yaml.txt`, `.md` |
| `40-49` | Data samples | Read-only DB exports, JSON samples | `.json.txt` |
| `50-59` | Native code | Swift, Rust, platform-specific code | `.swift.txt`, `.rs.txt` |
| `60-69` | Live examples | Real MCP output, command output, traces | `.txt`, `.json.txt` |
| `70-79` | Usage patterns | Skills, example prompts, real sessions | `.md`, `.json.txt` |
| `80-89` | Vision and design | Architecture notes, constraints, plans | `.md` |
| `90-99` | Research history | Prior R-number results, gap analyses | `.md` |
| `100+` | Post-sprint updates | Fresh context generated after earlier batches | `.md` |

## Generation Pattern

1. `00`: generate a code map first so later files are selected intentionally.
2. `01-19`: pull the top source files that actually anchor the research question.
3. `20-39`: include only the hooks/config that change runtime behavior or constraints.
4. `40-49`: export real samples, not fabricated examples.
5. `60-69`: capture live tool output when platform behavior matters.
6. `70-99`: layer in usage history, design context, and prior research only after the core implementation context exists.

## File Type Rules

| Original | Context File |
|----------|--------------|
| `.py` | `.py.txt` |
| `.ts` / `.tsx` | `.ts.txt` / `.tsx.txt` |
| `.swift` | `.swift.txt` |
| `.json` | `.json.txt` |
| `.yaml` / `.yml` | `.yaml.txt` |
| `.md` | `.md` |

## NotebookLM Prioritization

When source limits matter, include these first:

1. `00`
2. `01-19`
3. `40-49`
4. `60-69`

This keeps the notebook grounded in structure, implementation, real data, and actual behavior before you spend slots on history or narrative context.
