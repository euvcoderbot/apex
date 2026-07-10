# APEX DATA

F1 telemetry comparison dashboard, using FastF1 for historical real session data.

## Run it

```cmd
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --reload
```

Then open http://127.0.0.1:8000.

The first load for a session downloads and caches FastF1 data; later loads are much faster. FastF1 provides historical timing and telemetry coverage from 2018 onward, including speed, RPM, gear, throttle, brake and DRS. [FastF1 documentation](https://docs.fastf1.dev/data_reference/index.html)
