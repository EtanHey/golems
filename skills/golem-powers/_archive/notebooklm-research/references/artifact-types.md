# NotebookLM Artifact Types — Complete Reference

## Audio Overview (Podcast)

| Option | Values | Default |
|--------|--------|---------|
| `audio_format` | deep_dive, brief, critique, debate | deep_dive |
| `audio_length` | short, default, long | default |
| `language` | BCP-47 code (en, he, es, fr, etc.) | en |
| `focus_prompt` | Optional focus text | — |
| `source_ids` | Specific sources (default: all) | all |

**Generation time:** 1-3 minutes. **Download format:** MP3/MP4.

## Video Overview

| Option | Values | Default |
|--------|--------|---------|
| `video_format` | explainer, brief | explainer |
| `visual_style` | auto_select, classic, whiteboard, kawaii, anime, watercolor, retro_print, heritage, paper_craft | auto_select |
| `language` | BCP-47 code | en |

**Generation time:** 3-10 minutes. **Download format:** MP4.

## Slide Deck

| Option | Values | Default |
|--------|--------|---------|
| `slide_format` | detailed_deck, presenter_slides | detailed_deck |
| `slide_length` | short, default | default |

**Download formats:** PDF (default) or PPTX (`slide_deck_format="pptx"`).

**Revision:** Use `studio_revise` to revise individual slides after creation.

## Report

| Option | Values | Default |
|--------|--------|---------|
| `report_format` | Briefing Doc, Study Guide, Blog Post, Create Your Own | Briefing Doc |
| `custom_prompt` | Required when format is "Create Your Own" | — |

**Download format:** Markdown. **Export:** Google Docs via `export_artifact`.

## Infographic

| Option | Values | Default |
|--------|--------|---------|
| `orientation` | landscape, portrait, square | landscape |
| `detail_level` | concise, standard, detailed | standard |
| `infographic_style` | auto_select, sketch_note, professional, bento_grid, editorial, instructional, bricks, clay, anime, kawaii, scientific | auto_select |

**Download format:** PNG.

## Quiz

| Option | Values | Default |
|--------|--------|---------|
| `question_count` | integer | 2 |
| `difficulty` | easy, medium, hard | medium |

**Download formats:** JSON, Markdown, or HTML (`output_format` parameter).

## Flashcards

| Option | Values | Default |
|--------|--------|---------|
| `difficulty` | easy, medium, hard | medium |

**Download formats:** JSON, Markdown, or HTML.

## Mind Map

| Option | Values | Default |
|--------|--------|---------|
| `title` | Map title | "Mind Map" |

**Download format:** JSON.

## Data Table

| Option | Values | Default |
|--------|--------|---------|
| `description` | Required — describes what table to create | — |

**Download format:** CSV. **Export:** Google Sheets via `export_artifact`.
