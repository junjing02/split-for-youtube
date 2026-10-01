<p align="center">
  <img src="icons/icon128.png" width="88" height="88" alt="Split for YouTube icon" />
</p>

<h1 align="center">Split for YouTube</h1>

<p align="center">Watch <strong>and</strong> read at the same time.</p>

<p align="center">
  <a href="https://junjing02.github.io/split-for-youtube/"><img src="https://img.shields.io/badge/site-live%20demo-4f46e5" alt="Live demo" /></a>
  <img src="https://img.shields.io/badge/manifest-v3-4f46e5" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/chrome%20web%20store-not%20yet-lightgrey" alt="Not on the Chrome Web Store yet" />
</p>

<p align="center">
  A Chrome extension that turns the YouTube watch page into a clean two-column layout — video on the left, description, recommendations, and comments stacked and resizable on the right.
</p>

<p align="center"><a href="https://junjing02.github.io/split-for-youtube/">→ See it in action on the landing page</a></p>

---

## Why

On regular YouTube, scrolling down to reach recommendations or comments scrolls the video itself off-screen. Split for YouTube fixes that: the video gets its own fixed column, and description, recommendations, and comments live in a resizable pane next to it — so you can browse without ever losing the video.

## Features

- **Video never scrolls away** — it stays in its own column no matter how far you scroll through comments or recommendations.
- **Drag to resize** — the divider between video and side pane, and the one between recommendations and comments, go wherever you want them.
- **Video-first by default** — every video loads with the player at its largest possible size; the side pane takes whatever's left.
- **Collapsible sections** — description, recommendations, and comments each collapse to a single header with one click.
- **Live streams supported** — recommendations automatically become live chat while a stream is live.
- **Ambient light** — with YouTube's Ambient mode on (dark theme), the video's colors glow softly across the whole background, spreading out from each edge of the video and following it frame by frame. Turn Ambient mode off in the player settings and the background goes back to normal.
- **Stays out of the way** — theater mode, Shorts, and smaller windows all fall back to YouTube's normal layout, untouched.

## Install

Not on the Chrome Web Store yet — load it as an unpacked extension:

1. [Download `split-for-youtube.zip`](https://github.com/junjing02/split-for-youtube/releases/latest/download/split-for-youtube.zip) and unzip it. It contains only the files the extension needs.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `split-for-youtube` folder. (Cloning this repository and selecting its root folder works too.)
5. Open any YouTube video.

## Requirements

Works on a spacious, landscape-oriented window — full screen or close to it. On a narrow or short window, YouTube's normal layout is left untouched.
