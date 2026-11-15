"""Driver photos for drivers who have none: each driver's lead photo on Wikipedia, from Wikimedia Commons, under a free
licence only (CC BY, CC BY-SA, CC0 or public domain), cut out the way the existing ones are (rembg, background removed,
a square headshot, 256 px WebP) and credited in assets/drivers/credits.json.

The crop follows the cut-out itself: the top of the person is the top of the head, and the square is centred on the
head's width there. Review the results (a contact sheet is written next to the downloads) before committing.

Usage: .venv/Scripts/python.exe scripts/fetch-driver-photos.py <driver_id>=<Wikipedia title> [...]
Downloads go to .apex-cache/driver-photos/ (not committed).
"""
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'drivers'
CACHE = ROOT / '.apex-cache' / 'driver-photos'
UA = {'User-Agent': 'apex-data-photo-build/1.0'}
FREE = re.compile(r'^(CC BY(-SA)? \d\.\d|CC0|Public domain|PD)', re.I)


def api(host, **q):
    url = f'https://{host}/w/api.php?' + urllib.parse.urlencode({'format': 'json', 'formatversion': 2, **q})
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def strip_html(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s or '')).strip()


def lead_file(title):
    page = api('en.wikipedia.org', action='query', titles=title, prop='pageimages', piprop='name', redirects=1)['query']['pages'][0]
    return page.get('pageimage')


def commons_info(name):
    page = api('commons.wikimedia.org', action='query', titles=f'File:{name}', prop='imageinfo', iiprop='url|extmetadata', iiurlwidth=1000)['query']['pages'][0]
    info = page['imageinfo'][0]
    meta = info.get('extmetadata', {})
    return {
        'file': f'File:{name.replace("_", " ")}', 'page': info['descriptionurl'], 'url': info.get('thumburl') or info['url'],
        'author': strip_html(meta.get('Artist', {}).get('value')), 'licence': strip_html(meta.get('LicenseShortName', {}).get('value')),
        'licence_url': strip_html(meta.get('LicenseUrl', {}).get('value')),
    }


def headshot(img, session):
    cut = remove(img, session=session)                       # RGBA, background transparent
    alpha = np.array(cut)[:, :, 3] > 40
    rows = np.where(alpha.any(axis=1))[0]
    if not len(rows):
        raise ValueError('no person found')
    top, bottom = rows[0], rows[-1]
    h = bottom - top
    band = alpha[top + int(h * .04): top + int(h * .14)]       # the head, just below its top
    cols = np.where(band.any(axis=0))[0]
    cx = (cols[0] + cols[-1]) / 2 if len(cols) else alpha.shape[1] / 2
    head = (cols[-1] - cols[0]) if len(cols) else h * .3
    side = int(max(head * 2.3, h * .38))
    x0 = int(cx - side / 2)
    y0 = int(top - side * .1)
    box = (x0, y0, x0 + side, y0 + side)
    return cut.crop(box).resize((256, 256), Image.LANCZOS)


def main(pairs):
    CACHE.mkdir(parents=True, exist_ok=True)
    credits_path = OUT / 'credits.json'
    credits = json.loads(credits_path.read_text(encoding='utf-8'))
    session = new_session('isnet-general-use')
    done = []
    for pair in pairs:
        driver, title = pair.split('=', 1)
        try:
            name = lead_file(title)
            if not name:
                print(f'{driver}: no lead image on "{title}"'); continue
            info = commons_info(name)
            if not FREE.match(info['licence']):
                print(f'{driver}: skipped, licence "{info["licence"]}" is not free'); continue
            raw = urllib.request.urlopen(urllib.request.Request(info['url'], headers=UA), timeout=60).read()
            (CACHE / f'{driver}.src').write_bytes(raw)
            img = Image.open(io.BytesIO(raw)).convert('RGB')
            headshot(img, session).save(OUT / f'{driver}.webp', 'WEBP', quality=88, method=6)
            credits['photos'][driver] = {'name': title.split(' (')[0], 'file': info['file'], 'page': info['page'], 'author': info['author'] or 'Unknown',
                                         'licence': info['licence'], 'licence_url': info['licence_url'], 'changes': 'cropped, background removed'}
            done.append(driver)
            print(f'{driver}: {info["licence"]}, {info["author"][:40]}, {info["file"][:60]}')
        except Exception as e:
            print(f'{driver}: failed ({type(e).__name__}: {e})')
    credits['photos'] = dict(sorted(credits['photos'].items()))
    credits_path.write_text(json.dumps(credits, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    # Contact sheet for review: every new photo on a grey disc.
    if done:
        sheet = Image.new('RGB', (140 * len(done), 150), (40, 40, 40))
        for i, d in enumerate(done):
            im = Image.open(OUT / f'{d}.webp').resize((128, 128))
            disc = Image.new('RGBA', (128, 128), (90, 90, 90, 255))
            sheet.paste(Image.alpha_composite(disc, im).convert('RGB'), (i * 140 + 6, 6))
        sheet.save(CACHE / 'sheet.png')
        print('contact sheet:', CACHE / 'sheet.png')


if __name__ == '__main__':
    main(sys.argv[1:])
