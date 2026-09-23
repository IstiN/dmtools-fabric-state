# dmtools-fabric-state

Factory board — real-time visualization of the SM tick snapshots for any
factory repo running the dmtools-agents state publishing
(`js/factoryState.js`, OPT-IN via `statePublish` in the tick config).

Zero build, zero backend: static files + the token-free
`raw.githubusercontent.com/<repo>/factory-data/data/<asset>` snapshots.

## Use

- Open `index.html` — the preconfigured factories (tabs) render immediately.
- Ad-hoc: `?repo=IstiN/flutter_agent_harness` — any factory repo; the board
  probes the canonical asset names (`factory-state.json`,
  `<name>-state.json`, `fa-state.json`, `dart-state.json`).
- Deep link a tab: `?tab=dart`.

## Customize (config.js — the only file to touch)

- `factories[]` — add/remove factories: `id`, `name`, `stateUrl`, `accent`.
- `refreshMs` — poll cadence (the snapshot itself updates per SM tick).
- `title`, `logo` — branding.
- `lanes[]` — lane order/titles (ids must match the state schema:
  `validating`, `approved_queue`, `review`, `fresh`).
- `badgeLabels[]` — which PR labels render as hot badges.
- Theme: `?theme=light|dark` or the toggle button; style knobs live in the
  `:root` CSS variables of `styles.css` (accent per factory in config).

## Wire into a site

Static-host the folder (Pages, fa1.dev, anywhere) and iframe/link it;
the styling is plain CSS-variable driven, so wrapping it in your brand
is a variables-only job.
