"""Measure where the head sits in each driver portrait (assets/drivers/official/*.webp) so avatars can crop every one to
its own face. Writes assets/drivers/official/framing.json: per portrait, the head's centre (x) and top (y) and its width,
as fractions of the image width. Run after scripts/fetch-official-assets.mjs; needs Pillow.

The portraits are transparent cut-outs: the head is the first opaque rows from the top, narrower than the shoulders."""
from pathlib import Path
import json
import sys

from PIL import Image

FOLDER = Path(__file__).resolve().parents[1] / 'assets' / 'drivers' / 'official'


def measure(path: Path) -> dict | None:
    image = Image.open(path).convert('RGBA')
    width, height = image.size
    alpha = image.getchannel('A').point(lambda a: 255 if a > 96 else 0)
    rows = []
    for y in range(height):
        line = alpha.crop((0, y, width, y + 1)).getbbox()
        rows.append((line[0], line[2]) if line else None)
    top = next((y for y, r in enumerate(rows) if r), None)
    if top is None:
        return None
    # The head: the rows from the top of the hair to just above the chin (about a third of the image width tall);
    # the shoulders start below that, so they never widen the measurement.
    band = [r for r in rows[top:top + int(width * .34)] if r]
    if not band:
        return None
    widest = max(r[1] - r[0] for r in band)
    face = [r for r in band if (r[1] - r[0]) >= widest * .8]   # the broad part of the head: temples to cheeks
    centre = sorted((r[0] + r[1]) / 2 for r in face)[len(face) // 2]
    return {'head_x': round(centre / width, 4), 'head_top': round(top / width, 4), 'head_w': round(widest / width, 4)}


def main() -> int:
    out = {}
    for path in sorted(FOLDER.glob('*.webp')):
        frame = measure(path)
        if frame:
            out[path.stem] = frame
    (FOLDER / 'framing.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
    print(f'{len(out)} portraits measured')
    return 0


if __name__ == '__main__':
    sys.exit(main())
