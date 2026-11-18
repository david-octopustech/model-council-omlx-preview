# Local council frontend

This folder contains the dependency-free browser UI for the oMLX council proxy.

- `index.html` defines the three-seat workspace, human checkpoint, review controls, and
  chairman controls.
- `styles.css` contains the responsive visual system.
- `app.js` discovers oMLX models, stores drafts/settings/history in localStorage, and
  calls the local server's `/api/council`, `/api/council/review`, and
  `/api/council/synthesize` endpoints.

The frontend is served by `python -m council.omlx_server`; it is not intended to be
opened directly from `file://`, because browser requests need the local API origin.
See [`../docs/omlx-local-council.md`](../docs/omlx-local-council.md) for installation,
privacy, and user instructions.
