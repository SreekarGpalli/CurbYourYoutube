# Running tests

```sh
npm run build
npm test
npm run check
npm run package
```

For browser tests, use Node.js 22 or newer. Install Playwright and Chromium in your development environment, then set `PLAYWRIGHT_MODULE` to the Playwright module path if it lives outside this repo. Set `CHROMIUM_EXECUTABLE` or `FIREFOX_EXECUTABLE` when using a custom browser installation.

- `npm run test:e2e` — Chromium and Firefox with YouTube fixtures.
- `npm run test:chrome-store` — Store build, consent, storage, and mocked Gemini. Add `-- --live` to check signed-out YouTube and capture a Store screenshot.
- `npm run test:all` — full desktop suite, including live YouTube checks and package verification.

Browser tests use fresh profiles. Screenshots and reports go in `artifacts/`. Use `npm run clean` to remove temporary profiles. Live tests cover signed-out YouTube. Account-specific layouts, OS sleep, and browser-owned picture-in-picture may need a manual check.
