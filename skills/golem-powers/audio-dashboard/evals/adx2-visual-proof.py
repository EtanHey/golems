"""Compose ADX2 (AD-15/AD-16) proof: before/after stills, pixel diffs and frame-sequence GIFs.
Run the browser eval with ADX2_OUTPUT=docs.local/adx2-proof/after, and capture the same synthetic spec
with origin/master's renderer into docs.local/adx2-proof/before/{1280,390}-card.png, before this script.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

source = Path('docs.local/adx2-proof')
out = Path('skills/golem-powers/audio-dashboard/evals/fixtures/visual-proof/adx2')
out.mkdir(parents=True, exist_ok=True)
for width in (1280, 390):
    images = []
    for phase in ('before', 'after'):
        image = Image.open(source / phase / f'{width}-card.png').convert('RGB')
        image.save(out / f'{width}-{phase}.png', optimize=True)
        images.append(image)
    ImageChops.difference(*images).save(out / f'{width}-pixel-diff.png', optimize=True)
    for state in ('loading', 'loaded', 'error', 'timeout', 'retry-loaded'):
        Image.open(source / 'after' / f'{width}-{state}.png').convert('RGB').save(out / f'{width}-{state}.png', optimize=True)

def frame(width, name, label, phase='after'):
    im = Image.open(source / phase / f'{width}-{name}.png').convert('RGB')
    canvas = Image.new('RGB', (im.width, im.height + 52), 'white')
    canvas.paste(im, (0, 52))
    ImageDraw.Draw(canvas).text((8, 8), label, fill='black', font=ImageFont.load_default(size=16))
    return canvas.quantize(colors=96)

def gif(name, frames):
    frames[0].save(out / name, save_all=True, append_images=frames[1:], duration=1100, loop=0, optimize=True)

gif('comparison-load.gif', [frame(390, 'card', '1. View comparison'), frame(390, 'loading', '2. Loading, bounded'), frame(390, 'loaded', '3. Loaded')])
gif('comparison-timeout-retry.gif', [frame(390, 'slow-loading', '1. Server stalls'), frame(390, 'timeout', '2. Times out at the bound'), frame(390, 'retry-loaded', '3. Retry (Enter) loads')])
gif('comparison-error-back.gif', [frame(1280, 'error', '1. Network error: message, Retry, Back'), frame(1280, 'card', '2. Back returns focus to the card')])
for file in sorted(out.iterdir()):
    assert file.stat().st_size < 400_000, file
    print(file.name, file.stat().st_size)
