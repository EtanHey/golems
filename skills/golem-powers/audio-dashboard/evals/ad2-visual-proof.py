"""Build compact pixel diffs and frame-sequence GIFs from the real-pointer eval captures.
Run the eval with AD2_OUTPUT=docs.local/ad2/{red,green} before invoking this script.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

source = Path('docs.local/ad2')
out = Path('skills/golem-powers/audio-dashboard/evals/fixtures/visual-proof/ad2')
out.mkdir(parents=True, exist_ok=True)
for width in (1280, 390):
    images = []
    for phase in ('red', 'green'):
        image = Image.open(source / phase / f'{width}-after-click.png').convert('RGB')
        image.save(out / f'{width}-{phase}.png', optimize=True)
        images.append(image)
    ImageChops.difference(*images).save(out / f'{width}-pixel-diff.png', optimize=True)

def frame(phase, name, label):
    im = Image.open(source / phase / f'390-{name}.png').convert('RGB')
    ImageDraw.Draw(im).rectangle((0, 0, 390, 26), fill='white')
    ImageDraw.Draw(im).text((6, 7), label, fill='black')
    return im.quantize(colors=96)

click = [frame(phase, name, label) for phase, label in [('red', 'BEFORE: focus scroll interrupts word seek'), ('green', 'AFTER: pointer stays on word and seeks')] for name in ('before-click', 'down', 'after-click')]
click[0].save(out / 'word-click.gif', save_all=True, append_images=click[1:], duration=900, loop=0, optimize=True)
keys = [frame('green', name, label) for name, label in [('keyboard-start', 'AFTER: transcript keyboard focus'), ('keyboard', 'End: last word visible above dock')]]
keys[0].save(out / 'keyboard.gif', save_all=True, append_images=keys[1:], duration=1200, loop=0, optimize=True)
for file in out.iterdir():
    assert file.stat().st_size < 400_000, file
    print(file.name, file.stat().st_size)
