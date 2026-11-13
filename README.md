# Curb Your YouTube

A Chrome and Firefox extension with distraction controls, session intents, and break timers.

See [the user guide](GUIDE.md) for every setting, session action, timer, and privacy detail.

Released under the [MIT License](LICENSE).

## Chrome Web Store

The Store edition is **Curb Video Focus**. Run `npm run package` to build the `curb-video-focus-chrome-store` candidate, including optional Gemini summaries, YouTube search suggestions, and hover thumbnails. See the [submission guide](STORE_SUBMISSION.md) for listing assets, the public privacy policy, and the Gemini release condition.

## Install locally

The generated extension folders are `dist/chrome` and `dist/firefox`.

The version comes from `package.json`. `npm run package` rebuilds all three targets and verifies their ZIPs.

**Chrome 120+**

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked**, then select `dist/chrome` in this project.
3. Open or reload YouTube. Pin the extension for quick access to settings.

**Firefox 140+ (desktop)**

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**, then select `dist/firefox/manifest.json`.
3. Open or reload YouTube. Temporary add-ons are removed when Firefox restarts; permanent installation requires Mozilla signing.

Do not load the project root as the extension. Run `npm run build` after editing source, reload the extension in the browser, and reload existing YouTube tabs.

Reload YouTube tabs promptly after extension updates or reloads. Firefox terminates old content scripts during extension reload, so an already playing video can continue until its tab reloads. Confirmations and playback controls resume when the new content script starts.

## Using the extension

Choose a session intent or **Just browse** when YouTube opens. Use Settings or the toolbar popup to adjust distractions and breaks. To summarize public videos, add your own Gemini API key in Settings.

See the [user guide](GUIDE.md), [Store privacy policy](store/privacy.html), [development-build privacy policy](extension/privacy.html), and [design decisions](DESIGN.md).

## Develop and verify

Requires Node.js 20+. There are no production or build dependencies and no installation step.

```sh
npm run build
npm test
npm run check
```

`npm run package` builds and verifies all three ZIPs in `dist` using Node built-ins. Use the `curb-video-focus-chrome-store` ZIP for Chrome Web Store submission.

`build` creates browser-specific Manifest V3 packages and original PNG icons. Chrome uses a service worker. Firefox uses an event background page. The Store target adds its own consent, encrypted local storage, and privacy page.

`test` exercises timer boundaries, multi-tab deduplication, stale activity, session expiration, break thresholds, serialized worker requests, stale prompts, settings validation, reset, and accurate preview labeling.

`check` verifies JavaScript syntax, build assets, permissions, and the declared network policy. Gemini uses an optional host permission and a matching `connect-src`. Thumbnail previews can request images from YouTube.

For the complete automated desktop pass, use Node 22+, an installed Playwright/Chromium, and desktop Firefox:

```sh
npm run test:all
```

This runs the build, logic and release-cleanliness tests, static checks, header and dock layout checks in both browsers, shared Chromium/Firefox end-to-end journeys, the standalone Chromium and Firefox regressions, live signed-out journeys in both browsers, packaging, and ZIP-content verification. It exits unsuccessfully if any stage fails. JSON results and screenshots are saved under `artifacts/e2e`. Temporary browser profiles are removed after a passing run (set `CURB_KEEP_PROFILES=1` to keep them); `npm run clean` removes profiles left by individual suites.

`npm run test:e2e` runs only the shared deterministic browser journeys. `npm run test:e2e:live` runs only live signed-out journeys, including brief muted playback. Build first when running those commands individually. Each command accepts a browser name after `--`, for example `npm run test:e2e -- firefox`. The shared suite uses real pointer/keyboard input, real decoded fixture media, separate windows, fullscreen/PiP, browser restarts, and extension reloads. Break deadlines are moved near the current timer so the real heartbeat can trigger them without waiting 30/60 wall-clock minutes. No production test hook is shipped.

Live checks use the network, and regional consent screens, ads, site availability, or layout changes can affect their outcome. They never use an existing browser profile or login. See [current validation results](VALIDATION.md) for exact coverage and observed boundaries.

For optional real Chromium integration testing, install Playwright in your development environment and run:

```sh
node scripts/browser-test.cjs
```

Set `PLAYWRIGHT_MODULE` to the absolute path of an existing Playwright package, and `CHROMIUM_EXECUTABLE` to an existing Chromium binary if needed. The test creates a fresh temporary profile under `artifacts`, loads the actual unpacked extension, and serves deterministic local HTML under intercepted YouTube URLs. It removes its temporary profile after running and does not log in or change your normal browser profile. Screenshots go in `artifacts`.

For the native Firefox integration test, use Node 22+ and run `node scripts/firefox-test.mjs`. Set `FIREFOX_EXECUTABLE` if Firefox is not installed at the default Windows location. This uses Firefox’s native WebDriver BiDi protocol, a temporary profile, and intercepted fixture pages. It validates installation, intent selection, video confirmation, all distraction controls, settings, finish, and reset.

For a limited live, signed-out YouTube smoke check, run `node scripts/live-test.cjs` with the same Chromium environment variables. It checks intent, search results, and a paused direct-video gate using a fresh temporary profile. It uses the live network and can fail because of consent screens, regional variants, or site availability. It does not use your account or approve video playback. See [current validation results](VALIDATION.md) for precisely what was tested.

## Scope and release checks

`npm run test:thumbnails` checks thumbnail modes in both real browser runtimes across representative card layouts, dynamic insertion, pointer hover, keyboard focus, reload persistence, and popup synchronization. `npm run test:thumbnails:live` checks the same modes on live signed-out YouTube search results. Both are included in `test:all`; each accepts `-- chromium` or `-- firefox` to select a browser.

`npm run test:homepage` checks timed homepage browsing in both browser runtimes, including early hiding, duration settings, page refresh, shared tabs, video pauses, narrow layouts, and actual two-minute expiration. It is included in `test:all` and accepts `-- chromium` or `-- firefox`.

`npm run test:navigation` exercises usable search results, Home, casual/focused sessions, detours, draft preservation, cross-tab intent conflicts, SPA/history query synchronization and gate escape paths. `npm run test:controls` changes and restores all settings and popup controls through browser input, checks each settings section and popup action, and injects startup connection failures to verify Retry and automatic recovery. Both are included in `test:all`.

The supported target is desktop Chrome and Firefox on YouTube. Basic mobile-site selectors are included, but Android Firefox and the full mobile YouTube interface have not been validated. Embedded players on other sites, YouTube TV, and native apps are outside scope.

YouTube can change its DOM at any time. CSS hiding is best effort, and some modern/regional layouts may require selector updates. Direct Shorts navigation is gated while Shorts hiding is enabled. Ads are not blocked. Playlist advancement still requires a video confirmation. Replaying an approved video or changing its timestamp does not require another confirmation.

Fullscreen replaces the session dock with a small translucent pill at the top center showing your intent and the session time in hours and minutes. Normal and theater playback show the same pill inside the player. It lets pointer input pass through to the video and truncates long intentions to stay on one line. **Intent pill on videos**, enabled by default in Settings → Session, turns it on or off in every mode. The session dock returns when fullscreen ends. Fullscreen and picture-in-picture are exited for prompts when the browser allows it, so the break remains actionable. Browser-owned video-only fullscreen and picture-in-picture cannot display the pill. This is a deliberate-use aid, not a tamper-proof block or a medical intervention.

Before public release, manually exercise account-specific/signed-in layouts, real playlist and live-stream variants, native right-click menu appearance, and physical OS sleep/resume. Automated Chromium and Firefox 153 journeys cover both deterministic fixtures and live signed-out YouTube; fullscreen, DOM picture-in-picture, separate windows, restart persistence, and reload recovery are included in the fixture suite. These results do not establish compatibility with every live YouTube variant or browser-owned Firefox PiP UI. Store approval is a separate review process.

`node scripts/native-search-test.cjs` checks the startup gate, timed Just browse from home/results/watch, native suggestions and result navigation in both browsers. Add `--live` for real signed-out YouTube autocomplete checks.
