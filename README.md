<p align="center">
  <img src="icons/icon128.png" width="88" height="88" alt="Split for YouTube icon" />
</p>

<h1 align="center">Split for YouTube</h1>

<p align="center"><strong>Read the comments without losing the video.</strong></p>

<p align="center">
  <a href="https://junjing02.github.io/split-for-youtube/"><img src="https://img.shields.io/badge/site-live%20demo-4f46e5" alt="Live demo" /></a>
  <img src="https://img.shields.io/badge/manifest-v3-4f46e5" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/chrome%20web%20store-not%20yet-lightgrey" alt="Not on the Chrome Web Store yet" />
</p>

<p align="center">
  A free Chrome extension that puts the video on the left and everything else on the right. Scroll the comments, browse what's next, and the video never leaves the screen.
</p>

<p align="center"><a href="https://junjing02.github.io/split-for-youtube/">→ See it in action on the landing page</a></p>

---

## Why

On YouTube, the comments and recommendations live below the video. Scroll down to read them and the video slides off the screen.

Split for YouTube fixes that. The video gets its own column, and the description, recommendations and comments sit beside it in panes you can resize and collapse. Read, browse and keep watching, all at once.

## Features

- **Video never scrolls away** — it stays in its own column no matter how far you scroll through comments or recommendations.
- **Drag to resize** — the divider between video and side pane, and the one between recommendations and comments, go wherever you want them.
- **Video-first by default** — every video loads with the player at its largest possible size; the side pane takes whatever's left.
- **Collapsible sections** — description, recommendations, and comments each collapse to a single header with one click.
- **Live streams supported** — recommendations automatically become live chat while a stream is live.
- **Ambient light** — with YouTube's Ambient mode on (dark theme), the video's colors glow softly across the whole background, spreading out from each edge of the video and following it frame by frame. Turn Ambient mode off in the player settings and the background goes back to normal.
- **Two windows** — keep the video in your window and move the description, recommendations and comments to a second window that stays in sync. See [Two windows](#two-windows) below.
- **Stays out of the way** — theater mode, Shorts, and smaller windows all fall back to YouTube's normal layout, untouched.

## Two windows

Want the video as big as possible? Move everything else to its own window.

**Turn it on:** click the Split for YouTube icon in Chrome's toolbar (pin it from the puzzle-piece menu if you don't see it) and switch on **Two windows**. With a video open, a second window appears beside it.

| Your window | The second window |
|---|---|
| Just the video, filling the window | The description, recommendations and comments, stacked and resizable |

Both are real YouTube, so liking, replying, sorting comments and "Show more" all work as usual. The second window remembers where you put it and how big it is.

**They stay in sync:**

| You do this | What happens |
|---|---|
| Click a video in the second window | Your window plays it, and the second window switches to its comments |
| Change videos in your window (autoplay, end screen, any link) | The second window switches to the new video |
| Click a timestamp like `2:31` in a comment or the description | Your video jumps to that moment |
| Click a channel, playlist or search link in the second window | It opens in your window |

**Closing it:**

| You do this | What happens |
|---|---|
| Close the second window | Two windows switches off, and your window goes back to the normal split with all the panes |
| Leave the video (home page, a channel, another site) | The second window closes by itself; open another video and it comes back |
| Switch Two windows off in the toolbar | The second window closes, and the normal split comes back |
| Close the video's tab | The second window closes too |

A like or a new comment shows up in the other window after it reloads; switching videos and timestamps sync instantly.

## Install

Not on the Chrome Web Store yet — load it as an unpacked extension:

1. [Download `split-for-youtube.zip`](https://github.com/junjing02/split-for-youtube/releases/latest/download/split-for-youtube.zip) and unzip it. It contains only the files the extension needs.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `split-for-youtube` folder. (Cloning this repository and selecting its root folder works too.)
5. Open any YouTube video.

## Requirements

Works on a spacious, landscape-oriented window — full screen or close to it. On a narrow or short window, YouTube's normal layout is left untouched.
