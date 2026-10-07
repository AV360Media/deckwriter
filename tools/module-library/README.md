# Module library tools

Regenerates `src/data/library.json`: the actions, feedbacks, presets and connection settings DeckWriter offers for a Companion module.

1. Download a module from the Companion module store, e.g. `https://developer.bitfocus.io/api/v1/companion/modules/connection/bmd-atem` lists versions with a `tarUrl` and `tarSha`. Check the SHA-256, then unpack it into `work/<module-id>/`.
2. Run the harness with Companion's own Node (this runs the module's code, the same code Companion would run):

   ```bash
   N=/Applications/Companion.app/Contents/Resources/node-runtimes/node22/bin/node
   $N harness.js work/bmd-atem/<folder with companion/manifest.json> out-bmd-atem.json $N
   ```

   `CONFIG_OVERRIDE='{"modelID":31}'` sets connection settings first (ATEM: model). `HDEBUG=1` logs every message.
3. Add the module id to `MODS` in `convert.py` and run `python3 convert.py`. It writes `library.json`; copy it to `src/data/library.json`.
4. `npm run build && npm test`.
