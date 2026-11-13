# Curb Your YouTube guide

This file holds the explanations removed from the interface.

## Sessions

- **Session intent:** what you want to do on YouTube. Choose a preset or write your own, up to 180 characters. Selecting a preset preserves anything you typed and does not search YouTube. Typed text takes priority when you start the session. One intent is shared across your YouTube tabs.
- **Start session:** begins a focused session. Text typed in **Your intent** takes priority over a selected preset. The prompt then closes and the text is placed in YouTube's own search box with YouTube's suggestion list open. Pick a suggestion, edit the text, or press Enter to search. With a preset only, the available native search box is focused and empty. On a video page, a preset-only start keeps the video check visible. Typed text opens the native search box on the homepage when a video check covers the page. Today's total is retained.
- **Just browse:** a five-minute casual session, including the homepage and any videos you watch. Intent time stays paused. The allowance pauses when no YouTube tab is active and no video is playing. When it runs out, **Just browse 5 more min** grants another five minutes.
- **Just browse during a session:** choose **Edit intent → Just browse** to browse casually for five minutes while keeping the session's intent and counters. **Resume intent** in the dock returns to focused viewing.
- **Edit intent / Set intent:** opens the intent form. Choosing a new intent keeps the running session: its session time, intent time, and next break are unchanged, and the current video is checked again against the new intent. **Keep current intent** cancels the edit. After **Finish**, **Set intent** starts a new session.
- **Yes, this fits:** approves the current video for intent time. **Watch as a detour** allows this video without adding intent time or changing the intent. **Search instead** returns to the homepage and native search. Curb does not assess video relevance automatically.
- **Search YouTube:** appears in the dock only when **Hide YouTube header and search** is on, since YouTube's own search box is otherwise always visible. It shows the header until you navigate; the saved setting is unchanged.
- **Finish:** pauses playback and keeps YouTube behind the finished-session screen until you start again.

The search field always starts empty when you edit an intent. Previous intents, including those saved by older versions, never become search queries automatically. Selecting a built-in intent alone does not search; an explicitly clicked saved-search card searches its stored terms.

Video checks and breaks leave playback paused after confirmation. Press Play to resume. New videos require another check in focused sessions; replaying an approved video or changing its timestamp does not.

Sessions end after 20 minutes without observed activity, when the last tracked YouTube tab closes, or when browser session storage clears. Break and finished-session prompts apply across tracked tabs.

## Saved searches and controls

The intent screen has three columns on desktop and two on narrow screens. Built-in intents and saved searches share one grid; saved cards have a light left edge. **+ Add search** creates a distinct card with a name and your exact search terms. Save up to six cards; use **Edit** or **Remove** on a card to change it. Clicking a saved card searches its stored terms and uses its name as the intent. During **Edit intent**, the card updates the current session while preserving its timers and break schedule. Otherwise, the card starts a new session. Ordinary searches use YouTube's native search field.

Curb's session controls sit in a bottom dock, leaving YouTube's header and menus in their native positions. The dock shows your intent, the three timers, **Edit intent** (or **Set intent**), and **Finish**. It adds a control only when it applies: the browse countdown and **Resume intent** while browsing, the homepage countdown and **Hide homepage** on a timed homepage, and **Search YouTube** when YouTube's header is hidden. Settings opens from the toolbar popup. While watching, a translucent, single-line pill is centered over the player in normal, theater, and fullscreen mode. It shows your intent and the session time in hours and minutes (for example, 1h 05m). The dock, prompts, popup, and Settings show all timers in the same minutes:seconds format. It follows player resizing and scrolling, hides when the player is offscreen, and lets clicks pass through to the video.

The toolbar popup shows the current session with **Finish this session**, thumbnails, break interval, and five frequent controls. **Settings** has every option. Changes save immediately and apply to open tabs.

## Timers and session settings

- **Intent time:** active browsing in focused sessions, plus videos you confirm as fitting. Casual browsing, detours, prompts, breaks, and blocked Shorts do not add intent time.
- **Session:** active YouTube use since the session began, including prompts and detours. It freezes when you finish. Editing the intent does not reset it.
- **YouTube today:** active use across all sessions on the device's current local date. There is no daily history or daily viewing cap.
- **Break interval:** 30 or 60 minutes of session time. A break pauses all tracked YouTube videos. Changing the interval starts a new interval from the current session time; it does not dismiss a break already due.
- **Intent pill on videos:** shows your intent and the session time over the player in normal, theater, and fullscreen mode, even after playback controls auto-hide. Turning it off removes the pill in every mode. Casual browsing and detours show the same session timer. It does not intercept clicks. Long intents truncate to one line. Browser-owned video-only fullscreen and picture-in-picture cannot display it.

A visible, focused YouTube tab counts as active. Background video playback also counts; paused background tabs do not. Overlapping tabs count once. A prompt can add session and daily time while intent time is paused.

Timers sample activity every two seconds, with a six-second stale-activity limit. Browser throttling can undercount, and switching away can include a small amount of trailing time. Persistent totals are saved about every 15 seconds and on explicit session actions; a crash can lose recent time. Session state survives normal background-worker suspension. Invalid stored state is discarded, and backwards clock changes discard activity leases.

## Homepage and thumbnails

- **Limit homepage browsing:** keeps recommendations hidden until you choose **Browse homepage for … min**. Turning it off allows unrestricted homepage access.
- **Homepage browse time:** 2, 5, or 10 minutes, listed under the limit and available only while it is on; changes apply to the next timed homepage browse. The allowance is shared across tabs and survives refreshes. Only active homepage time counts. Videos, search, other tabs, and breaks pause it. **Hide homepage** ends the allowance early; when it expires, the feed hides until you choose another browse.
- The homepage allowance applies to focused sessions. During **Just browse**, the five-minute browse allowance already covers the homepage, so no second timer runs. New sessions and finished sessions clear the homepage allowance.
- **Video thumbnails — Show normally:** displays thumbnails as usual.
- **Reveal on hover:** the default; uses compact text rows and shows a floating thumbnail when you hover or focus a video title.
- **Always hidden:** hides thumbnails even during hover or keyboard focus.

Titles remain clickable while thumbnail slots collapse. The floating preview uses the card’s available thumbnail; it does not start video playback. Restricted modes suppress YouTube’s separate animated previews without hiding the main video player. Shorts and thumbnail restrictions still apply during homepage browsing. Preferences apply to open YouTube tabs and persist locally.

## Distraction controls

Turning on a **Hide …** setting hides that part of YouTube.

### Feeds

- **Hide entire video sidebar:** removes everything beside the player, including recommendations and sidebar panels.
- **Hide related videos:** removes next-video recommendations.
- **Hide Shorts:** removes Shorts shelves and pauses direct Shorts pages behind a prompt.
- **Hide mix playlists:** removes automatically generated mixes.
- **Hide extra search recommendations:** removes recommendation shelves within search results.

### Navigation

- **Hide Explore and trending:** removes discovery links.
- **Hide More from YouTube:** removes links to Premium, Music, Gaming, and other YouTube services.
- **Hide subscriptions link:** removes the navigation link; it does not redirect the subscriptions feed.
- **Redirect subscriptions to homepage:** opens the homepage instead of the subscriptions feed, so you can use native search without a generated query.
- **Hide YouTube header and search:** removes the top header, including native search. **Search YouTube** then appears in Curb's dock to show it until you navigate.
- **Hide notification bell:** removes the notification control.

### Watch page

- **Hide comments / Hide live chat:** removes the corresponding conversation panel.
- **Hide playlist panel:** removes the queue beside the video.
- **Hide end-screen video wall:** removes suggested videos shown when playback ends.
- **Hide end-screen cards:** removes clickable video and subscribe cards.
- **Hide merchandise and offers:** removes product shelves, tickets, and fundraising panels.

### Video details and playback

- **Hide all video information:** removes the title and metadata area below the player.
- **Hide video action buttons:** removes likes, sharing, and other actions.
- **Hide channel and subscribe button:** removes the creator row below the video.
- **Hide video description:** removes the description below the player.
- **Disable autoplay:** switches off automatic next-video playback. Playlist advancement still requires confirmation in focused sessions.
- **Hide info cards:** removes the player's info-card teaser and button.

## Video previews

**Right-click video previews** (Settings, Distractions) shows text already loaded on the page beside the normal context menu. **Description excerpt** means visible description text; **Video metadata** means the available title, channel, or duration. These are excerpts, not full-video summaries. No transcript or external service is used.

Previews show at most 160 title characters and 210 description characters, or 70 channel characters and 30 duration characters. One preview appears at a time, in the lower-right corner. It closes after 14 seconds, Escape, navigation, the dismiss button, or disabling previews.

## Video summaries

In Settings → **Video summaries**, add your Gemini API key and allow Curb to contact Google. Hover or focus a public video title and select **Summarize**. The button also appears in right-click previews when they are enabled. The card shows a short summary, how it fits your intent, and timestamp links when available. Close it with × or Escape.

**Limit summaries to the first 5 minutes** is on by default. Whole videos may take longer. If Gemini hits a [project usage limit](https://ai.google.dev/gemini-api/docs/rate-limits), Curb tries its available models and backup keys. Backup keys from the same Google project share that project's limits.

Selecting **Summarize** sends Google the video link and your session intent, if set. Curb keeps regular-window results in a browser-session cache keyed by video, intent, and summary length. See the [privacy policy](extension/privacy.html#video-summaries) for data handling.

## Privacy and reset

Preferences, saved-search names and queries, and one aggregate daily total use local extension storage without browser sync. Intents, session counters, temporary tab activity, and pending native-search text and destination use extension session storage. Search handoffs expire after 15 seconds and belong to the current tab and session. Temporary tab records expire after five minutes without activity updates. Video titles, transcripts, and watch history are not saved.

**Clear local data… → Clear and reset** restores default settings, deletes saved searches and all saved Gemini API keys, clears cached summaries and today's total, stops any summary still in progress, and ends the session across tabs. **Cancel** leaves the data intact. Uninstalling removes extension storage.

The extension sends no data to the developer. The only external API it can contact is Google's Gemini API, for optional video summaries: only after you add your own key and allow it, and only when you press Summarize (see Video summaries above). Starting with typed intent places the text in YouTube's native search box, where YouTube can use it to provide suggestions before you submit a search. YouTube continues to process searches and playback under its own policies. The full policy is in [extension/privacy.html](extension/privacy.html).

## Limits

The supported target is desktop Chrome and Firefox. YouTube layout changes may affect hiding. Mobile-site selectors exist, but the full mobile interface is unvalidated. Ads, embedded players on other sites, YouTube TV, and native apps are outside scope.

If the extension connection fails, video pauses behind a prompt until it recovers. After the extension is updated or reloaded, an already open YouTube tab is released rather than blocked and shows a **Reload** notice; reload it to turn Curb back on.

The extension can be disabled. It does not assess a video's accuracy or educational value and is not a medical treatment.
