"""Package the user-provided artwork; no redraw, retouching or generated pixels."""
from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parents[1] / 'assets'
source = Image.open(assets / 'euv2-gauge.png').convert('RGB')
# The supplied image contains a large square gauge and a separate wordmark.
# Export those two existing regions at display-appropriate sizes.
wordmark = source.crop((110, 906, 1145, 1132))
wordmark.resize((414, 90), Image.Resampling.LANCZOS).save(assets / 'euv2-wordmark.webp', quality=94)
gauge = source.crop((236, 99, 1018, 859))
for size in (32, 180, 256):
    gauge.resize((size, size), Image.Resampling.LANCZOS).save(assets / f'euv2-icon-{size}.png', optimize=True)
