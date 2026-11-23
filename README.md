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
| Book display (screen mode, orientation, zoom, lock) | `display.js` + reader bar + Settings → *Book display* (one shared state) |
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
python3 -m http.server 8765 &  node tests/e2e-smoke.js && node tests/e2e-features.js && node tests/e2e-round3.js && node tests/e2e-migration.js
# offline on a host that redirects /index.html → / (Netlify / Cloudflare Pages style):
node tests/redirect-server.js . 8780 &  node tests/e2e-offline.js http://localhost:8780/
```

## Known limitations — please read

* **Not tested on a real phone.** Everything was verified in desktop Chromium (390×780 viewport) incl. offline cold start, install
  prerequisites, worker import, PDF/EPUB/TXT zoom and positions, migration. Android *intent* launches, real Fullscreen/orientation lock and touch pinch
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


## Round 3 — what changed and why

**Offline (critical).** Root cause found by reproducing it: hosts such as Netlify, Cloudflare Pages and Firebase redirect
`/index.html → /`. The previous service worker cached that *redirected* response and served it to navigations, which browsers
reject — the installed app then failed to start offline. Now: responses are stored as clean copies, navigations are answered with
the cached shell (`/`, `/index.html`, `?query` all work), and installation is two-tier — *core* files (29) are fetched with retries
and all-or-nothing, *optional* files (pdf.js CMaps/fonts, xz decoder; 186) are best-effort and can never block offline mode.
Settings → *Backup & storage* → **Offline mode** shows `Ready ✓ (215/215 files)` and has a *Check offline files* button.
Offline needs HTTPS (or localhost); on plain `http://192.168…` the browser disables service workers and the status says so.
Run `node tools/gen-precache.js` before every deploy.

**Reading position.** Saved with every scroll (debounced), when the app is hidden/closed, and — new — read fresh from the reader
at that moment: text/FB2 = paragraph + fraction (survives zoom/rotation), PDF = page + fraction, EPUB = character-level CFI.
A position is never saved before the book finished restoring the old one.

**Dictionaries.** Parsing no longer depends on file names (renamed parts, UPPERCASE extensions, folders, `__MACOSX` junk, real
`.dict.dz` dictzip headers). TSV files may be UTF-8/UTF-16/windows-1251 and have any extension. Only the transcription and the
translations are kept: part-of-speech labels, numbering, `(glosses)`, example sentences and long English explanations are dropped
(heuristic — if an article has nothing but an explanation, its first words are kept). Re-import existing dictionaries to apply it.

**Languages.** Settings → *Native language* (default: interface language) is the translation target for external translators.
The source language is chosen **per book** in the reader (display bar → *Book language*); the dictionary and the
`{from}`/`{to}` pair follow it. A translator call with identical source and target is refused with an explanation.

**Reader.** Top bar and tab bar auto-hide while reading; tap the very top or bottom edge (72 px) to show them, tap the middle to
hide (they also hide by themselves after 5 s). `qbarHandle` and `bookOffset` are removed: pan zoomed pages by dragging with a
finger or by holding the left mouse button. Zoom is continuous (1 % steps) and real-time: pinch/slider scale the rendered pages with a
GPU transform, then the page is re-rendered sharply when the gesture ends. A single tap on a word that was already looked up or saved opens the action menu.
The word popup and flashcards scroll when their content is long.
