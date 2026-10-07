# DeckWriter: notes for Claude

Stream Deck page designer for Bitfocus Companion. The owner runs Companion 5 on a Mac with a Stream Deck XL and mostly uses ATEM, vMix, Resolume Arena, OSCPoint and Mitti.

## Workflow (same as wall-mapper and vMix-Pip-Builder)

- Edit only `src/` (`src/app.html`, `src/data/*.json`). Never hand-edit `index.html` or `index.test.html`.
- After an edit: `npm run build` (writes `index.test.html`), `npm test`, commit `src/` and `index.test.html` together.
- "Promote to production" means: `npm run promote` (re-checks, then writes `index.html`), commit, push to `main`. Promote only when asked.
- No Node on the owner's Mac by default; Companion ships one: `/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node`.
- The app is also published as a Claude artifact. `npm run artifact` writes `dist/artifact.html` (body only) for that.

Renamed from Deckwright to DeckWriter on 2026-10-06. The browser storage keys (`deckwright.v1`, `deckwright.drawer`, and the `.test.` versions) keep the old name on purpose so saved projects survive; don't rename them.

## Structure of src/app.html

One file: `<title>`, `<style>` with design tokens on `:root` (single dark theme, Geist / Geist Mono, lime/pink/yellow accents after RonDesignLab's PicGen workflow UI), the markup, then one inline `<script>`. `build.mjs` swaps `/*@data:library*/null` and `/*@data:catalog*/null` for the JSON in `src/data/`.

Inside Claude the page uses `window.claude.use("sample")` (AI build, restyle, tally, icon drawing, cheat sheet text) and `use("downloads")` (saving). Outside Claude both resolve to nothing: AI features say so, and `saveFile()` falls back to a normal browser download with the real file name.

## Companion format (verified against Companion's source)

- Page export: `{version:6, type:"page", page:{name, controls:{row:{col:control}}, gridSize}, instances, oldPageNumber}`. Actions `{id, action, instance, options}`; feedbacks `{id, type, instance_id, options, style, isInverted}`. Style `show_topbar:false`.
- Sizes: Companion 5 converts a legacy text size n to fontsize n / 0.6 (no top bar). Any number works; presets use 14/12/10 from `layoutLabel()`.
- Companion only accepts `.companionconfig` or `.yaml` on import. The Claude downloads capability cannot write that extension, so inside Claude files end in `.companionconfig.json`.
- Boot screen: each page-1 key carries one `variable_value` feedback per frame on `internal:custom_boot_frame` with a `png64` style; a separate `trigger_list` export steps the variable on `startup` and on `variable_changed` of `internal:surface_<id with : as _>_location` (fires when that deck connects). Without the trigger only the final image shows.

## Module library (tools/module-library)

`harness.js` stands in for the Companion host: it starts a module (v1 modules directly; v2 modules through Companion's own `ConnectionThread.js` with `MODULE_ENTRYPOINT`), answers `register` with `{connectionId, moduleApiVersion}`, calls `getConfigFields`/`init`, and records `setActionDefinitions`, `setFeedbackDefinitions`, `setPresetDefinitions`. `convert.py` turns that into `library.json`, expanding Companion 5 template presets and replacing `$(local:…)` variables. Running third-party module code needs the owner's OK each time.

## Live mode (tools/live/relay.mjs)

Companion's editor API is a tRPC websocket at `/trpc` that rejects browser connections from other origins (CSWSH guard) but accepts local programs with no Origin header. The relay connects as a local program and exposes `GET /status`, `POST /push {page,row,column,control}` and `POST /clear {page,row,column}` on 127.0.0.1:8790, CORS-limited to DeckWriter's origins. A push rebuilds one key the way Companion's editor would: `controls.resetControl` (newType `button-layered`), then `controls.styles.updateOption` on `canvas`/`box0`/`text0` (+ `addElement` image), `controls.steps.add`, `controls.entities.add`/`setOption`/`setInverted`, and feedback colours by editing the default overrides read back with `controls.watchControl`. Text size n becomes fontsize n / 0.6, matching Companion's legacy conversion. Built and tested against Companion 5.0.7 (procedure names come from that tag). Never use `importExport.importSinglePage` for this: it resets the whole page.

DeckWriter side: `liveSync()` diffs export controls per key (`keyHash` ignores entity ids) against `S.live.owned[pageId]` (keys it sent) and `S.live.base[pageId]` (snapshot taken when Live first sees a page, never sent or cleared). There is no page picker: `livePageNum()` lines show pages up with Companion pages in order (+1 when a boot page exists) and `liveBlocked()` refuses the boot page. The owner tested it on a "DeckWriter test" page (Companion page 3).
