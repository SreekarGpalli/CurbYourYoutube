# End-to-end validation

## Home navigation and early request coverage · November 8, 2026 · 1.0.2

The exact unwanted course phrase originated in our archived 1.0.0 preset. That build also searched the session intent automatically on subscription redirects. The live Chrome extension was confirmed to load from this project's `dist/chrome` directory. An existing results URL alone does not explain what originally initiated the unwanted search; the earlier stale-URL explanation was incomplete.

Removed navigation from preference/state application. Subscription redirects have a fixed bare-homepage destination and run through route policy, including after a gate is released. Replaced the generic destination-taking Home helper with a fixed Home action. A pending typed or saved search suppresses redirects through the START response/broadcast and until document navigation; failure clears that guard. No default or restored session intent supplies a query.

The search regression now starts recording before opening each page, including initial navigation and reload. It covers restored legacy course intent, subscriptions to Home, Home reload, popup Open YouTube, preset selection, and exactly one typed Python search in Chromium and Firefox. Existing-results entry requests are explicitly accounted for rather than hidden behind a later baseline.

Chrome's extension Reload action loaded 1.0.2, then the YouTube tab was refreshed. Verified Just browse opened `https://www.youtube.com/` with an empty native search field. Opened Set intent, selected Follow a course, entered Python, and submitted. Verified `/results?search_query=Python`, native search Python, and session intent Python. Screenshot: `artifacts/e2e/installed-chrome-1.0.2-python.png`. This confirms the observed installed flow; it does not independently reproduce the previously reported early phrase on 1.0.1.

Checks: `npm test` (45 pass, 0 fail); `node scripts/search-submission-test.cjs` (8 entry journeys, 2 popup checks, 2 break-resume checks); `node scripts/saved-search-test.cjs` (both browsers); `node scripts/navigation-test.cjs` (11 journeys per browser); `npm run check`; `npm run package` (14 matching files per ZIP). Navigation fixtures were corrected to use the current native Home link, Set intent, and Search instead controls; assertions were retained. Firefox also reported a missing blocked request while the driver was sending a fixture response. The driver now requires a matching browser fetch-error with an abort/cancel reason before accepting that cancellation; unconfirmed errors still fail, all request URLs remain recorded, and pending fixture responses settle before the error assertion. The regression also waits for the redirected Home document before reloading. Previous 1.0.1 ZIPs moved to `artifacts/archived-releases`.

## Remove inherited/default queries and refresh release · November 8, 2026

Found two concrete problems: Edit intent copied the previous session's text into the search field, and both distributed 1.0.0 ZIPs still contained the old automatic subscription intent search plus expanded course preset text. Removed session-to-search prefill and the unused search helper. Editing starts with an empty search field; only text entered for the current submission or an explicitly clicked saved card supplies search terms.

- `node scripts/search-submission-test.cjs`: **8 journeys passed**, four in Chromium and four in Firefox. Actual request recording covers opening, reloading, preset selection, submission, and editing legacy course intent from home, subscriptions, watch, and existing results pages. **Zero new search requests before submission; exactly one Python request on submission; no old-intent prefill or search.** Subscription redirection is enabled during the check.
- `node scripts/saved-search-test.cjs`: passed both browsers, including exact typed/saved queries, Unicode, CRUD, shared cards, and cross-tab sync.
- `npm test`: **45 passed, 0 failed**.
- `npm run package`: generated **1.0.1** Chrome/Firefox folders and ZIPs. `node scripts/check-package.mjs`: **14 matching files per ZIP**.
- `npm run check`: passed syntax, permissions, matching source/build assets, and package/manifest version agreement. Version now comes from package.json and Settings reads the running manifest version.
- Old 1.0.0 ZIPs moved to `artifacts/archived-releases`, outside the distribution directory.

The installed Chrome extension points to this project's dist/chrome folder. Computer Use could not determine the current browser URL confidently and stopped before any UI input, so its installed runtime was not reloaded or claimed verified. Reload the extension on chrome://extensions, then reload YouTube; Settings should display Version 1.0.1.


## Quiet session reminder · November 7, 2026

The playback pill now contains the intent plus one session timer, formatted as `0h 00m`. Session displays throughout the extension omit seconds; detailed intent time retains seconds. The pill's timer text is written only when its minute value changes.

- `npm test`: **45 passed, 0 failed**, including minute/hour boundaries and invalid timer inputs.
- `npm run build` and `npm run check`: passed for both builds.
- `node scripts/fullscreen-test.cjs`: Chromium and Firefox passed normal/theater/fullscreen, a single timer, zero timer DOM mutations while intent seconds advance, minute rollover, narrow layout, settings, and breaks.
- `node artifacts/playback-live-check.cjs`: live Chromium normal/theater/fullscreen and auto-hidden controls passed; the session pill stayed stable across seconds. Popup session formatting checked.
- Inspected `live-awareness-theater.png` and `quiet-session-popup.png` under `artifacts/e2e`.


## Consistent playback pill · November 7, 2026

Normal and theater playback now use the fullscreen pill's translucent background, single-line layout, separators, and rounded shape. The pill centers on the visible player, stays below the native header when scrolling, and fits narrow players without wrapping. At narrow widths it retains intent and session time.

- `npm run build` and `npm run check`: passed for both browser builds.
- `node scripts/fullscreen-test.cjs`: passed in Chromium and Firefox, including centered single-line player geometry, 320px playback, timers, scrolling, fullscreen, settings, and breaks.
- `node artifacts/playback-live-check.cjs`: passed live normal, actual theater layout (verified on `ytd-watch-flexy`), fullscreen, and fullscreen after controls auto-hide.
- Visually inspected live theater and narrow Firefox playback screenshots in `artifacts/e2e`.


## Persistent playback awareness · November 7, 2026

- `npm run build`: rebuilt Chrome and Firefox. `npm run check`: syntax, permissions, local API restrictions, and matching build assets verified.
- `npm test`: **44 passed, 0 failed**.
- `node scripts/fullscreen-test.cjs`: both browsers passed normal/theater decoded playback with advancing intent/session timers, player bounds and click-through, scrolling/offscreen handling, wide/narrow fullscreen, preference synchronization, and break handling.
- `node artifacts/playback-live-check.cjs`: **PASS live normal**, **PASS live theater**, **PASS live fullscreen**, and **PASS live fullscreen-controls-hidden** on actual signed-out Chromium YouTube playback. Intent/session timers remain visible after native controls auto-hide.
- Inspected screenshots `live-awareness-normal.png`, `live-awareness-fullscreen.png`, and `firefox-playback-theater.png` under `artifacts/e2e`.


## Typed search submission and unified cards · November 7, 2026

- Start session now searches the exact typed query; a selected built-in never supplies replacement terms when the field has text.
- Saved-search cards share the built-in grid, with a teal fill and rounded border. The separate saved-search section is removed.
- `node scripts/saved-search-test.cjs`: Chromium and Firefox both reported `PASS Programming + Python exact search, Unicode query, shared colored card grid, saved search create/edit/remove, cross-tab sync, exact query, desktop/narrow screenshots`.
- `npm test`: `ℹ pass 44`, `ℹ fail 0`. `npm run build` rebuilt both browsers; `npm run check` verified syntax, permissions, and matching build assets.
- Inspected desktop Chromium and narrow Firefox screenshots in `artifacts/e2e/*-saved-searches*.png`.

## Intent cards, session dock, compact results, and popup · November 7, 2026

- `npm test`: **44 passed, 0 failed**. Includes saved-search validation, persistence, capacity, and reset.
- `npm run build` and `npm run check`: both browser builds, syntax, permissions, and source/build consistency passed.
- `node scripts/saved-search-test.cjs`: **PASS** Chromium and Firefox: typed-intent preservation, create/edit/remove, cross-tab synchronization, exact encoded query, desktop/narrow screenshots.
- `node scripts/controls-test.cjs`: **PASS all 29 settings controls** and **all 29 popup settings** in both browsers; reset, navigation, popup actions, and failure recovery passed.
- `node scripts/layout-test.cjs` and `node scripts/layout-test.cjs firefox`: **8 geometry/hit checks** at each of 1920px/700px and scroll 0/350. Native header at top, session dock at bottom, search and navigation clickable.
- `node scripts/thumbnail-test.cjs`: **8 fixture journeys per browser passed**: compact geometry, hover/focus preview, Escape/blur, hidden/normal modes, dynamic insertion, Shorts, main player, reload and popup sync.
- `node scripts/thumbnail-test.cjs --live`: **7 live journeys per browser passed** against signed-out YouTube. Screenshots confirm compact search rows and floating thumbnail previews.
- `node scripts/native-search-test.cjs --live chromium` and `--live firefox`: **5 live journeys per browser passed**, including native autocomplete and exact selected queries.
- `node artifacts/inspect-live.cjs`: **PASS live expanded sidebar: Shorts and Explore have zero layout height**.

The thumbnail source remains in a transparent, out-of-flow 1px box so YouTube lazy-loads it; it does not reserve a visible thumbnail slot. Hover previews display images without starting playback. Full-page screenshots can place fixed elements partway down the exported image; viewport hover screenshots show their actual position.

Checks used the existing Playwright installation documented below. Complete `test:all` was not run; older entries are historical. Guide and privacy policy now include locally stored saved-search names and queries.

## UI copy cleanup · November 7, 2026

Removed setting descriptions, repeated prompt instructions, keyword-match commentary, privacy slogans, and timer disclosures from the interface. Explanations are in [GUIDE.md](GUIDE.md). Labels, session data, errors, reset consequences, and the privacy policy remain.

- `npm run build`: built `dist/chrome` and `dist/firefox`.
- `npm run check`: `JavaScript syntax, local-only API checks, permissions, and build assets verified.`
- `npm test`: `ℹ tests 42`, `ℹ pass 42`, `ℹ fail 0`.
- `node scripts/controls-test.cjs`: Chromium and Firefox each reported `PASS all 29 settings controls save and restore through UI` and `PASS all 4 popup settings save and restore through UI`. Navigation, reset/cancel, privacy navigation, popup actions, and startup retry/automatic recovery also passed.
- `node artifacts/copy-ui-check.cjs`: Chromium and Firefox passed the intent, home, video-check/detour, preview, break/continue, finish, browse-expiry, Shorts, policy, popup, and reset walkthrough. Checked horizontal overflow and ARIA references; no browser errors. Expiry screenshots use fixture timer setup, not a five-minute elapsed-time test.
- Visually inspected wide/narrow settings, popup, intent, video-check, break, expiry, reset, and policy screenshots in `artifacts/e2e/*-copy-*.png`.
- `node --check` passed for the edited build and browser-check scripts.

Browser checks used Playwright 1.63.0 via `PLAYWRIGHT_MODULE`. The controls check initially exposed a keyboard-sequence error: Enter opened the native select menu before the next selection. It now uses Escape after arrow-key selection; all save/restore assertions remain.

This was a targeted copy and UI pass. The complete `test:all` suite and live YouTube checks were not rerun. Earlier validation entries below describe previous revisions.

## Native YouTube search and homepage entry · October 17, 2026

The startup prompt contains no search field. The replacement extension form has been removed entirely. YouTube owns its search field, autocomplete, suggestion selection, query and result navigation. Its fixed masthead sits below the intent/timer bar. Just browse atomically starts the shared homepage allowance and opens the bare homepage, including when entered from a video or results page. Home also reveals the timed homepage without replenishing an existing allowance. Header/search-shelf hiding is disabled once on upgrade; subsequent explicit preferences persist. Shorts and thumbnail controls remain independent.

- `node --test tests/core.test.cjs tests/background.test.cjs`: **42 passed, 0 failed**, including migration persistence and atomic browsing allowance without replenishment.
- `node scripts/native-search-test.cjs`: **10 passed**, five per browser. Startup gate, actual timed homepage, native suggestion keyboard selection, usable search results and Just browse from results/watch.
- `node scripts/native-search-test.cjs --live`: **10 passed** on real signed-out Chromium/Firefox YouTube, including visible autocomplete, actual pointer/keyboard input, result links and search geometry below the extension bar. Chromium suggestion screenshot visually inspected.
- `node scripts/navigation-test.cjs`: **22 passed** across both browsers, preserving detour accounting, cross-tab draft conflicts, native history, gate escape paths and Home allowance checks.
- `node scripts/e2e-test.cjs`: **41 passed** (21 Chromium, 20 Firefox), including native header restoration, controls, sessions, breaks, keyboard, narrow layout and restart/reload.
- `node scripts/fullscreen-test.cjs`: **8 passed** across both browsers.
- `node scripts/live-e2e-test.cjs`: **18 passed**, nine per browser, including native English/Hindi queries, Home, real video playback, fullscreen, shared breaks and reset. The native-field test now waits for YouTube to finish loading its input after full-page Home navigation; `native-live-broad.log` contains the successful rerun.
- `node scripts/check.mjs` verified syntax, local-only API checks, permissions and matching build assets. `node scripts/package.mjs` rebuilt both packages; `node scripts/check-package.mjs` verified **14 matching files per ZIP**.

Evidence: `artifacts/e2e/native-search.log`, `native-search-live.log`, `native-navigation.log`, `native-broad.log`, `native-fullscreen.log` and `{chromium,firefox}-native-search-live-suggestions.png`. Earlier sections describe historical behavior; their startup-search assertions were replaced with the corrected no-search-until-session contract. Live checks use isolated signed-out profiles; the user's signed-in curated feed was not accessed.

## Navigation and product pass · October 16, 2026

Home is always reachable. Searching from the initial prompt starts casual browsing and exposes usable results. Just browse, Quick browse, Resume intent, and Watch as a detour support music and quick questions while preserving a focused intention. Detours pause intent time; session time and breaks continue. Replay preserves approval for the same video; another video requires confirmation in focus mode. Drafts survive settings updates and conflicting saves from another tab. Settings/popup startup failures offer Retry and recover automatically. Firefox keyboard traversal now visits visible controls without stopping on the scrolling prompt container.

Verification commands and observed results:

- `node --test tests/core.test.cjs tests/background.test.cjs`: 40 passed, 0 failed.
- `node scripts/e2e-test.cjs`: 21 Chromium and 20 Firefox journeys passed.
- `node scripts/navigation-test.cjs`: 11 journeys per browser passed, including two-tab save conflicts and recovery without losing the draft.
- `node scripts/controls-test.cjs`: Chromium passed all controls; `node scripts/controls-test.cjs firefox` passed after correcting native-select keyboard input in the harness. Each browser exercises 29 Settings controls, four popup preferences, navigation, reset/cancel, popup actions and four startup recovery scenarios.
- `node scripts/search-access-test.cjs`: both browsers passed after fixing Firefox focus traversal, preserving the original keyboard assertion.
- `node scripts/fullscreen-test.cjs`: eight checks passed. `node scripts/homepage-test.cjs`: ten journeys passed, including real two-minute expiration in each browser.
- `node scripts/thumbnail-test.cjs`: both browser fixture suites passed; `node scripts/thumbnail-test.cjs --live`: both live suites passed.
- `node scripts/browser-test.cjs`: passed, including Retry during a failed connection, recovery, new-video gates, settings, popup actions and keyboard traversal.
- `node scripts/live-e2e-test.cjs`: nine live journeys per browser passed in the full sweep. The strengthened visible-Unicode-results rerun passed in Chromium; Firefox's post-fullscreen click initially raced native window resizing. Waiting for stable geometry and activating the tab preserves the click/focus/typed-text assertions; its final rerun is recorded in `live-firefox-recheck.log`.
- `node scripts/check.mjs`: JavaScript syntax, local-only API checks, permissions, and build assets verified. Packaging verified 14 matching files per browser ZIP.

The full runner deliberately retains its initial failures in `artifacts/e2e/full-run.json` and `product-pass.log`. Targeted reruns are recorded in `navigation-recheck.log`, `controls-firefox-recheck.log`, `recovery-recheck.log`, and `live-recheck.log`. The older recovery script was updated for eight presets, the new Home/Just browse keyboard order, and same-video replay behavior; separate new-video gating checks remain. Live search verification additionally waits for visible Unicode result cards, rather than capturing a loading page. Narrow-layout and real Hindi search screenshots were visually inspected.

Live tests use signed-out isolated profiles, not the user's curated account. Account-specific layouts, every YouTube experiment, screen readers and physical sleep/resume are not certified. Reload the extension and refresh existing YouTube tabs before manual testing.

## Optional fullscreen intent pill · October 16, 2026

Fullscreen now shows a single-line, 34px-tall pill containing the current intent and elapsed intent time. The background is 65% transparent, long intentions truncate, and pointer input passes through to the video. The full header/search stay hidden. The default-on Fullscreen intent pill switch in Settings → Session and the popup persists locally and applies immediately.

`node --test tests/core.test.cjs` passed 23 tests. `node scripts/fullscreen-test.cjs` passed eight Chromium/Firefox checks covering 1280px/390px geometry, transparency, click-through behavior, live timer updates, restoration on exit, settings/popup persistence and live toggling, and break-triggered exit/paused playback. Both Chromium screenshots were visually inspected. Tests use real browser fullscreen with decoded fixture media; the broader journey suite was not rerun for this change.

## Unobstructed fullscreen · October 16, 2026

The extension header, search, timers and header buttons are hidden during fullscreen playback and restored on exit. `node scripts/fullscreen-test.cjs` passed six checks across Chromium and Firefox: hidden controls/no reserved header space at 1280px and 390px, restoration on normal exit, and break-triggered fullscreen exit with paused video and restored controls. The Chromium fullscreen screenshot was visually inspected. Both packages were rebuilt; static/build and ZIP-content checks passed. These targeted tests use actual fullscreen and decoded fixture media; the broader suite was not rerun for this CSS change. The existing broad fullscreen assertion now checks the requested hidden-header behavior.

## Timed curated homepage · October 16, 2026

The homepage remains available through an explicit timed browse. Five minutes is the default; the popup and Settings offer two, five or ten minutes for the next browse, plus an unrestricted-homepage option. Users can hide the feed early. Active homepage time is shared across tabs and saved in browser-session storage; video viewing, background tabs and session breaks pause consumption. New intentions and finished sessions clear it. Refreshes do not replenish it, and expiration hides the feed until the user explicitly starts another browse. Shorts and thumbnail preferences remain independent.

- 38 logic tests passed, including duration validation, shared allowances, expiry broadcasts, pause behavior, restore, reset and stale session requests.
- Both Chromium and Firefox passed five homepage journeys each, including actual two-minute expiration without clock manipulation, refresh persistence, video pauses, shared tabs, duration/popup synchronization and early hiding.
- After adjusting page spacing to follow the bar's actual height, both browsers passed the four quick homepage journeys again, including a 390px viewport. Chromium screenshots were visually inspected.
- All 41 broader session journeys passed (21 Chromium, 20 Firefox), as did keyboard/search checks in both browsers. The initial Chromium resize overlap was fixed without weakening its assertion, and the full Chromium suite passed on rerun.
- Build/static checks and both packaged ZIP-content checks passed.

Evidence: `artifacts/e2e/{chromium,firefox}-homepage-results.json`, `-homepage-quick-results.json`, and adjacent screenshots. These tests use isolated profiles and representative page fixtures, not the user's signed-in curated feed. Test profiles are retained with artifacts for debugging. The timer has the existing two-second sampling/six-second stale-activity bounds.

## Thumbnail defaults and Shorts fixes · October 16, 2026

Thumbnails now default to hover/focus reveal. Existing installs receive a one-time migration from show to hover and enable Shorts hiding; always-hidden thumbnails and unrelated settings are preserved. Later explicit choices survive restarts. Shorts coverage includes modern lockups, complete grid shelves, navigation links, the English Shorts filter chip, and both `/shorts` and `/shorts/<id>` gates. Chapter previews and lockup background imagery follow thumbnail preferences too.

- 35 logic tests and build/static checks passed; both browser distributions and ZIPs rebuilt.
- 16 deterministic thumbnail/Shorts journeys passed across Chromium and Firefox, including dynamically inserted Shorts, ordinary video preservation, direct route gates, hover/focus, persistence and popup synchronization.
- 14 live signed-out journeys passed across both browsers. These assert that actual Shorts cards and complete shelves are hidden, alongside thumbnail mode behavior and chapter preview hiding.
- Final Chromium live screenshot was visually reviewed: Shorts shelves/filter and thumbnail imagery are absent in hidden mode. Evidence: `artifacts/e2e/{chromium,firefox}-thumbnails-{fixture,live}-results.json` and adjacent screenshots.

The broader timer/fullscreen suite was not rerun for this change. Signed-in and localized layouts remain outside this run's coverage. Reload the extension and refresh existing YouTube tabs before manual testing.

## Search and fullscreen update · October 15, 2026

Added an editable search box independent of the session intent, including during prompts and when YouTube's header is hidden. “Search instead” focuses that box. Same-video URL changes and replay no longer discard approval. The intent/search bar mounts inside YouTube's fullscreen player container and returns to the document on exit. Narrow layouts reserve a second row for search. Keyboard input does not bubble to player shortcuts, and all extension controls remain reachable during prompts.

Verification on Windows:

- All 34 logic tests, build/static checks, and both packaged ZIP-content checks passed.
- 41 deterministic browser journeys passed: 21 Chromium and 20 Firefox, including custom queries, hidden-header search, same-video navigation, replay, fullscreen intent visibility, breaks, narrow layout, restart and reload recovery.
- Dedicated keyboard regressions passed in both browsers on the final build: search during the initial prompt, Enter submission, and Tab traversal from search through Settings into the intent choices.
- Live signed-out YouTube journeys passed in both browsers for custom search, playback, current video titles, controls, shared breaks, finish and reset. Both browsers also passed real player fullscreen checks with text entry; Chromium screenshot review included a pre-roll ad. All 16 live journeys passed.
- Screenshots were visually inspected for fullscreen intent visibility and the 390px layout. Review caught and corrected a search/prompt overlap before the final build.

Evidence is in `artifacts/e2e/{chromium,firefox}-results.json`, `{chromium,firefox}-live-results.json`, `chromium-live-fullscreen.png`, and `{chromium,firefox}-narrow.png`. Run `node scripts/search-access-test.cjs` for the keyboard regression; it is also included in `test:all`. This change ran the relevant suites individually, not the entire thumbnail/failure-recovery matrix. The final accessibility adjustment was checked by the dedicated keyboard regression in both browsers.

Manual review should use a reloaded extension and refreshed YouTube tab. Search for several queries without changing the session intent, use “Search instead,” enter/exit fullscreen, and replay a confirmed video. New videos still require confirmation; breaks, direct Shorts restrictions, and user-selected distraction settings remain. Browser-owned video-only fullscreen and PiP cannot display an extension bar. Signed-in/account-specific layouts remain for manual verification.

## Thumbnail update · October 12, 2026

The thumbnail setting is implemented in the popup and Settings, with normal, hover/focus, and always-hidden modes. Verified using actual unpacked extensions in isolated, headless Chromium 153.0.8010.12 and Firefox 153.0 profiles on Windows, including live signed-out YouTube.

- **34 logic tests** and build/static checks passed.
- **39 existing deterministic browser journeys** passed (20 Chromium, 19 Firefox).
- **14 existing live YouTube journeys** passed (7 per browser), including real playback, timers, video gates, cross-tab breaks, finish and reset.
- **12 new thumbnail fixture journeys** passed (6 per browser): seven card layouts, hidden on pointer hover and focus, reveal on card/title hover and keyboard focus, hide on leave, other cards remaining hidden, dynamic insertion, floating preview suppression, main-player visibility, reload persistence, popup synchronization and restoring normal mode.
- **10 new live thumbnail journeys** passed (5 per browser), exercising actual loaded YouTube search thumbnails with pointer/keyboard input, reload and popup synchronization.

Results and screenshots: `artifacts/e2e/{chromium,firefox}-thumbnails-{fixture,live}-results.json`, with `-hidden.png`, `-hover.png` and `-popup.png` screenshots alongside them. Existing journeys write `{chromium,firefox}-results.json` and `{chromium,firefox}-live-results.json`. This update ran those suites individually; the earlier `full-run.json` is historical.

Visual review confirmed hidden imagery and a single revealed card in live search results. Thumbnail areas retain their layout and click targets. Keyboard focus anywhere inside a card intentionally reveals it only in hover mode. Live account-specific layouts and all YouTube variants remain outside this run's coverage.

## Previous full validation · October 9, 2026

## Result

The automated desktop end-to-end pass is complete for the tested Chromium and Firefox environments. The repeatable entry point is `npm run test:all`. Exact stage outcomes are saved in `artifacts/e2e/full-run.json`, with console output in `artifacts/e2e/full-run.log`.

- **33 logic tests** covering timer boundaries, deduplication, idle/sleep simulations, date and clock changes, settings, stored-state recovery, concurrency, stale actions, storage failures, and reset.
- **20 Chromium and 19 Firefox deterministic E2E journeys**, using the actual unpacked extensions, real pointer/keyboard input, browser storage, and decoded local video streams. All 24 distraction controls are covered; the 22 visual controls are each toggled on/off through Settings and checked against representative DOM targets.
- **7 live signed-out journeys in each browser**, using real YouTube, real video/search metadata and brief muted playback, without an existing browser profile or account.
- **Chromium connection-failure regression** verifies that a failed activity request locks the page, pauses playback, and requires video confirmation after recovery.
- **Build, static and packaging checks**, including minimal permissions, source/output equality, local-only API checks, and inflation/comparison of every ZIP entry against its browser build. Both archives contain 14 matching files.

Tested versions: Chromium 153.0.8010.12, Firefox 153.0, Node 24.15.0 on Windows. Browser minimum versions were not separately installed or tested.

## Deterministic journey coverage

Both browsers exercise installation/startup; invalid and maximum-length intent input; all six presets; encoded intent search; direct and reloaded video gates; Search instead; supported YouTube origins and non-interference on an unrelated origin; explicit playback; SPA playlist-style navigation and history back; every Settings control; autoplay; ended-video confirmation; Shorts block/unblock; live-video URL gates; and subscription redirection.

Preview checks cover visible-description excerpts, metadata fallback, literal markup, preserving the cancellable context-menu event, dismiss button, Escape, disabling an existing card, and the real 14-second expiry.

Session checks cover two playing tabs counting once, shared breaks, 30/60-minute scheduling, interval changes while a break is due, continuation without automatic playback, finishing and frozen session summaries, editing/cancel, replacing intent across tabs, and ending the session on the last YouTube-tab closure. Separate browser windows share breaks and finish.

Both browsers enter actual fullscreen and DOM picture-in-picture with decoded media, then exit and pause when a break appears. Chromium additionally stops/restarts its service worker and verifies the shared session survives. Firefox uses an event background page.

Settings checks include synchronization between open settings tabs, all navigation anchors, timer-help disclosure, reset/cancel, privacy-link content, popup opening YouTube and finishing the shared session. Both browsers check focus wrapping, a 390px viewport, reduced-motion mode and dark-theme restoration.

Both browsers are fully closed and restarted with the same isolated test profile: preferences and checkpointed daily totals persist, while the transient intent clears. Extension reload and subsequent page reload are also exercised.

Break deadlines are moved close to the current accumulated time in the test background environment; the real heartbeat, timer logic, message transport and UI then trigger the break. These runs do not wait 30/60 wall-clock minutes. The test setup is outside the production package; no test hooks or extra permissions are shipped.

## Live journey coverage

Both browsers exercise the live homepage prompt, intent search, organic programming search results, a local metadata preview, navigation to an observed video link, matching the relevance prompt to the loaded video title, a paused/inert gate, and deliberate real playback. Live watch-page controls are checked against elements actually present and visible in that layout; elements already hidden by YouTube are identified in the JSON rather than counted as extension restore successes.

The live runs also verify timer accumulation in a focused watch tab, a second real video remaining gated, a shared break pausing actual playback, continuation staying paused, finish across tabs, reloading a finished video, and reset returning both tabs to intent prompts. Pre-roll advertisements were observed during testing; every possible ad transition is not certified.

## Observed reload boundary

Firefox stops the old content script during extension reload. An already playing video can continue until its YouTube tab is reloaded; the extension cannot enforce a prompt while its code is unloaded. The recovery check reloads the page and verifies that gating and deliberate playback work again. README now explicitly instructs users to reload YouTube tabs promptly after extension updates/reloads.

Chromium's old content script paused playback after its extension context became invalid. Reload recovery was verified with Developer mode enabled through the browser's actual extension-management switch. Chromium ignores a plain JSON edit to this protected preference; the test adapter therefore uses the same UI setup as the installation instructions.

## Evidence and remaining scope

Machine-readable results: `artifacts/e2e/chromium-results.json`, `firefox-results.json`, `chromium-live-results.json`, and `firefox-live-results.json`. Corresponding narrow-layout, live-preview, and live-video-gate screenshots are in that directory. Every test profile is created under the artifacts directory and removed after its run. Normal browser profiles and accounts were not modified.

The supported automated journeys passed. This is not certification of every YouTube variant or external environment. Account-specific/signed-in layouts, regional consent flows, physical OS sleep/resume, screen-reader interaction, browser-owned context-menu appearance, browser-owned Firefox PiP controls, real playlist variants and all live-stream/chat layouts remain unverified. Clock/idle logic is simulated in unit tests; physical machine sleep is not performed. Basic mobile-origin gating does not validate mobile browsers.

The original 30/60-minute breaks remain, with no daily viewing cap. Previews remain bounded local metadata, relevance remains user-confirmed, timers remain approximate, and hiding depends on YouTube's DOM. No store submission, signing, publication, or live account interaction was performed.

## Reproduce

Use Node 22+, desktop Firefox and an installed Playwright/Chromium. Set `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, and `FIREFOX_EXECUTABLE` if needed, as described in README.

```sh
npm run test:all
```

For individual browser runs, build first, then use `npm run test:e2e -- chromium`, `npm run test:e2e -- firefox`, or the corresponding `test:e2e:live` command. The full runner continues through independent stages and exits with failure if any stage fails.
