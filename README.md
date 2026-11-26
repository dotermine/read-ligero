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
python3 -m http.server 8765 &  node tests/e2e-smoke.js && node tests/e2e-features.js && node tests/e2e-round3.js && node tests/e2e-round4.js && node tests/e2e-round5.js && node tests/e2e-zoom.js && node tests/e2e-migration.js
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


## Round 4 — what changed and why

**Zoom (Display settings, pinch).** The old code cleared the pages and re-rendered them after the gesture, which flashed white and
shifted the picture. Now the pages on screen are only *scaled* (GPU transform around the screen centre) while you drag; when the gesture
settles, the pages for the new size are rendered in a hidden layer and swapped in during a single frame, with the same point of the page
still in the middle of the screen. Tested by sampling every animation frame during a slider drag: no blank frame, centre kept to <2 %.

**Position.** Real bug: switching to another tab hides the reader (`display:none`), browsers reset the scroll offset of hidden
elements, and the layout observer then re-laid out and *saved* that garbage (a PDF at 700 px came back at 260 px). Hidden tabs are now
ignored (nothing is laid out or saved) and the last good position is restored when the tab is shown again. Also: positions are saved
immediately before opening an external translator, on `visibilitychange`/`pagehide`/`freeze`; text anchors now include the paragraph
margin (no 15 px drift); EPUB keeps its CFI fresh from the scroll position.

**Fullscreen / orientation.** Fullscreen is no longer left and re-entered on every tab switch (each re-entry makes the browser show its
own banner). A fullscreen exit that the *system* causes while the app is in the background no longer overwrites your saved choice, and
on return the orientation lock and zoom are re-applied. Chrome's own "Viewing full screen" banner cannot be switched off by web code;
it now appears only when fullscreen is really entered.

**Orientation icons.** Each icon is one phone with a camera dot at the top and a home bar at the bottom, rotated: 0° = upright,
180° = upside down, 90° = `landscape-primary` (device turned left, dot on the left), 270° = `landscape-secondary` (dot on the right).

**Dropdowns.** Every `<select>` is replaced by a themed list (`customselect.js`); the real select stays hidden so values, events and
saved settings are unchanged. Keyboard, type-ahead and a filter box (long lists, never auto-focused) are supported.

**Bookmarks.** The top bar has a *list* button next to the *add* button. The list is a sheet for the current book (jump / delete);
bookmarks store the exact position (`bookmarks.js`).

**Languages.** The book language selects the dictionary (including imported offline ones) and the translator's source language. If that
language has no external app/service configured, the one configured for another language is used.

**Translators.** On Android the word is passed with `ACTION_SEND` (the mechanism behind *Share → Translate*), which pre-fills Google
Translate, Yandex, DeepL, …; the language pair is the one set inside the app. Google web uses `/m?…&q=`. Link-style deep links were opened
*empty* by the app.

**Dictionaries.** Only translations into the *native language* are kept: text in the source script is dropped (en → ru: Latin = explanation),
for same-script pairs English function words / dictionary headwords betray explanations. The filter runs at import **and** when a word is
looked up, so dictionaries you imported earlier are cleaned without re-importing (set the native language correctly). TSV import now
reads `word<TAB>transcription<TAB>translation<TAB>sentence` (columns 3–4 optional); the sentence is shown as an example in the sheet.

**New word.** A *Transcription* field sits under *Word*. *Add to vocabulary* fills translation and transcription separately.
Transcription can be shown on flashcards (Quiz → Card sides).

**Refactor.** New modules `customselect.js` and `bookmarks.js`; PDF engine rewritten around a position model (page + fraction) instead of
scattered scroll maths; dead code removed (`androidApp`, pseudo-fullscreen branches, fixed-step zoom rounding).
`app.js` is still one large file — splitting it further needs a shared-state module and was not attempted in this round.


## Round 5 — what changed and why

**Return from an external app.** The saved fullscreen / orientation choice is no longer replaced by what the system did in the
background: the Settings keep showing it, and on `visibilitychange` / `focus` / `pageshow` it is re-applied. Browsers allow fullscreen and
`orientation.lock()` only right after a user gesture, so the app tries at once and, if refused, silently retries on the very next tap
(one-shot hook). Leaving fullscreen yourself (system gesture) is still respected.

**Horizontal position.** PDF progress now stores `hx` (horizontal centre of the view as a fraction of the page width) next to page + fraction,
in progress and in bookmarks. It is restored after reopening even when the view is locked (programmatic scrolling works with `overflow-x:hidden`).

**Wake lock / keep-alive** (`power.js`, Settings → *Reading & system*). *Keep the screen awake*: Screen Wake Lock while a book is open and
visible, re-requested whenever the app becomes visible (the browser drops it in the background). *Keep the app alive*: holds a shared Web
Lock while a book is open (Chrome does not freeze such pages) and reopens the last book at its saved position if the system closed the app.
A web page cannot *force* the OS to keep it running — low memory can still end it; progress is saved continuously, which is the real safety net.

**Fullscreen banner.** Chrome's "viewing full screen" message is drawn by the browser and cannot be disabled by web code. Mitigations:
fullscreen is requested with `navigationUI:'hide'`, never re-entered on tab switches, and an opt-in *Hide the system bars when the installed app starts*
switches the manifest to `manifest-fullscreen.json` (`display: fullscreen`), which starts the installed app without the Fullscreen API and
therefore without the banner (takes effect when the browser updates / you reinstall the app; the Fullscreen/Windowed switch is moot in that mode).

**System bars.** `theme_color` / `background_color` in the manifest are neutral white (they were the amber icon colour). The two
`<meta name="theme-color">` tags start with the system light/dark scheme and are then kept equal to the page background of the active
theme (light / sepia / dark / AMOLED), so the status and navigation bars blend in.

**External apps.** Chrome only launches `intent:` URLs whose target activity is BROWSABLE; the text entry points of translator apps
(share / process-text) are not, so the old link silently fell back to the web URL, which the Translate app then opened *empty*. On Android
the translator presets now hand the word to the installed app through the system share sheet (`navigator.share`) — the same path as
*Share → Translate* — which pre-fills and translates it (one extra tap to pick the app; the language pair is the one set in the app).
Presets *Share sheet (any translator / dictionary app)* exist too. *Open … in a floating or split-screen window* adds
`launchFlags=0x10001000` (NEW_TASK | LAUNCH_ADJACENT) to Android intents — best effort, Chrome/OEMs may ignore it.

**PDF highlights.** Two causes of offset boxes: the text layer was measured with a *fallback* font before the real one had loaded (and the
wrong ascent was then cached for every later page). Now the real ascent from pdf.js is used and the layer is built after the page rendered.
Tested against the glyph pixels of the canvas (≤ 2.5 px at 100 % and 180 %) with the bundled Helvetica test PDF.

**Selection.** Long press selects the word under the finger (a press between words picks the nearest one) and two draggable handles
appear; dragging a handle moves that end letter by letter, the action popup returns on release. Handles also appear after a double tap.
Bug fixed on the way: the app-level "tap outside dismisses the selection" handler treated the handles as outside.

**Languages without spaces.** Word boundaries come from `Intl.Segmenter` for Chinese, Japanese, Thai, Khmer, Lao and Myanmar text, using the
book language as locale; the vocabulary marks use the same tokenizer (a saved Chinese word is highlighted alone, not the whole run).
Sentence selection recognises `。！？`.

**Settings / Quiz.** Dropdown lists were drawn at z-index 9800, *below* the modal (10000); they are now above everything (30000).
Two independent switches: highlight saved words / highlight looked-up words (the translation above a saved word is a third switch).
The study session is a fixed overlay between the top of the screen and the tab bar, with safe-area padding, so *Quit* can no longer scroll away or
sit under the status bar in fullscreen.
