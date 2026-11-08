# F1 Apex Data

F1 telemetry comparison dashboard, using FastF1 for historical real session data.

## Run it

```cmd
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
npm ci
npm run local
```

This starts the compute service on this PC (127.0.0.1:54123; Python on 127.0.0.1:8000). There is one site: open
https://f1apexdata.eufrandota14.chatgpt.site/apex/ and choose **Use this PC** under Compute settings. Published and saved
data is shown first; anything not published yet is calculated on this PC and cached on disk. The service's own
address only redirects to the site. Without it running, the site shows published data only.

For development, `npm run sync:apex` then `node scripts/serve-static.mjs 54140` serves the site from this PC; it uses
the same compute service the published site does.

## Source, local data and publication

GitHub main contains source, curated recordings and test fixtures. Locally
generated `assets/data/local-captures` and `assets/data/local-telemetry` are
ignored: do not merge a preparing checkout or its snapshot branch into main.
Use `npm run site:sync-prepared -- --from <preparing-folder> --to <site-folder>`
to inspect changes, then repeat with `--apply` to stage them in the Site checkout.
Pull latest main before preparing a release. Keep generated data in the Site's
source repository only, not GitHub main. The Site checkout explicitly stages
these generated paths with `git add -f` before packaging.

Run `npm run release:check -- --source` on a source-only checkout. Publication
requires the strict `npm run release:check` after prepared data is staged.
Browser tests use their own recorded fixtures and do not depend on local exports.

The hosted site serves prepared snapshots and never computes; Python computations run on the PC, either for the
person using it (Use this PC) or to prepare results for publication (`npm run site:warm`).

The first load for a session downloads and caches FastF1 data; later loads are much faster. FastF1 provides historical timing and telemetry coverage from 2018 onward, including speed, RPM, gear, throttle, brake and DRS. [FastF1 documentation](https://docs.fastf1.dev/data_reference/index.html)
