# Chrome Web Store submission

Run `npm run package` to rebuild and verify the Store candidate. Review the Gemini release condition below before submitting it in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

- Upload package — `dist/curb-your-youtube-chrome-store-1.0.3.zip`
- Store icon — `dist/chrome-store/icons/128.png` (128 × 128 PNG)
- Store screenshot — `artifacts/chrome-store/settings.png` (1280 × 800 PNG)
- Session screenshot — `artifacts/chrome-store/youtube.png` (1280 × 800 PNG)
- Privacy policy — bundled in **Settings → Privacy & data → Privacy policy** and published to GitHub Pages from the same source.

The Curb Your YouTube ZIP includes Gemini summaries, YouTube search suggestions, and hover thumbnails. [Store listing requirements](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

Run `npm run test:chrome-store -- --live` to recapture the screenshots from the built extension in Chromium.

## Local Chrome and Store builds

The Store build includes all 30 local settings, the same presets and timers, saved searches, right-click and hover previews, and the same Gemini summary engine. It adds a switch for sending intent to Gemini, off by default.

- **Session setup.** Store users select **Enable Curb** before activity tracking. **Clear local data** resets that choice.
- **Custom intent and saved searches.** Store users edit both in extension Settings. **Save and get YouTube suggestions** opens a new YouTube tab and fills the search box. The local build fills it automatically when you start or edit a session with typed intent.
- **Thumbnails.** Store defaults to **Always hidden**. Local defaults to **Reveal on hover**. Both have all three modes.
- **Gemini.** Store setup asks users to confirm eligibility and use a billing-enabled project. The local build has no eligibility prompt and includes session intent when available.
- **Installation.** Store runs in regular windows. Local can be enabled in incognito through Chrome. The two installs have separate storage, so settings, searches, watch time, and keys do not carry over. Disable the unpacked copy when testing the Store install in the same profile.

## Gemini release condition

Before submitting for a public consumer audience, get confirmation from Google that this bring-your-own-key integration is permitted, or use a provider and terms that cover the intended audience. Gemini API terms limit use to professional or business purposes, set an 18+ requirement, restrict clients likely to reach minors, and require paid service for clients offered in the EEA, Switzerland, or the United Kingdom. Curb asks users to confirm eligible use and a billing-enabled project with data sharing off. The extension cannot independently verify those details. [Gemini API terms](https://ai.google.dev/gemini-api/terms#use-restrictions)

Google’s unpaid terms may allow it to use submitted content and responses for product improvement and human review. Chrome Web Store Limited Use restricts transfer, reuse, and human access to user data. Evaluate the provider terms and the distribution plan before completing the Store certifications. [Gemini data use terms](https://ai.google.dev/gemini-api/terms#data-use-unpaid) · [Chrome Web Store Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

## Listing

**Name**
Curb Your YouTube

Google’s branding guidelines require written permission to use its trademarks in an extension name. Confirm permission for this title before submission. [Chrome Web Store branding guidelines](https://developer.chrome.com/docs/webstore/branding)

**Short description**
Focus controls for YouTube™. Hide distractions, set a session intent, and take timed breaks.

**Full description**

Curb Your YouTube is an independent Chrome extension for YouTube™.

Choose what you came to watch, or browse for five minutes. Check whether each video fits your intent. Take a break after 30 or 60 minutes of active use.

Hide homepage recommendations, Shorts, related videos, comments, live chat, and end screens. Reveal thumbnails on hover or preview visible video details with a right-click. Keep frequently used searches in one place.

Enter custom intent and saved searches in Curb’s Settings. Choose whether to use your intent for YouTube search suggestions. Opening a saved search sends those terms to YouTube. Hover thumbnails may request an image from YouTube using the video ID.

Use your own Gemini API key to summarize public videos and optionally check how they fit your intent. When you choose Summarize, Curb sends the selected video URL directly to Google. It sends your intent only if you enable that option. Gemini eligibility, billing, and data terms apply.

Curb keeps settings, saved searches, API keys, and daily watch time in your Chrome profile. Curb uses no account, sync, analytics, or developer server.

YouTube is a trademark of Google LLC. Use of this trademark is subject to Google Permissions. [Chrome Web Store branding guidelines](https://developer.chrome.com/docs/webstore/branding)

## Privacy practices

**Single purpose**
Help people stay focused on YouTube with distraction controls, intent checks and optional summaries, and timed breaks.

**Storage permission**
Keep encrypted preferences, saved searches, Gemini API keys, and one daily watch-time total on this device. Keep active intent, timers, search handoffs, and summary results in Chrome’s temporary session storage.

**Site access**
Access `youtube.com`, `www.youtube.com`, and `m.youtube.com` to show focus controls, hide selected page elements, read visible video details for local previews, and pause playback at prompts.

**Optional Gemini host**
Use `https://generativelanguage.googleapis.com/*` only after the user adds a key and grants permission, to summarize selected public videos using the user’s Gemini project.

**Remote code**
Select **No**. All extension code is in the ZIP.

**Data handling**
Chrome requires disclosure even for on-device processing. Use the Dashboard’s current categories for website content, browsing activity, user-entered text, and API authentication credentials. Describe YouTube’s receipt of selected search terms or a thumbnail ID and Google Gemini’s receipt of the chosen video URL, included intent, and API authentication. The developer receives no extension data. Complete the Limited Use certifications against this ZIP’s behavior and Google’s provider terms. [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

**Privacy policy URL**
Chrome requires a working policy link that readers can open before installing. GitHub Pages provides free static hosting from a public repository. [Chrome privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy) · [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

1. Push the source to a public GitHub repository on the `main` branch. Add the open-source license you choose before publishing.
2. In the repository, set **Settings → Pages → Source** to **GitHub Actions**. Run **Actions → Publish privacy policy** on `main` for the first deployment. [Configure GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. Append `/privacy.html` to the deployment's Pages URL. Open it while signed out, then paste it into **Privacy practices → Privacy policy URL** in the Developer Dashboard.

Edit `store/privacy.html` when the extension changes how it handles data. The workflow republishes the generated page on pushes to `main`, and the next extension build bundles the same text.

## Reviewer instructions

1. Open YouTube and read the first-use disclosure. Select **Enable Curb**.
2. Choose **Practice programming** and select **Start session**. Search from YouTube’s own search box.
3. Open a video. Playback stays paused until the relevance prompt is answered. Select **Yes, this fits** to allow playback.
4. Open Settings from the extension popup and toggle a distraction control. Try **Reveal on hover** for thumbnails and **Save and get YouTube suggestions** for a custom intent.
5. In **Video summaries**, review the Gemini disclosure. With an eligible billing-enabled Gemini API key, allow access and select **Summarize** on a public video. The other features work without Gemini credentials.
6. In Settings, open the privacy policy or select **Clear local data** and confirm to reset the extension. The break reminder appears after 30 or 60 minutes of active use.

No Curb account is required.

## Publisher steps

1. Register the developer account if needed, enter the publisher name, verify the contact email, and enable 2-Step Verification. [Registration](https://developer.chrome.com/docs/webstore/register) · [Account setup](https://developer.chrome.com/docs/webstore/set-up-account) · [2-Step Verification](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
2. Resolve the Gemini release condition, add the public policy link, upload the ZIP, add the listing copy and images, and fill in the Privacy practices and Distribution tabs.
3. Add the reviewer instructions and submit the item for review. Choose deferred publishing to release it manually after approval. [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
