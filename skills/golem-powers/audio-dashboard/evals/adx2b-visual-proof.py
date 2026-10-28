"""Compose ADX2b (AD-16) proof: before/after stills and pixel diffs of a PR-referencing card.
Capture docs.local/adx2b-proof/{before,after}/{1280,390}-card.png first, rendering one synthetic card
(rail rows: Owner, PR #39 with a GitHub href, Design with an https href) with origin/master's renderer
and with this branch's, in Chromium at 1280x844 and 390x844.
"""
from pathlib import Path
from PIL import Image, ImageChops

source = Path('docs.local/adx2b-proof')
out = Path('skills/golem-powers/audio-dashboard/evals/fixtures/visual-proof/adx2b')
out.mkdir(parents=True, exist_ok=True)
for width in (1280, 390):
    images = []
    for phase in ('before', 'after'):
        image = Image.open(source / phase / f'{width}-card.png').convert('RGB')
        image.save(out / f'{width}-{phase}.png', optimize=True)
        images.append(image)
    ImageChops.difference(*images).save(out / f'{width}-pixel-diff.png', optimize=True)
for file in sorted(out.iterdir()):
    assert file.stat().st_size < 400_000, file
    print(file.name, file.stat().st_size)
