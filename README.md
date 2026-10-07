# DeckWriter

Design Stream Deck pages for Bitfocus Companion: lay out keys, label and colour them, give them icons, build their actions from real module definitions, then export a page file that Companion imports as a new page.

- **Production:** https://bryanchorton.github.io/deckwriter/
- **Test build:** https://bryanchorton.github.io/deckwriter/index.test.html

(Both work once GitHub Pages is on: Settings > Pages > Source: GitHub Actions.) You can also download `index.html` and open it in Chrome or Edge; it is one file and works offline (fonts and icons load from a CDN when online).

| File | What it is |
|---|---|
| `index.html` | Production app. Changes only when the test build is promoted. |
| `index.test.html` | Test build of `src/`. Every edit lands here first. Shows a red TEST BUILD tag and keeps its own autosave. |
| `src/app.html` | The app: markup, CSS and script in one file. |
| `src/data/library.json` | Actions, feedbacks, presets and connection settings for ATEM, vMix, Resolume Arena, OSCPoint and Mitti, taken from the modules themselves. |
| `src/data/catalog.json` | All 857 connection types in the Companion module store. |
| `tools/module-library/` | Scripts that regenerate `library.json` from Companion modules. |

## Test and production

1. Edit files in `src/`, then run `npm run build`. That rewrites `index.test.html`. Commit both.
2. `npm test` checks the test build: the script parses, the data is complete, every element the script uses exists, exports stay on Companion's format, and `index.test.html` is current. GitHub runs the same checks on every push.
3. When the test build is right, say **"Promote to production"** to Claude. It runs `npm run promote`, which re-runs every check and writes `index.html` only if all pass, then commits and pushes to `main`.

`npm run dev` rebuilds the test build on every save. No packages to install; any Node 18+ works.

## Quick start

1. Pick your Stream Deck model at the top left (Mini, Neo, MK.2, XL or +).
2. Fill keys:
   - **Presets** (bottom dock): drag a ready-made button onto any key, or click to fill the next empty key. Every preset gets a matching icon.
   - **Prompt**: describe an automation in plain English and Claude builds the keys (works when DeckWriter is opened inside Claude).
   - Click an empty key and **New button** to build one by hand.
3. Click a key to edit it on the right: **Look** (label, size, colours), **Image** (icons, emoji, gradients, uploads), **Actions** and **Feedback**. For ATEM, vMix, Resolume, OSCPoint and Mitti, actions and feedbacks are picked from dropdowns with real option fields.
4. Drag keys to move them, Option-drag to copy, Shift-click to select several, right-click for Copy, Paste, Duplicate, Delete and Wipe page.
5. Click **Export page** and save. In Companion, open **Import / Export**, choose the file, set **Destination Page** (step past the last page to make a new one), match the connections and click **Import**.

Files saved from this site are named `*.companionconfig` and import directly. Inside Claude they save as `*.companionconfig.json`; remove the `.json` first.

## Moving between computers

DeckWriter keeps your work in the browser of the computer you're on. To take it to another machine, click **Save project** in the bottom bar. You get one `.json` file with every page, button, image, connection and the boot screen. On the other computer, open DeckWriter and click **Open project** (or drop the file on Import). The file name becomes the project name, so rename it in Finder if you like. Live's record of what's on a Stream Deck stays on each computer.

## Live: edit buttons on a running show

Live sends each key you add, change, move or delete straight to Companion, one key at a time, without importing.

1. Set up Live on the Companion Mac, once: paste this into Terminal. It installs the relay as an on-demand background service (a LaunchAgent using Companion's own Node) plus a tiny helper app, *DeckWriter Live*, that answers `deckwriter-live://` links. Nothing runs at login: clicking **Live** in DeckWriter opens that link (Chrome asks once; tick *Always allow*), the helper starts the relay with no window, and the relay stops itself 10 minutes after DeckWriter stops checking in. Each start fetches the latest relay:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/bryanchorton/deckwriter/main/tools/live/install.sh | bash
   ```

   To remove it: `curl -fsSL https://raw.githubusercontent.com/bryanchorton/deckwriter/main/tools/live/install.sh | bash -s -- --uninstall`. Its log is `~/Library/Logs/DeckWriter-relay.log`.

2. Open DeckWriter from this site in Chrome (Live can't run inside Claude). Link Companion in **Connections**.
3. Click **Live** in the top bar and switch **Live updates on**. Live follows the page you have open: DeckWriter's pages line up with Companion's in order, the boot page is always Companion page 1, and Live never touches it.

Companion is the source of truth. When Live switches on (and whenever DeckWriter opens with Live on, or you come back to its window) DeckWriter loads Companion's pages and buttons, so edits made in Companion show up here; keys that already match are left alone. From then on every key you add, change, move or delete here goes straight to Companion, and so do new, deleted and renamed pages and Cmd+Z. Wipe page empties the Companion page too. Opening a project file pauses Live so Companion doesn't replace it. **Load from Companion** reloads by hand; **Send whole page now** pushes every key on the page.

**Mirror** (deck header) lays Companion's own picture of every key over DeckWriter's deck, live: real variable values, tally, timers. **Show mode** opens a full-screen deck on this Mac where tapping a key presses it in Companion (holding holds); its page arrows and page up/down keys change pages in Show mode only. **Colours** (bottom bar) colours every key by the app it controls; with Live on only the background and text colour change in Companion.

The relay (`tools/live/relay.mjs`) listens only on 127.0.0.1:8790 and only answers DeckWriter's own origins. It drives Companion's internal editor API (the one Companion's web UI uses), which is unofficial and was built against Companion 5.0.x: after a Companion update, try Live on a spare page before relying on it.

## Other tools

- **Connections**: add any of the 857 Companion connection types; for the five apps with a full library, the gear sets the connection up (IP and so on) and that goes into the export.
- **Tally pack**: adds live (red) and preview (green) colours to scene, input and record keys.
- **Cheat sheet**: a printable map of every key and what it does.
- **Boot screen**: an animation across every key on page 1, played by a Companion trigger when Companion starts or the deck is plugged in. Export page 1 and import it as page 1, then save and import the startup trigger.
- **Import**: load a Companion export to add its connections and learn the action names you already use.

## Companion notes

- Exports use Companion's export format version 6 (Companion 3.x). Companion 4 and 5 upgrade it on import.
- Buttons export with the top bar off so they look the same in Companion as in DeckWriter.
- Companion only imports files ending in `.companionconfig` or `.yaml`.
