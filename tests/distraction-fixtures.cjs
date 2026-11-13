// Representative desktop YouTube elements, shared by both browser suites.
const distractions = {
  hideHome: '<ytd-browse page-subtype="home"><div id="contents" data-probe>Home feed</div></ytd-browse>',
  hideSidebar: '<ytd-watch-flexy><div id="secondary" data-probe>Sidebar</div></ytd-watch-flexy>',
  hideRelated: '<ytd-watch-next-secondary-results-renderer data-probe>Related</ytd-watch-next-secondary-results-renderer>',
  hideShorts: '<ytd-reel-shelf-renderer data-probe>Shorts</ytd-reel-shelf-renderer>',
  hideMixes: '<ytd-radio-renderer data-probe>Mixes</ytd-radio-renderer>',
  hideSearchClutter: '<ytd-search><ytd-shelf-renderer data-probe>Search shelf</ytd-shelf-renderer></ytd-search>',
  hideExplore: '<ytd-guide-entry-renderer data-probe><a href="/feed/explore">Explore</a></ytd-guide-entry-renderer>',
  hideMore: '<ytd-guide-section-renderer data-probe><a href="/premium">Premium</a></ytd-guide-section-renderer>',
  hideSubscriptions: '<ytd-guide-entry-renderer data-probe><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-entry-renderer>',
  hideHeader: '<div id="masthead-container" data-probe>Header</div>',
  hideNotifications: '<ytd-notification-topbar-button-renderer data-probe>Notifications</ytd-notification-topbar-button-renderer>',
  hideComments: '<ytd-comments data-probe>Comments</ytd-comments>',
  hideLiveChat: '<ytd-live-chat-frame data-probe>Live chat</ytd-live-chat-frame>',
  hidePlaylist: '<ytd-playlist-panel-renderer data-probe>Playlist</ytd-playlist-panel-renderer>',
  hideEndWall: '<div class="ytp-endscreen-content" data-probe>End wall</div>',
  hideEndCards: '<div class="ytp-ce-element" data-probe>End card</div>',
  hideMerch: '<ytd-merch-shelf-renderer data-probe>Merchandise</ytd-merch-shelf-renderer>',
  hideInfo: '<ytd-watch-metadata data-probe>Video info</ytd-watch-metadata>',
  hideButtons: '<ytd-watch-metadata><div id="actions" data-probe>Actions</div></ytd-watch-metadata>',
  hideChannel: '<ytd-watch-metadata><div id="owner" data-probe>Channel</div></ytd-watch-metadata>',
  hideDescription: '<ytd-watch-metadata><div id="description" data-probe>Description</div></ytd-watch-metadata>',
  hideAnnotations: '<div class="ytp-cards-teaser" data-probe>Info card</div>'
};
module.exports = distractions;
