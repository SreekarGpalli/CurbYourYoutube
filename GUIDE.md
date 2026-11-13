# Using Curb

## Sessions

Choose a preset, write an intent, or select **Just browse** for five minutes. In a focused session, choose **Yes, this fits** or **Watch as a detour** before playing a new video. A detour counts toward session time, and intent time pauses. Press Play after confirming.

**Edit intent** keeps your timers and next break. **Resume intent** switches back from casual browsing. **Finish** ends the session across tabs. Sessions also end after 20 minutes of inactivity, when the last tracked YouTube tab closes, or when browser session data clears.

- **Intent time** counts focused browsing and approved videos.
- **Session** counts active YouTube time during the session.
- **YouTube today** counts active YouTube time across sessions. Simultaneous tabs count once.

Set a 30- or 60-minute break interval in Settings. **Intent pill on videos** shows the current intent and session time in normal, theater, and fullscreen playback. Browser-owned video fullscreen and picture-in-picture cannot show the pill.

## Search

Save up to six searches. Opening a saved search uses its name as your intent and sends its terms to YouTube.

In local builds, enter an intent or manage saved searches on the intent screen. Starting with typed text fills YouTube’s search box for suggestions. In the Store build, edit both in Settings and use **Save and get YouTube suggestions** to send the intent to YouTube. Choose a suggestion or press Enter to submit.

## Distractions

Settings groups controls by feeds, navigation, watch page, video details, and playback. The toolbar popup has the most-used controls.

- **Limit homepage browsing** hides recommendations until you start a 2-, 5-, or 10-minute browse. **Just browse** already includes the homepage.
- **Video thumbnails** can show normally, appear on hover or keyboard focus, or stay hidden. Local builds default to hover. The Store build defaults to hidden. Hover can request an image from YouTube.
- **Right-click video previews** show a description excerpt or video details next to the selected video. Close with Escape or the close button.
- **Search YouTube** restores the native search box for the current page when Curb hides the header.

## Gemini summaries

Add a Gemini API key in **Settings → Video summaries**. Hover or focus a public video title and select **Summarize**. The card shows a summary, timestamp links when available, and an intent-fit assessment if Gemini receives your intent.

The five-minute limit is on by default. Whole videos can take longer. Google applies usage limits to your project. The Store build asks you to confirm eligibility and keeps intent sharing off until you enable it. [Privacy policy](https://sreekargpalli.github.io/CurbYourYoutube/privacy.html#video-summaries)

## Reset

**Settings → Privacy & data → Clear local data** clears saved searches, API keys, settings, summaries, and today’s watch time. It also ends the session. Store users select **Enable Curb** again after a reset.
