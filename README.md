# ReadLigero — offline reader + vocabulary trainer (PWA)

Plain static site: **no build step, no server code, no dependencies to install.** Vanilla JS, Dexie (IndexedDB),
pdf.js, epub.js, JSZip, fflate, xz-decompress — all vendored in `lib/`.

## Run it

```bash
python3 -m http.server 8080          # or: npx serve .      or: npm start
# open http://localhost:8080
```

`localhost` counts as a secure context, so the service worker and install prompt work there.
For a phone you need **HTTPS** (any static host: GitHub Pages, Netlify, Cloudflare Pages, your own nginx),
or Chrome remote debugging with port forwarding (`chrome://inspect` → *Port forwarding* `8080 → localhost:8080`).

**Before every deploy** (after changing any file) run:

```bash
node tools/gen-precache.js
```

It rewrites `precache-manifest.js` (list of all files + a content hash). The service worker precaches that list,
and a new hash makes installed clients download the new version (they are asked before reloading).

## Install on Android

Open the HTTPS URL in Chrome → menu → **Install app** (or the install banner). The manifest now has a stable `id`,
`start_url`/`scope`, `display: standalone`, 192 + 512 PNG icons, a maskable icon and an SVG icon; the service worker has a
`fetch` handler and precaches the whole app. Previously the icon files did not exist and `sw.js` precached differently
named files, which is why Chrome refused to treat it as installable.

## What changed (by requirement)

| Area | Where |
|---|---|
| PWA install + 100 % offline | `manifest.json`, `sw.js`, `precache-manifest.js`, `icons/`, `lib/` (pdf.js CMaps + standard fonts included) |
| IndexedDB schema v5, persistent storage, backup | `dbschema.js`, `db.js`, `backup.js`, Settings → *Backup & storage* |
| Dictionary import (WikDict / FreeDict / TSV) in a Web Worker | `dictworker.js`, `dictcore.js`; Settings → Study languages → Add/Edit |
| Gloss + highlight settings | Settings → *Vocabulary highlighting* |
| Book display (screen mode, orientation, zoom, position, lock) | `display.js` + reader bar + Settings → *Book display* (one shared state) |
| Isolated zoom (UI chrome stays 100 %) | `#bookStage` in `index.html`, `reader.js`, `style.css` |
| External dictionary / translator presets | `extlinks.js` |
| Dictionary bottom sheet + prefilled *New word* (no autofocus) | `app.js` (`openDictSheet`, `openWordModal`) |
| *Start* button, SM-2 SRS | `quiz.js` (engine), `app.js` (session UI) |
| Native language names | `ENDONYMS` in `app.js` |

### Dictionaries

* **WikDict** (`.zip`) and **FreeDict** (`.tar.xz` or `.zip`) containing StarDict files `.ifo` + `.idx` + `.dict(.dz)` (+ optional `.syn`).
* **Local TSV**, headerless: `Word<TAB>Transcription<TAB>Translation`.
* Entries are stored as rows keyed `[lang+key]` (normalized: lower-case, NFC, unified apostrophes) with a second index
  `[lang+fold]` (accent-insensitive). Every lookup is an index hit, never a scan. `.syn` synonyms are stored as references.
* Importing again for the same language **replaces** the dictionary. Dictionaries are not part of the JSON backup (re-import the original file).

### SRS (SM-2 / Anki-style)

Per word: `status` (new/learning/review/relearning), `easeFactor`, `interval` (days), `repetitions`, `nextReviewDate`
(+ `lapses`, `step`). New cards go through steps 1 min → 10 min → 1 day; *Easy* graduates to 4 days; review intervals use
`interval × ease` (with an overdue bonus); *Again* on a review card is a lapse (ease −0.20, relearn after 10 min).
The queue is: due learning cards → overdue reviews (most overdue first) → *New words per session* (default 10; Quiz tab and Settings).
*Again* and learning-step cards are re-queued inside the running session; every answer is saved immediately.
Existing words are migrated automatically from the old FSRS-style fields.

### Backup

Settings → *Export backup* writes a JSON file (vocabulary + SRS state, progress, bookmarks, look-ups, settings, languages;
optionally the book files). *Import* merges. Books are matched by title + size — so either export **with books**, or add the same book
files first and import afterwards, to get reading progress back.

## Tests

```bash
npm test                       # portable unit tests (SRS engine, dictionary parsers, external-link builder)
python3 tests/make-fixtures.py # (re)build StarDict/TSV fixtures
# Browser end-to-end tests (Playwright + Chromium; edit the require() path at the top for your machine):
python3 -m http.server 8765 &  node tests/e2e-smoke.js && node tests/e2e-features.js && node tests/e2e-formats.js && node tests/e2e-migration.js
```

## Known limitations — please read

* **Not tested on a real phone.** Everything above was verified in desktop Chromium (390×780 viewport) incl. offline reload, install
  prerequisites, worker import, PDF/EPUB/TXT zoom, migration. Android *intent* launches, real Fullscreen/orientation lock and touch pinch
  need a check on your device.
* **External app links:** translator "app" entries use Android `intent:` URLs with the app package and a web fallback; iOS/desktop use
  the web URL (universal link if the app supports it). GoldenDict/StarDict on Android use the ColorDict intent
  (`colordict.intent.action.SEARCH`); MDict uses `mdict://mdict.cn/search?text=` and desktop GoldenDict/StarDict use `goldendict://` / `stardict://`.
  I could not verify these against the current app versions — if one does not open, choose **Custom URL scheme** (placeholders `{word}`,
  `{text}`, `{from}`, `{to}`) or edit `extlinks.js`.
* **Orientation names:** 0° = `portrait-primary`, 90° = `landscape-primary`, 180° = `portrait-secondary`, 270° = `landscape-secondary`
  (the values of `screen.orientation.angle`). Which physical direction is "clockwise" depends on the device. Chrome only allows locking
  in fullscreen or an installed standalone window; the app enters fullscreen automatically when needed. Without the API (iOS Safari) the
  reader is rotated with CSS; the selection popup position is approximate in that mode.
* **iOS iPhone has no Fullscreen API:** "Fullscreen" hides the app's own bars instead.
* Browser pinch-zoom of the page is disabled on purpose (`user-scalable=no`) so it can never scale the UI; the book zooms with the bar,
  Settings, or a two-finger pinch on the book.
* New UI strings are translated to English and Russian; other interface languages fall back to English for those strings.
* Dictionary parsing keeps the whole dictionary in memory inside the worker (fine for typical WikDict/FreeDict sizes; very large
  multi-hundred-MB dictionaries may exhaust memory on low-end phones).
