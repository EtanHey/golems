#!/usr/bin/env python3
"""Generate guardian golem watermark PNG for iTerm2 background.

Renders the golem name + guardian art as a watermark in the top-right corner
of a large transparent canvas. Everything in one image — no badge needed.

Usage:
  python3 generate-guardian-bg.py [title] [dim] [font_size] [output]
  python3 generate-guardian-bg.py "Golems"           # default settings
  python3 generate-guardian-bg.py "Recruiter" 0.6 22 # dimmer, bigger
  python3 generate-guardian-bg.py "Golems" 0.8 20 ~/custom-bg.png

Output: ~/.config/ralphtools/guardian-bg.png (default, override with 4th arg)
"""

import os
import re
import sys
from PIL import Image, ImageDraw, ImageFont

# Guardian art (matches GUARDIAN_ART_FULL from ascii-mascots.ts)
# Hebrew letters reversed for correct RTL reading: ת מ א = אמת (Emet/Truth)
ART_LINES = [
    "         ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
    "       ▄██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▄",
    "     ▄██▓░░░░░░░░░░░░░░░░░░░░░░░░▓██▄",
    "    ███▓░░░┌──────────────────┐░░░▓███",
    "    ███▓░░░│    ת   מ   א     │░░░▓███",
    "    ███▓░░░└──────────────────┘░░░▓███",
    "    ███▓░░░░░░░░░░░░░░░░░░░░░░░░░░▓███",
    "   ████▓░░░░■■■■░░░░░░░░░░■■■■░░░░▓████",
    "   ████▓░░░░■◆◆■░░░░░░░░░░■◆◆■░░░░▓████",
    "   ████▓░░░░■■■■░░░░░░░░░░■■■■░░░░▓████",
    "    ███▓░░░░░░░░░░░░░░░░░░░░░░░░░░▓███",
    "    ███▓░░░░╔════════════════╗░░░░▓███",
    "    ███▓░░░░║     { ·· }     ║░░░░▓███",
    "    ███▓░░░░╚════════════════╝░░░░▓███",
    "    ███▓░░░░░░░░░░░░░░░░░░░░░░░░░░▓███",
    "     ███▓░░░░░░░░░░░░░░░░░░░░░░░░▓███",
    "      ▀██▓░░░░░░░░░░░░░░░░░░░░░░▓██▀",
    "       ▀██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▀",
    "    ╔══▀██████████████████████████▀══╗",
    "    ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║",
    "    ╚════════════════════════════════╝",
    "                   ◇◇",
]

# Color palette (from ascii-mascots.ts GUARDIAN_COLORS)
COLORS = {
    "clay": (196, 120, 60),
    "dark_clay": (160, 96, 48),
    "accent": (139, 115, 85),
    "outline": (110, 85, 48),
    "glow": (255, 176, 32),
}

HEBREW_CHARS = set("אמת")
GLOW_CHARS = set("◆{}")
ACCENT_CHARS = set("╔╗╚╝║═┌┐└┘─│╠╣◇··")
CLAY_CHARS = set("▒▓█▄▀░■")


def get_char_color(ch: str) -> tuple:
    if ch in HEBREW_CHARS or ch in GLOW_CHARS:
        return COLORS["glow"]
    elif ch in ACCENT_CHARS:
        return COLORS["accent"]
    elif ch in CLAY_CHARS:
        return COLORS["clay"]
    elif ch.strip() == "":
        return (0, 0, 0)
    else:
        return COLORS["outline"]


def load_font(paths: list, size: int):
    for fp in paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def strip_emoji(text: str) -> str:
    """Strip emoji and non-Latin characters from title (Pillow can't render them)."""
    clean = re.sub(r'[^\w\s\-.]', '', text, flags=re.ASCII).strip()
    return clean if clean else "Golems"


def generate_guardian_png(
    output_path: str,
    title: str = "Golems",
    dim: float = 0.8,
    font_size: int = 20,
):
    """Render title + guardian art as watermark in the top-right."""

    clean_title = strip_emoji(title)

    # Monospace font for art (block chars, box-drawing)
    art_font = load_font([
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/SFMono-Regular.otf",
        "/Library/Fonts/SF-Mono-Regular.otf",
        "/System/Library/Fonts/Monaco.ttf",
    ], font_size)

    # Hebrew-capable font for ת מ א (Menlo/Pillow can't render Hebrew)
    hebrew_font = load_font([
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    ], font_size)

    # Title font — 2.5x art size (large but not badge-huge)
    title_font_size = int(font_size * 2.5)
    title_font = load_font([
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Verdana.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ], title_font_size)

    # Measure character cell — terminal chars are ~55% as wide as tall
    bbox = art_font.getbbox("█")
    char_h = int((bbox[3] - bbox[1]) * 1.15)
    char_w = int(char_h * 0.55)

    max_line_len = max(len(line) for line in ART_LINES)
    art_w = max_line_len * char_w
    art_h = len(ART_LINES) * char_h

    # Measure title
    title_bbox = title_font.getbbox(clean_title)
    title_w = title_bbox[2] - title_bbox[0]
    title_h = title_bbox[3] - title_bbox[1]
    title_gap = int(title_h * 0.3)

    # Total block
    block_w = max(art_w, title_w)
    block_h = title_h + title_gap + art_h

    # Canvas: 16:9
    canvas_w = 3840
    canvas_h = 2160

    # Position in top-right
    margin_right = int(canvas_w * 0.05)
    margin_top = int(canvas_h * 0.04)
    block_x = canvas_w - block_w - margin_right
    block_y = margin_top

    # Transparent background
    img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw title (centered above art)
    title_x = block_x + (block_w - title_w) // 2
    title_color = tuple(min(255, int(c * dim)) for c in COLORS["glow"]) + (min(255, int(255 * dim)),)
    draw.text((title_x, block_y), clean_title, fill=title_color, font=title_font)

    # Draw guardian art below title
    art_offset_x = block_x + (block_w - art_w) // 2
    art_offset_y = block_y + title_h + title_gap

    for row, line in enumerate(ART_LINES):
        for col, ch in enumerate(line):
            if ch == " ":
                continue
            r, g, b = get_char_color(ch)
            alpha = min(255, max(10, int(255 * dim)))
            rgba = (min(255, int(r * dim)), min(255, int(g * dim)), min(255, int(b * dim)), alpha)
            x = art_offset_x + col * char_w
            y = art_offset_y + row * char_h
            font = hebrew_font if ch in HEBREW_CHARS else art_font
            draw.text((x, y), ch, fill=rgba, font=font)

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    img.save(output_path, "PNG")
    print(f"Generated: {output_path} ({canvas_w}x{canvas_h}, '{clean_title}' + guardian)")


if __name__ == "__main__":
    title = sys.argv[1] if len(sys.argv) > 1 else "Golems"
    dim = float(sys.argv[2]) if len(sys.argv) > 2 else 0.8
    font_size = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    output = sys.argv[4] if len(sys.argv) > 4 else os.path.expanduser(
        "~/.config/ralphtools/guardian-bg.png"
    )
    generate_guardian_png(output, title=title, dim=dim, font_size=font_size)
