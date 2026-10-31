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

Then open http://127.0.0.1:54123/apex/.

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

The hosted site serves prepared snapshots; Python computations run on the PC.
`npm run site:warm` prepares local captured results, not a retired hosted Python
service. Vercel and Render deployment configurations are no longer maintained.

The first load for a session downloads and caches FastF1 data; later loads are much faster. FastF1 provides historical timing and telemetry coverage from 2018 onward, including speed, RPM, gear, throttle, brake and DRS. [FastF1 documentation](https://docs.fastf1.dev/data_reference/index.html)
