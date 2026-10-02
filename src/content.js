(function () {
  let observer = null;
  // Two-window mode (see the "Two-window mode" section near the bottom):
  // "main" = this tab shows only the video, "companion" = this tab is the
  // pop-up showing only the description, recommendations and comments,
  // "none" = the normal split. The ytsplit=companion URL flag lets the
  // pop-up take its role right away, before the background worker confirms.
  const COMPANION_HINT = new URLSearchParams(location.search).get("ytsplit") === "companion";
  let windowRole = COMPANION_HINT ? "companion" : "none";
  let twoWindowMode = false;
  let startRetryScheduled = false;
  let dragState = null;
  let movedNodes = []; // { node, parent, next } — for safe restore on teardown

  // Whether the CURRENT video's side-pane width is a deliberate manual
  // drag rather than the computed ideal-video default. Read by the window
  // "resize" listener — a genuine window resize used to always fall
  // through to applySideWidth() (recomputing the default), silently
  // discarding a drag the moment the user resized their browser window at
  // all. Reset in start() on every navigation, same as the width itself —
  // this is a live, in-session choice for the CURRENT video only, not
  // something that should carry over to the next one.
  let hasManualSideWidth = false;
  // The side pane's width as a FRACTION of the total columns width at the
  // moment the drag ended (e.g. 0.5 for a 50/50 split) — set alongside
  // hasManualSideWidth in onDocumentMouseUp(). The resize listener uses
  // THIS, not the raw dragged pixel value, to keep the PROPORTION between
  // the two columns the same across a window resize, rather than holding
  // one column at a fixed pixel size while the other absorbs the entire
  // size change.
  let manualSideWidthRatio = 0.5;

  // Whether the description pane is expanded for the CURRENT video only —
  // deliberately NOT persisted. Used to default to localStorage, but that
  // meant expanding it once left it expanded on every future video and
  // every refresh — per explicit request, it should instead always start
  // collapsed and only stay expanded for as long as the current page/video
  // does. Reset in start() on every navigation, same pattern as
  // hasManualSideWidth/inRecsFocusMode above.
  let descExpanded = false;

  // Recommendations/comments collapsed state — same in-memory-only, reset-
  // every-navigation pattern as descExpanded just above (this used to be
  // the one exception, persisted via localStorage/SECONDARY_COLLAPSED_KEY
  // and COMMENTS_COLLAPSED_KEY, specifically so either could survive a
  // refresh or a new video; per explicit request that's now considered the
  // wrong default — collapsing one to make room for the other should only
  // last for the current video, not follow you to every video after).
  let secondaryCollapsed = false;
  let commentsCollapsed = false;

  // Grace period after a drag ends, used by the window "resize" handler
  // below (the only place that still reclamps — see ensureLayout()'s
  // comment on why it no longer does) so a resize event that happens to
  // land right at the end of a drag doesn't immediately reclamp against a
  // measurement taken before the drag's final value has settled.
  const DRAG_END_GRACE_MS = 250;
  let lastDragEndAt = 0;
  let lastVDragEndAt = 0;

  const SIDE_WIDTH_VAR = "--yt-split-side-w";
  // Fallback only, used if the video's ideal width can't be measured yet
  // (see applySideWidth below). Not persisted — see start().
  const DEFAULT_SIDE_WIDTH = 402;
  // A floor, not the default — the default width is computed dynamically
  // to maximize the video (see applySideWidth). Matches YouTube's own
  // native related-videos sidebar width. Previously lowered to 280 to
  // leave more room to drag toward an even bigger video, but at that
  // unusually narrow width YouTube's own internal recommendation-item
  // markup (which we don't restructure, just contain) appeared to render
  // a click target for the whole item that swallowed the channel-name
  // link specifically — plausible since that markup is presumably only
  // tested at/around YouTube's own typical widths. Not independently
  // confirmed; revert this if it doesn't fix it.
  const MIN_SIDE_WIDTH = 400;
  const MIN_VIDEO_WIDTH = 480;
  // Horizontal space inside #columns that's neither video nor side pane:
  // #columns' own left + right padding and the divider column between
  // them, each --split-gap (content.css, max 6px). An upper bound, used to
  // reserve room for the video in the drag math; applySideWidth() measures
  // the real value instead.
  const LAYOUT_OVERHEAD = 18;

  // Resizer between the recommendations/chat pane and the comments pane.
  // Not persisted — see start().
  const TOP_HEIGHT_VAR = "--yt-split-top-h";
  const MIN_PANE_HEIGHT = 160; // matches the CSS min-height on both panes
  const VRESIZER_HEIGHT = 10; // wide hit-box vs. thin visual line, see #yt-split-vresizer::before in content.css
  const V_RESERVED_EXTRA = 18; // gap allowance for drag math (3 gaps: desc↔rec, rec↔resizer, resizer↔comments, max 6px each)

  const VIDEO_MAX_WIDTH_VAR = "--yt-split-video-max-w";
  // Drives content.css's `aspect-ratio` on #player-container-outer — see
  // that rule's comment for why height is handled that way (a pure-CSS
  // guarantee) instead of trusting YouTube's own JS to recalculate it.
  const VIDEO_RATIO_VAR = "--yt-split-video-ratio";
  // Drives the video column's OWN grid-template-columns minimum in
  // content.css (minmax(var(--yt-split-video-min-w, 480px), 1fr)) instead
  // of the fixed 480px it used to be. This is what actually, structurally
  // guarantees the two columns can never overlap: CSS Grid's minmax()
  // minimum is a hard floor the browser's own layout algorithm enforces —
  // no matter how large --yt-split-side-w is asked to be (a JS bug, a
  // stale measurement, anything), the grid will clamp the side pane's
  // ACTUAL rendered size down to whatever's left after this column takes
  // its minimum, every single time, by spec. JS-computed pixel values
  // (clampSideWidth, enforceMinVideoHeight, preventColumnOverlap) still
  // exist for choosing a good DEFAULT/dragged width and as defense in
  // depth, but this is the mechanism that can't be wrong.
  const VIDEO_MIN_WIDTH_VAR = "--yt-split-video-min-w";
  const ASSUMED_ASPECT = 16 / 9;

  // A HEIGHT floor (not derived from MIN_VIDEO_WIDTH — see below for why
  // that was actually a no-op bug), used alongside MIN_VIDEO_WIDTH (a width
  // floor) when reserving space for the video column. Reported bug: at a
  // narrow enough column width, the video got visibly CROPPED (not just
  // shrunk) once some internal minimum height was reached — YouTube's own
  // player appears to enforce a minimum height of its own (exact value
  // unconfirmed, no live access to verify), and when our width-driven
  // sizing pushed the video's NATURAL height (width ÷ its real aspect
  // ratio) below whatever that internal floor actually is, the player held
  // its own height but the frame no longer matched the container's aspect
  // ratio, so the content filled it by cropping instead of
  // scaling/letterboxing cleanly.
  //
  // The fix (aspect-ratio + object-fit CSS) makes the VISUAL result of
  // hitting that floor safe — letterboxing instead of a crop — but per
  // explicit instruction, dragging should just never be ALLOWED to push
  // the video below a known-safe height in the first place, not merely
  // render something acceptable once it's already there. This used to be
  // Math.round(MIN_VIDEO_WIDTH / ASSUMED_ASPECT) — which for a plain 16:9
  // video (ASSUMED_ASPECT itself) resolves to EXACTLY what MIN_VIDEO_WIDTH
  // alone already produces, i.e. it added ZERO extra protection for the
  // single most common case and only ever helped wider-than-16:9 video —
  // that's why cropping was still reachable by dragging. Set independently
  // instead, comfortably above any plausible player-internal floor.
  const MIN_VIDEO_HEIGHT = 360;

  function isWatchPage() {
    // Regular videos and live streams both use /watch — this deliberately
    // covers both. Premieres/VOD-of-a-past-stream are also /watch.
    return location.pathname === "/watch";
  }

  function isShortsPage() {
    return location.pathname.startsWith("/shorts/");
  }

  // options: { collapsed, onToggle } — when given, the header becomes
  // clickable and toggles a "yt-split-pane-collapsed" class on `container`.
  // Recommendations/comments use this so either can be collapsed to make
  // room for the other, same idea as the description section. `collapsed`
  // is the caller's own in-memory flag (secondaryCollapsed/
  // commentsCollapsed, reset every navigation in start() — see their own
  // comment for why this isn't persisted to localStorage); `onToggle`
  // writes back to it on click.
  function ensurePaneHeader(container, text, options) {
    let header = container.querySelector(":scope > .yt-split-pane-header");
    if (!header) {
      header = document.createElement("div");
      header.className = "yt-split-pane-header";
      if (options && options.onToggle) {
        header.classList.add("yt-split-collapsible-header");
        header.addEventListener("click", () => {
          const collapsed = !container.classList.contains("yt-split-pane-collapsed");
          container.classList.toggle("yt-split-pane-collapsed", collapsed);
          options.onToggle(collapsed);
        });
      }
      container.insertBefore(header, container.firstChild);
    }
    if (header.textContent !== text) header.textContent = text;

    // Only ever ADD here — same pattern as the description pane's own
    // expand flag: the click handler is what removes it, so this
    // redundant re-check on every layout pass is a harmless no-op once
    // in sync, and never fights a live click.
    if (options && options.collapsed) container.classList.add("yt-split-pane-collapsed");
  }

  // Moves a node into newParent, remembering exactly where it came from so
  // teardownLayout() can put it back — critical for not confusing
  // YouTube's own internal bookkeeping about its DOM.
  function moveNode(node, newParent) {
    if (node.parentElement === newParent) return;
    movedNodes.push({ node, parent: node.parentElement, next: node.nextSibling });
    newParent.appendChild(node);
  }

  function restoreMovedNodes() {
    for (let i = movedNodes.length - 1; i >= 0; i--) {
      const { node, parent, next } = movedNodes[i];
      if (parent && parent.isConnected && node.isConnected) {
        if (next && next.isConnected && next.parentElement === parent) {
          parent.insertBefore(node, next);
        } else {
          parent.appendChild(node);
        }
      }
    }
    movedNodes = [];
  }

  function setSideWidth(px) {
    document.documentElement.style.setProperty(SIDE_WIDTH_VAR, px + "px");
  }

  // ratio: the video's actual aspect ratio, so the height floor (see
  // MIN_VIDEO_HEIGHT above) can be converted into a width requirement for
  // THIS video specifically — optional, defaults to a fresh measurement;
  // callers on a hot path (dragging) should pass a value cached once at
  // mousedown instead, same reasoning as columnsRect being cached there
  // too rather than re-measured on every mousemove.
  // Shared by clampSideWidth() below AND constrainVideoSize() (which
  // writes it into the VIDEO_MIN_WIDTH_VAR CSS var) — keeping this one
  // formula as the single source of truth for both is what makes them
  // consistent instead of two independent numbers that could drift apart.
  function minVideoWidthFor(ratio) {
    return Math.max(MIN_VIDEO_WIDTH, MIN_VIDEO_HEIGHT * ratio, playerMinWidth);
  }

  // YouTube's own stylesheet can give #player-container-outer a min-width
  // of its own (content.css doesn't override it). If that's larger than
  // our floor above, the video column could shrink below it while the
  // player itself stayed put, spilling past the divider with the side pane
  // sliding over it. Folding it into minVideoWidthFor() keeps the grid
  // minimum and the drag clamp in agreement with what the player will
  // actually do. Refreshed by constrainVideoSize(); only px values count
  // (a percentage min-width comes back unresolved from getComputedStyle).
  let playerMinWidth = 0;

  function measurePlayerMinWidth() {
    const container = document.querySelector("#player-container-outer");
    if (!container) return 0;
    const value = getComputedStyle(container).minWidth;
    return value.endsWith("px") ? parseFloat(value) || 0 : 0;
  }

  function clampSideWidth(px, columnsRect, ratio) {
    if (ratio == null) ratio = measureVideoAspectRatio();
    const reserved = minVideoWidthFor(ratio) + LAYOUT_OVERHEAD;
    const maxSide = Math.max(MIN_SIDE_WIDTH, columnsRect.width - reserved);
    return Math.max(MIN_SIDE_WIDTH, Math.min(maxSide, px));
  }

  // requestAnimationFrame-batched: applying the CSS var on every raw
  // mousemove event (which can fire 60-120+ times/sec) forced a full
  // grid/flex reflow that many times per second too, including across
  // YouTube's own large recommendations/comments DOM — the browser
  // couldn't keep up, which showed up as laggy, unreactive dragging.
  // Batching to one update per animation frame (using only the latest
  // pending position) fixes that.
  let pendingSideWidth = null;
  let sideWidthFrameScheduled = false;

  function flushSideWidth() {
    sideWidthFrameScheduled = false;
    if (pendingSideWidth != null) {
      setSideWidth(pendingSideWidth);
      pendingSideWidth = null;
      // The outer column shrinks/grows instantly via this CSS var, but
      // YouTube's player sizes its own internal video/controls from state
      // it tracks itself, not purely from CSS — nudging it here (already
      // naturally throttled to once per animation frame, same as the
      // visual update) keeps it in sync THROUGHOUT the drag. Without
      // this, the player only found out about the new size once the drag
      // ended (nudged elsewhere on load/retries/actual window resize,
      // never during our own divider drag), so the video stayed at its
      // old, larger rendered size and visibly got clipped by the
      // shrinking container while dragging, instead of scaling down.
      nudgePlayerResize();
      enforceMinVideoHeight();
      preventColumnOverlap();
    }
  }

  // A hard, definitive safety net — checked against the ACTUAL rendered
  // video height, not trusted to clampSideWidth()'s pre-computed reserved-
  // width math. Reported repeatedly: dragging still reached a width narrow
  // enough to crop the video despite that pre-computed floor supposedly
  // reserving enough space for it — whatever the exact reason (a stale
  // measurement, a unit mismatch, a case the formula doesn't cover), a
  // formula computed BEFORE applying a width can't fail here, because this
  // doesn't trust it at all: it measures the real box AFTER the width was
  // just applied, and if that's already below the floor, it immediately
  // corrects by shrinking the side pane back down — every single frame of
  // the drag, not just once at the start. This is the actual stop the drag
  // can't get past, independent of whether the reservation math above is
  // exactly right.
  function enforceMinVideoHeight() {
    const container = document.querySelector("#player-container-outer");
    const columns = document.querySelector("#columns");
    if (!container || !columns) return;
    const containerHeight = container.getBoundingClientRect().height;
    if (containerHeight <= 0 || containerHeight >= MIN_VIDEO_HEIGHT) return;
    const deficit = MIN_VIDEO_HEIGHT - containerHeight;
    const ratio = measureVideoAspectRatio();
    const current = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(SIDE_WIDTH_VAR)
    );
    if (!Number.isFinite(current)) return;
    const columnsRect = columns.getBoundingClientRect();
    const corrected = clampSideWidth(current - deficit * ratio, columnsRect, ratio);
    setSideWidth(corrected);
    // Keep whatever's still pending in sync so a drag in progress doesn't
    // immediately overwrite this correction on the very next frame.
    if (pendingSideWidth != null) pendingSideWidth = corrected;
  }

  // A SEPARATE, more fundamental safety net than enforceMinVideoHeight()
  // above — that one assumes the two grid columns are correctly
  // non-overlapping and only worries about the VIDEO's own aspect ratio
  // within its column. Reported bug clarified it's not actually a crop at
  // all: the video renders fine, but the side pane's LEFT edge lands
  // INSIDE the video's own box, visually covering part of it — which
  // reads as "cropped" but is really a plain rectangle overlap between
  // #primary and #yt-split-side-pane. Whatever the exact cause (grid track
  // sizing not being intersected with available space exactly the way the
  // width-reservation math above assumes, a timing gap between setting the
  // CSS var and the grid actually reflowing to it, or something else video
  // this doesn't try to guess) — this checks the two elements' ACTUAL
  // rendered rectangles directly and, if they overlap by any amount at
  // all, shrinks the side pane by exactly that overlap. This can't be
  // wrong the way a size-based formula can, because "do these two boxes'
  // edges cross" is a direct geometric fact about the real, current
  // render, not a prediction.
  //
  // Also measures the VIDEO ITSELF (#player-container-outer), not just its
  // column: #primary is a grid cell and never overflows, but the player
  // inside it can refuse to shrink past a minimum of its own (see
  // playerMinWidth above) and spill out past the divider. Reported as
  // "the divider keeps dragging over the video once the video stops
  // shrinking" — checking #primary alone never saw it. The limit is the
  // divider's own left edge (the gap), not the side pane's.
  function preventColumnOverlap() {
    const primary = document.querySelector("#primary");
    const sidePane = document.getElementById("yt-split-side-pane");
    const columns = document.querySelector("#columns");
    if (!primary || !sidePane || !columns) return;
    const primaryRect = primary.getBoundingClientRect();
    const sideRect = sidePane.getBoundingClientRect();
    if (primaryRect.width <= 0 || sideRect.width <= 0) return;
    const player = document.querySelector("#player-container-outer");
    const playerRect = player ? player.getBoundingClientRect() : null;
    const videoRight =
      playerRect && playerRect.width > 0 ? Math.max(primaryRect.right, playerRect.right) : primaryRect.right;
    const resizer = document.getElementById("yt-split-resizer");
    const limit = resizer ? resizer.getBoundingClientRect().left : sideRect.left;
    const overlap = videoRight - limit;
    if (overlap <= 0.5) return; // no overlap (0.5px slack for sub-pixel rounding)
    const current = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(SIDE_WIDTH_VAR)
    );
    if (!Number.isFinite(current)) return;
    const columnsRect = columns.getBoundingClientRect();
    // +1px margin so this doesn't sit exactly on the boundary and flip
    // back and forth between overlapping/not on sub-pixel rounding.
    const corrected = clampSideWidth(current - overlap - 1, columnsRect);
    setSideWidth(corrected);
    if (pendingSideWidth != null) pendingSideWidth = corrected;
    // Mid-drag, remember this as a hard stop for the rest of the drag, so
    // further mousemoves are capped here up front (the divider simply
    // stops) instead of overshooting and being pulled back every frame.
    if (dragState) dragState.maxSide = Math.min(dragState.maxSide, corrected);
  }

  function onDocumentMouseMove(e) {
    if (!dragState) return;
    // rect is captured once at mousedown (see setupResizer) rather than
    // re-measured here — #columns' own size doesn't change mid-drag, and
    // calling getBoundingClientRect() on every mousemove is itself a
    // forced-layout read that adds to the same jank.
    const rect = dragState.rect;
    // DELTA from the mousedown point, not an absolute cursor position —
    // same fix, same reasoning as the vertical (recs/comments) resizer's
    // own onDocumentMouseMoveV below. This divider's clickable hit-box
    // (its ::before, ~14px) is wider than its ~3px visual line, so a click
    // essentially never lands exactly on that line. The old absolute
    // formula (`rect.right - e.clientX`) computed a brand new width from
    // the raw cursor position the INSTANT the drag started — any click
    // offset within that wider hit-box meant an immediate jump by that
    // offset before the mouse had even moved, then continued tracking
    // from the wrong baseline; reported as the divider not tracking the
    // cursor smoothly, glitching/jumping partway through a drag. A delta
    // from the width it ACTUALLY was at mousedown starts every drag with
    // zero jump by construction and follows the cursor 1:1 regardless of
    // where within the hit-box it was grabbed.
    let px = dragState.startWidth + (dragState.startX - e.clientX);
    px = Math.min(clampSideWidth(px, rect, dragState.ratio), dragState.maxSide);
    pendingSideWidth = px;
    if (!sideWidthFrameScheduled) {
      sideWidthFrameScheduled = true;
      requestAnimationFrame(flushSideWidth);
    }
  }

  function onDocumentMouseUp() {
    if (!dragState) return;
    const columnsWidth = dragState.rect.width;
    dragState = null;
    lastDragEndAt = Date.now();
    document.body.classList.remove("yt-split-resizing");
    flushSideWidth(); // apply the latest dragged position immediately, don't wait on a pending frame
    // Marks this as a deliberate, manual choice for the window "resize"
    // listener below — see hasManualSideWidth's own comment for why that
    // matters. Not persisted ACROSS NAVIGATION (see start(), which resets
    // both this flag and the width itself) — a drag is a live, in-session
    // choice for the current video only, and every refresh or new video
    // still resets to the video-maximizing default. Within that one video,
    // though, it should survive the user simply resizing their browser
    // window — see the "resize" listener, which uses manualSideWidthRatio
    // (not the raw pixel width) to keep the PROPORTION between the two
    // columns the user chose, rather than holding one of them at a fixed
    // pixel size while the other absorbs 100% of whatever the window
    // resize changed — reported directly as the wrong behavior: "it should
    // rmb the ratio between each columns, instead of just keeping one's
    // width while changing the rest."
    const current = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(SIDE_WIDTH_VAR)
    );
    if (Number.isFinite(current) && columnsWidth > 0) {
      manualSideWidthRatio = current / columnsWidth;
    }
    hasManualSideWidth = true;
  }

  // Bound once, ever — dragState tracks which resizer/columns pair is
  // active, so this doesn't need re-binding as elements get recreated.
  document.addEventListener("mousemove", onDocumentMouseMove);
  document.addEventListener("mouseup", onDocumentMouseUp);

  function setupResizer(resizer, columns) {
    if (resizer.dataset.bound === "1") return;
    resizer.dataset.bound = "1";
    resizer.addEventListener("mousedown", (e) => {
      // sidePane is queried fresh here rather than passed in — by the time
      // a user can actually click the resizer, ensureLayout() has already
      // built it, and this only ever runs on a real click, not at setup
      // time (when it might not exist yet on a first pass).
      const sidePane = document.getElementById("yt-split-side-pane");
      dragState = {
        columns,
        rect: columns.getBoundingClientRect(),
        ratio: measureVideoAspectRatio(),
        startWidth: sidePane ? sidePane.getBoundingClientRect().width : 0,
        startX: e.clientX,
        // Hard stop discovered mid-drag by preventColumnOverlap().
        maxSide: Infinity
      };
      document.body.classList.add("yt-split-resizing");
      e.preventDefault();
    });
  }

  // Second resizer: between the recommendations/chat pane (top) and the
  // comments pane (bottom), inside the side pane. Undragged, both panes
  // just split the side pane's remaining height (after the description
  // section above them) 50/50 via flex (CSS default of "50%" on the var)
  // — dragging switches to an explicit, clamped px height for the top
  // pane for the current viewing session only (not persisted — reset to
  // the 50% default on every navigation, same as the main divider).
  let vDragState = null;

  function setTopHeight(px) {
    if (px == null) {
      document.documentElement.style.removeProperty(TOP_HEIGHT_VAR);
    } else {
      document.documentElement.style.setProperty(TOP_HEIGHT_VAR, px + "px");
    }
  }

  // descHeight: pass a cached value during drag (see setupVResizer) to
  // avoid a forced-layout read on every mousemove; omitted elsewhere
  // (reclampTopHeight), where it's measured fresh.
  function clampTopHeight(px, sidePaneRect, descHeight) {
    // The description pane sits above #secondary and takes real space
    // (more when expanded) — without subtracting it here, a large dragged
    // value plus an expanded description could together exceed the side
    // pane's actual height.
    if (descHeight == null) {
      const descPane = document.getElementById("yt-split-desc-pane");
      descHeight = descPane ? descPane.getBoundingClientRect().height : 0;
    }
    const reserved = MIN_PANE_HEIGHT + VRESIZER_HEIGHT + V_RESERVED_EXTRA + descHeight;
    const maxTop = Math.max(MIN_PANE_HEIGHT, sidePaneRect.height - reserved);
    return Math.max(MIN_PANE_HEIGHT, Math.min(maxTop, px));
  }

  function reclampTopHeight() {
    const sidePane = document.querySelector("#yt-split-side-pane");
    if (!sidePane) return;
    const rect = sidePane.getBoundingClientRect();
    if (rect.height <= 0) return;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(TOP_HEIGHT_VAR).trim();
    if (!raw || raw.endsWith("%")) return; // still the 50/50 default — nothing to clamp
    const current = parseFloat(raw);
    if (!Number.isFinite(current)) return;
    setTopHeight(clampTopHeight(current, rect));
  }

  // Same requestAnimationFrame-batching as the main divider, and the same
  // reasoning: applying on every raw mousemove event forced too many
  // reflows per second for the browser to keep up with, which read as
  // laggy/unreactive dragging.
  let pendingTopHeight = null;
  let topHeightFrameScheduled = false;

  function flushTopHeight() {
    topHeightFrameScheduled = false;
    if (pendingTopHeight != null) {
      setTopHeight(pendingTopHeight);
      pendingTopHeight = null;
    }
  }

  function onDocumentMouseMoveV(e) {
    if (!vDragState) return;
    // rect/startY/startHeight/descHeight are all captured once at
    // mousedown (see setupVResizer) rather than re-measured here — none of
    // them change mid-drag, and each getBoundingClientRect() call is
    // itself a forced-layout read that adds to the same jank.
    // DELTA from the mousedown point, not an absolute cursor position —
    // deliberately so. The vresizer's actual clickable hit-box is much
    // taller than its ~6px visual line (its ::before extends 7px above and
    // below it, for an easier target — see content.css), so the user's
    // click essentially never lands exactly ON that line. An
    // absolute-position formula (secondary's height := cursor Y − #secondary's
    // top) computes a brand new height from the RAW cursor position the
    // instant the drag starts — if the click landed even a few px off
    // center within that wider hit-box, the pane would immediately jump by
    // that offset before the mouse has moved at all, then continue
    // tracking from the wrong baseline. Tracking a delta from wherever the
    // height ACTUALLY was at mousedown instead means dragging always
    // starts from the true current size with zero jump, then follows the
    // cursor 1:1 no matter where within the hit-box it was grabbed.
    let px = vDragState.startHeight + (e.clientY - vDragState.startY);
    px = clampTopHeight(px, vDragState.rect, vDragState.descHeight);
    pendingTopHeight = px;
    if (!topHeightFrameScheduled) {
      topHeightFrameScheduled = true;
      requestAnimationFrame(flushTopHeight);
    }
  }

  function onDocumentMouseUpV() {
    if (!vDragState) return;
    vDragState = null;
    lastVDragEndAt = Date.now();
    document.body.classList.remove("yt-split-resizing-v");
    flushTopHeight(); // apply the latest dragged position immediately, don't wait on a pending frame
    // Deliberately not persisted — see onDocumentMouseUp above.
  }

  document.addEventListener("mousemove", onDocumentMouseMoveV);
  document.addEventListener("mouseup", onDocumentMouseUpV);

  function setupVResizer(vresizer, sidePane) {
    if (vresizer.dataset.bound === "1") return;
    vresizer.dataset.bound = "1";
    vresizer.addEventListener("mousedown", (e) => {
      const rect = sidePane.getBoundingClientRect();
      const secondary = document.querySelector("#secondary");
      const startHeight = secondary ? secondary.getBoundingClientRect().height : MIN_PANE_HEIGHT;
      const descPane = document.getElementById("yt-split-desc-pane");
      const descHeight = descPane ? descPane.getBoundingClientRect().height : 0;
      vDragState = { sidePane, rect, startY: e.clientY, startHeight, descHeight };
      document.body.classList.add("yt-split-resizing-v");
      e.preventDefault();
    });
  }

  function hasLiveChat(secondary) {
    // YouTube can include a <ytd-live-chat-frame> in the DOM even for a
    // regular (non-live) video — hidden/inactive, not removed. Checking
    // for its mere presence mislabeled every video's recommendations pane
    // as "Live Chat". Require it to actually be rendered with real size.
    const chat = secondary.querySelector("ytd-live-chat-frame");
    return !!chat && chat.offsetWidth > 0 && chat.offsetHeight > 0;
  }

  function setDescExpanded(pane, expanded) {
    descExpanded = expanded;
    pane.classList.toggle("yt-split-desc-expanded", expanded);
  }

  // Builds the collapsed-by-default description section at the top of the
  // side pane: a small clickable header (title/channel/stats/description
  // all live inside #below, moved wholesale) that expands in place on
  // click, independent of the recommendations/comments resizer below it.
  function ensureDescPane(sidePane, below) {
    let pane = document.getElementById("yt-split-desc-pane");
    if (!pane) {
      pane = document.createElement("div");
      pane.id = "yt-split-desc-pane";
      sidePane.appendChild(pane);
    } else if (pane.parentElement !== sidePane) {
      sidePane.appendChild(pane);
    }

    let header = pane.querySelector(":scope > .yt-split-desc-header");
    if (!header) {
      header = document.createElement("button");
      header.type = "button";
      header.className = "yt-split-pane-header yt-split-desc-header";
      header.textContent = "Description";
      // Buttons take keyboard focus on click by default. Left alone, that
      // meant any spacebar press AFTER clicking this header (an entirely
      // normal thing to do while rearranging panes) would hit the browser's
      // native "activate the focused button" behavior instead of reaching
      // YouTube's own document-level play/pause shortcut handler — toggling
      // the description again, and eating the keystroke, rather than
      // pausing/playing the video. preventDefault on mousedown is the
      // standard way to let the click itself still fire normally while
      // stopping the browser from moving focus onto the element at all.
      header.addEventListener("mousedown", (e) => e.preventDefault());
      header.addEventListener("click", () => {
        setDescExpanded(pane, !pane.classList.contains("yt-split-desc-expanded"));
      });
      pane.appendChild(header);
    }

    if (descExpanded) pane.classList.add("yt-split-desc-expanded");

    let body = document.getElementById("yt-split-desc-body");
    if (!body) {
      body = document.createElement("div");
      body.id = "yt-split-desc-body";
      pane.appendChild(body);
    } else if (body.parentElement !== pane) {
      pane.appendChild(body);
    }

    if (below) moveNode(below, body);
  }

  // Builds: [description (collapsed by default)] [recommendations/live
  // chat] [divider] [comments], stacked in the right-hand side pane, with
  // #primary (just the video now) as the left column. Anything else found
  // as a direct child of #columns (e.g. a live stream's chat frame, on
  // layouts where YouTube mounts it as a sibling rather than inside
  // #secondary) is swept into the side pane too, instead of being left as
  // an unpositioned leftover in the grid.
  // YouTube can transiently end up with more than one element sharing the
  // same id (invalid HTML, but browsers tolerate it) during an SPA
  // navigation — e.g. an old #secondary we already relocated into our side
  // pane, now an empty orphaned shell, while a NEW #secondary carrying the
  // actual recommendations sits elsewhere still in its original position.
  // document.querySelector/getElementById always return the FIRST match in
  // document order — if our relocated (and by now empty) one happens to
  // sort first, plain querySelector would keep finding that same wrong,
  // empty element forever, no matter how many times ensureLayout() re-runs
  // — it's not a timing problem retries can outlast, since we're never
  // even looking at the right element. This was the real cause of a
  // reported failure mode where the split applied (headers/panes built
  // fine) but stayed permanently broken until a hard refresh: video frame
  // black (audio still playing — the real, populated element was simply
  // never the one we'd grabbed and styled), "Recommended" pane empty, and
  // real recommendation items rendering raw/unstyled elsewhere on the page,
  // outside every container we control. Prefer whichever candidate
  // actually has the expected content; only fall back to "just the first
  // one" if none of them do (nothing's loaded yet — the normal, temporary
  // case retries already handle fine).
  function findBestById(id, hasContent) {
    const candidates = document.querySelectorAll("#" + id);
    if (candidates.length <= 1) return candidates[0] || null;
    // Confirmed via a user-reported console capture that this really does
    // happen on real navigations — no longer logging it routinely now that
    // it's a known, handled case rather than something to keep diagnosing.
    for (const el of candidates) {
      if (hasContent(el)) return el;
    }
    return candidates[0];
  }

  // Full-bleed: YouTube caps and centers the watch page's own content
  // width on wide/maximized windows (readability on ultrawide monitors —
  // unrelated to theater mode). #columns is width: 100%, but that's 100%
  // of whatever ITS parent is; if some ancestor further up is itself
  // capped/centered (via max-width+margin, or padding), the whole split
  // stops short of the real window edges regardless. Rather than guess
  // the exact container by name (fragile — YouTube's markup isn't a
  // stable target, and a wrong guess both fails to fix anything AND risks
  // stripping styling an unrelated ancestor needs for something else —
  // an earlier attempt guessed ytd-watch-flexy/#page-manager and zeroed
  // margin entirely, which stripped a TOP margin one of them needed to
  // clear the fixed masthead and made the split overlap the "Create"/
  // account buttons), this walks the REAL ancestor chain from #columns up
  // to (not including) document.body at runtime and measures each one:
  // an ancestor gets overridden if it's either narrower than its own
  // parent (a margin/max-width-based cap) OR carries horizontal padding
  // (a padding-based cap doesn't make the element's own border box
  // measure any narrower, so the width check alone misses it) — and only
  // that element's width/max-width and LEFT/RIGHT margin/padding get
  // touched, never top/bottom.
  let widenedAncestors = [];

  // Plain el.parentElement returns null at a ShadowRoot boundary — several
  // ytd-* elements (e.g. ytd-watch-flexy) use native Shadow DOM, so #columns'
  // real ancestor chain up to <body> can cross one or more shadow roots.
  // Falling through to the root's .host keeps the walk going instead of
  // silently stopping partway up (which looked, from the outside, like
  // "no ancestor was ever narrower" even though the actual capping element
  // was simply never reached).
  function getEffectiveParent(el) {
    const parent = el.parentElement;
    if (parent) return parent;
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) {
      console.warn("[YouTube Split Layout] spanFullWidth: crossing shadow boundary at", el, "-> host", root.host);
      return root.host;
    }
    return null;
  }

  function spanFullWidth(columns) {
    let el = getEffectiveParent(columns);
    let anyChecked = false;
    // Walk all the way up to (not including) <html>. Originally this
    // stopped at document.body (excluded), on the assumption body itself
    // wouldn't be the culprit — but a user report of "still not edge to
    // edge" came back with NO ancestor between #columns and body ever
    // being flagged as narrower/padded, which only makes sense if the
    // real cap is on body itself (YouTube's own body sometimes carries a
    // margin or max-width for centering non-split pages). body is YouTube's
    // own element like #primary/#secondary, not one we created, but the
    // same override-and-verify approach applies, and restoreWidenedAncestors()
    // already reverts generically by element reference, so including it
    // here needs no special-casing elsewhere.
    while (el && el !== document.documentElement) {
      anyChecked = true;
      const parent = getEffectiveParent(el);
      if (!parent) break;
      if (widenedAncestors.includes(el)) {
        // Already fixed by an earlier pass this navigation — skip
        // re-applying the exact same styles. ensureLayout() (and so this
        // function) can run many times in quick succession while the page
        // is mutating, e.g. during a drag — repeatedly calling
        // setProperty with unchanged values still forces a style
        // recalc each time, and per a reported bug this also seems to
        // make YouTube's own nearby components (icons in the description
        // area) re-render visibly glitchy (overlapping/shifting) as a
        // side effect. Once an ancestor is confirmed fixed, leave it
        // alone until teardown.
        el = parent;
        continue;
      }
      const elWidth = el.getBoundingClientRect().width;
      const parentWidth = parent.getBoundingClientRect().width;
      const narrowerThanParent = elWidth > 0 && parentWidth > 0 && elWidth < parentWidth - 1;
      const style = getComputedStyle(el);
      const hasHorizontalPadding =
        (parseFloat(style.paddingLeft) || 0) > 0 || (parseFloat(style.paddingRight) || 0) > 0;
      if (narrowerThanParent || hasHorizontalPadding) {
        el.style.setProperty("max-width", "none", "important");
        el.style.setProperty("width", "100%", "important");
        // If this ancestor is itself a flex item with an explicit
        // flex-basis (not "auto"), flex-basis takes priority over the
        // width property entirely — plain width: 100% silently does
        // nothing in that case, one plausible reason the gap can persist
        // even with this function running. flex: 1 1 auto forces the
        // basis back to auto (falling through to width) and lets it grow
        // to fill any leftover space in a flex parent too.
        el.style.setProperty("flex", "1 1 auto", "important");
        el.style.setProperty("margin-left", "0", "important");
        el.style.setProperty("margin-right", "0", "important");
        el.style.setProperty("padding-left", "0", "important");
        el.style.setProperty("padding-right", "0", "important");
        if (!widenedAncestors.includes(el)) widenedAncestors.push(el);
        // Verify the override actually took effect (forces a fresh
        // reflow) — if this element is STILL narrower than its parent
        // after all of the above, something about it can't be fixed by
        // width/flex/margin/padding overrides alone (a transform, a
        // fixed/absolute positioning context, a shadow-DOM boundary,
        // etc.), and that's worth knowing concretely rather than guessing
        // a fourth CSS property to add blindly.
        const newWidth = el.getBoundingClientRect().width;
        const newParentWidth = parent.getBoundingClientRect().width;
        if (newWidth > 0 && newParentWidth > 0 && newWidth < newParentWidth - 1) {
          console.warn(
            "[YouTube Split Layout] spanFullWidth: overrides applied but element is still narrower than its parent",
            el,
            { newWidth, newParentWidth }
          );
        }
      }
      el = parent;
    }
    if (!anyChecked) {
      console.warn("[YouTube Split Layout] spanFullWidth: #columns has no ancestors before document.documentElement?", columns);
    }
  }

  // Reverts exactly the properties spanFullWidth() set, on exactly the
  // elements it touched — not the whole style attribute, in case an
  // element already had unrelated inline styles of its own. These are
  // YouTube's own native ancestor elements; leaving inline styles on them
  // would otherwise leak into normal, non-split YouTube browsing once the
  // split deactivates.
  function restoreWidenedAncestors() {
    for (const el of widenedAncestors) {
      el.style.removeProperty("max-width");
      el.style.removeProperty("width");
      el.style.removeProperty("flex");
      el.style.removeProperty("margin-left");
      el.style.removeProperty("margin-right");
      el.style.removeProperty("padding-left");
      el.style.removeProperty("padding-right");
    }
    widenedAncestors = [];
  }

  // ---- Ambient light ----
  // Our own ambient glow behind the whole window, modeled on the "Ambient
  // light for YouTube" extension (WesselKroos/youtube-ambilight):
  //   1. Every frame (capped at AMBIENT_FRAME_MS), the playing <video> is
  //      drawn into a tiny sample canvas.
  //   2. That sample is drawn AMBIENT_LEVELS times into a low-res "frame"
  //      canvas covering the window (plus overscan), each copy scaled a bit
  //      larger around the video's real on-screen position, largest first,
  //      so the colors along each edge of the video spread outward from
  //      that edge (the classic Ambilight look) all the way to the window
  //      edges.
  //   3. The frame is blurred into the visible canvas (cheap at this size)
  //      and blended over the previous one (AMBIENT_BLEND) to smooth
  //      flicker without noticeable lag. CSS adds a little more blur plus
  //      brightness/saturation (--split-ambient-* tokens in content.css),
  //      and a separate grain layer hides color banding.
  // It follows YouTube's own "Ambient mode" setting (and dark theme), and
  // YouTube's native glow is hidden (content.css). Replaces an earlier
  // approach of restyling YouTube's own #cinematics glow, which lagged
  // (YouTube samples the video only now and then and slowly cross-fades)
  // and couldn't be made to cover the window cleanly.
  const AMBIENT_ID = "yt-split-ambient";
  const AMBIENT_GRAIN_ID = "yt-split-ambient-grain";
  const AMBIENT_ON_CLASS = "yt-split-ambient-on";
  const AMBIENT_SAMPLE_W = 64;
  const AMBIENT_SAMPLE_H = 36;
  const AMBIENT_CANVAS_SCALE = 1 / 8; // canvas px per CSS px
  const AMBIENT_CANVAS_BLUR = 7; // in canvas px (~56 CSS px)
  const AMBIENT_LEVELS = 12;
  const AMBIENT_BLEND = 0.5; // weight of each new frame over the previous
  const AMBIENT_FRAME_MS = 1000 / 30;
  const AMBIENT_CHECK_MS = 500; // how often to re-check YouTube's setting
  const AMBIENT_STILL_FRAMES = 12; // redraws after pausing before idling
  // Start of the path in YouTube's "Ambient mode" settings-menu icon.
  const AMBIENT_MENU_ICON = "M21 7v10H3V7h18m1-1H2v12h20V6z";

  let ambient = null;

  // Last Ambient mode state read from YouTube's own settings menu,
  // remembered (in memory and localStorage, which this content script
  // shares with youtube.com) because the menu item isn't always in the
  // DOM: YouTube can tear the settings menu down once it's closed. An
  // earlier version only read the live menu and otherwise guessed from
  // YouTube's own glow canvas, which stays in the DOM with ambient mode
  // off, so the glow kept running after the user turned ambient mode off.
  const AMBIENT_SAVED_KEY = "ytSplitAmbientMode";

  function loadAmbientPref() {
    try {
      const v = localStorage.getItem(AMBIENT_SAVED_KEY);
      return v === "on" ? true : v === "off" ? false : null;
    } catch (e) {
      return null;
    }
  }

  function saveAmbientPref(on) {
    try {
      localStorage.setItem(AMBIENT_SAVED_KEY, on ? "on" : "off");
    } catch (e) {
      // storage unavailable; the in-memory state still works this session
    }
  }

  // The "Ambient mode" item in the player's settings menu, matched by its
  // icon or by "ambient" in its text, among any menu checkbox on the page.
  function findAmbientMenuItem() {
    for (const item of document.querySelectorAll('.ytp-menuitem, [role="menuitemcheckbox"]')) {
      const path = item.querySelector("path");
      const d = path ? path.getAttribute("d") || "" : "";
      if (d.startsWith(AMBIENT_MENU_ICON) || /ambient/i.test(item.textContent)) return item;
    }
    return null;
  }

  // Checked state from the item itself or whichever child carries
  // aria-checked; null if it can't be read.
  function readMenuChecked(item) {
    const el = item.hasAttribute("aria-checked") ? item : item.querySelector("[aria-checked]");
    return el ? el.getAttribute("aria-checked") === "true" : null;
  }

  // Whether YouTube's own Ambient mode is on, and which signal said so.
  // Order: the live settings-menu item (saved for later), then the last
  // saved state, then (only if the state has never been read) whether
  // YouTube set up its own glow canvas. Dark theme only, like YouTube.
  function readYouTubeAmbientMode() {
    if (!document.documentElement.hasAttribute("dark")) return { on: false, source: "light theme" };
    const item = findAmbientMenuItem();
    const checked = item ? readMenuChecked(item) : null;
    if (checked !== null) {
      saveAmbientPref(checked);
      return { on: checked, source: "settings menu" };
    }
    const saved = loadAmbientPref();
    if (saved !== null) return { on: saved, source: "remembered setting" };
    const cinematics = document.querySelector("#cinematics, #cinematics-container");
    return { on: !!(cinematics && cinematics.querySelector("canvas")), source: "YouTube glow (guess)" };
  }

  function setAmbientOn(on, source) {
    if (!ambient || ambient.on === on) return;
    ambient.on = on;
    ambient.fresh = true;
    document.documentElement.classList.toggle(AMBIENT_ON_CLASS, on);
    // Only on an actual change (rare), so a wrong on/off state can be
    // diagnosed from the console instead of guessed at.
    console.info(`[Split for YouTube] ambient light ${on ? "on" : "off"} (from ${source})`);
  }

  function ensureAmbient(columns) {
    if (!ambient) {
      const root = document.createElement("div");
      root.id = AMBIENT_ID;
      root.setAttribute("aria-hidden", "true");
      const canvas = document.createElement("canvas");
      root.appendChild(canvas);
      const grain = document.createElement("div");
      grain.id = AMBIENT_GRAIN_ID;
      grain.setAttribute("aria-hidden", "true");
      const sample = document.createElement("canvas");
      sample.width = AMBIENT_SAMPLE_W;
      sample.height = AMBIENT_SAMPLE_H;
      const frame = document.createElement("canvas");
      ambient = {
        root,
        grain,
        canvas,
        ctx: canvas.getContext("2d"),
        sample,
        sctx: sample.getContext("2d"),
        frame,
        fctx: frame.getContext("2d"),
        rafId: 0,
        on: false,
        fresh: true,
        lastDraw: 0,
        lastCheck: 0,
        lastKey: "",
        stillFrames: 0,
      };
    }
    // Glow before grain in tree order: both are z-index: -1, so tree order
    // decides which paints on top (the grain, overlay-blended onto the glow).
    if (ambient.root.parentElement !== columns) columns.appendChild(ambient.root);
    if (ambient.grain.previousElementSibling !== ambient.root) ambient.root.after(ambient.grain);
    if (!ambient.rafId) ambient.rafId = requestAnimationFrame(ambientTick);
  }

  function teardownAmbient() {
    document.documentElement.classList.remove(AMBIENT_ON_CLASS);
    if (!ambient) return;
    if (ambient.rafId) cancelAnimationFrame(ambient.rafId);
    ambient.root.remove();
    ambient.grain.remove();
    ambient = null;
  }

  function ambientTick(now) {
    if (!ambient) return;
    ambient.rafId = 0;
    if (!ambient.root.isConnected) return;
    ambient.rafId = requestAnimationFrame(ambientTick);

    if (now - ambient.lastCheck >= AMBIENT_CHECK_MS) {
      ambient.lastCheck = now;
      const mode = readYouTubeAmbientMode();
      setAmbientOn(mode.on, mode.source);
    }
    // Fullscreen: the glow is hidden (content.css), so don't spend frames
    // drawing it; start clean (no blending from a stale frame) on exit.
    if (document.fullscreenElement) {
      ambient.fresh = true;
      return;
    }
    if (!ambient.on || now - ambient.lastDraw < AMBIENT_FRAME_MS - 2) return;

    const video = document.querySelector("#primary video");
    const player = document.querySelector("#player-container-outer");
    if (!video || !player || video.readyState < 2) return;
    const rect = player.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // While paused with nothing moving, keep redrawing only until the
    // frame blending has settled, then idle.
    const key = [rect.left, rect.top, rect.width, rect.height, innerWidth, innerHeight, video.currentTime].join();
    if (key !== ambient.lastKey || !video.paused) {
      ambient.lastKey = key;
      ambient.stillFrames = 0;
    } else if (++ambient.stillFrames > AMBIENT_STILL_FRAMES && !ambient.fresh) {
      return;
    }
    ambient.lastDraw = now;
    drawAmbient(video, rect);
  }

  function drawAmbient(video, rect) {
    const a = ambient;
    const box = a.root.getBoundingClientRect();
    const W = Math.max(1, Math.round(box.width * AMBIENT_CANVAS_SCALE));
    const H = Math.max(1, Math.round(box.height * AMBIENT_CANVAS_SCALE));
    if (a.canvas.width !== W || a.canvas.height !== H) {
      a.canvas.width = a.frame.width = W;
      a.canvas.height = a.frame.height = H;
      a.fresh = true;
    }

    try {
      a.sctx.drawImage(video, 0, 0, AMBIENT_SAMPLE_W, AMBIENT_SAMPLE_H);
    } catch (e) {
      return; // frame not drawable right now (e.g. mid source switch)
    }

    // Video position in canvas pixels, and the scale at which a copy
    // centered on it covers the whole canvas.
    const w = rect.width * AMBIENT_CANVAS_SCALE;
    const h = rect.height * AMBIENT_CANVAS_SCALE;
    const cx = (rect.left - box.left) * AMBIENT_CANVAS_SCALE + w / 2;
    const cy = (rect.top - box.top) * AMBIENT_CANVAS_SCALE + h / 2;
    const maxScale =
      Math.max(Math.max(cx, W - cx) / (w / 2), Math.max(cy, H - cy) / (h / 2), 1) * 1.02;
    for (let i = AMBIENT_LEVELS - 1; i >= 0; i--) {
      const scale = Math.pow(maxScale, i / (AMBIENT_LEVELS - 1));
      const lw = w * scale;
      const lh = h * scale;
      a.fctx.drawImage(a.sample, cx - lw / 2, cy - lh / 2, lw, lh);
    }

    a.ctx.save();
    if (a.fresh) a.ctx.clearRect(0, 0, W, H);
    a.ctx.globalAlpha = a.fresh ? 1 : AMBIENT_BLEND;
    a.ctx.filter = `blur(${AMBIENT_CANVAS_BLUR}px)`;
    a.ctx.drawImage(a.frame, 0, 0);
    a.ctx.restore();
    a.fresh = false;
  }

  // Toggling "Ambient mode" in the player's settings menu: re-check right
  // away instead of waiting out AMBIENT_CHECK_MS, twice, since YouTube may
  // update the item's aria-checked a moment after the click. The check
  // itself also saves the new state (see readYouTubeAmbientMode).
  document.addEventListener(
    "click",
    (e) => {
      if (!ambient || !e.target.closest) return;
      if (!e.target.closest('.ytp-menuitem, [role="menuitemcheckbox"]')) return;
      for (const delay of [60, 300]) {
        setTimeout(() => {
          if (!ambient) return;
          const mode = readYouTubeAmbientMode();
          setAmbientOn(mode.on, mode.source);
        }, delay);
      }
    },
    true
  );

  // ---- Subscribe button repair ----
  // When subscribed, YouTube shows the notification bell button and hides
  // the separate Subscribe/"Subscribed" button. Reported: correct on first
  // load, but after the split turned off and on again (e.g. resizing the
  // window across the activation threshold) both showed, "Subscribed"
  // stacked over the bell, and stayed that way, even in YouTube's own
  // layout. Most likely YouTube's component re-renders in its two-button
  // form when #below (which contains it) is detached and re-attached by
  // moveNode(), which happens on every activation and teardown and can't be
  // avoided. So restore the intended look directly: if the bell is showing
  // and the separate button is ALSO showing, hide the separate one; once
  // the bell is gone (unsubscribed), undo that so "Subscribe" comes back.
  // Uses actual rendered boxes (getClientRects), so it does nothing
  // whenever YouTube already shows the right thing. Runs on every layout
  // pass, shortly after teardown, after window resizes and after clicks.
  const SUB_HIDDEN_ATTR = "data-yt-split-hidden";

  function isRendered(el) {
    return !!el && el.getClientRects().length > 0;
  }

  function repairSubscribeButtons() {
    document.querySelectorAll("ytd-subscribe-button-renderer").forEach((renderer) => {
      const shape = renderer.querySelector("#subscribe-button-shape");
      const bell = renderer.querySelector("#notification-preference-button");
      if (!shape || !bell) return;
      const bellShown = isRendered(bell) && bell.querySelector("button") != null;
      if (bellShown && isRendered(shape)) {
        shape.style.setProperty("display", "none", "important");
        shape.setAttribute(SUB_HIDDEN_ATTR, "");
      } else if (!bellShown && shape.hasAttribute(SUB_HIDDEN_ATTR)) {
        shape.style.removeProperty("display");
        shape.removeAttribute(SUB_HIDDEN_ATTR);
      }
    });
  }

  // A couple of passes, since YouTube can re-render the button a moment
  // after whatever triggered it.
  let subscribeRepairTimers = [];
  function scheduleSubscribeRepair() {
    subscribeRepairTimers.forEach(clearTimeout);
    subscribeRepairTimers = [300, 1200].map((ms) => setTimeout(repairSubscribeButtons, ms));
  }

  document.addEventListener(
    "click",
    () => {
      if (isWatchPage()) scheduleSubscribeRepair();
    },
    true
  );

  function ensureLayout() {
    if (!isWatchPage()) {
      // Self-heal: if this ever runs while we're not on a watch page (e.g.
      // the observer wasn't disconnected in time for some navigation
      // path), tear down instead of silently leaving stale state behind.
      teardownLayout();
      return;
    }

    if (isTheaterMode()) {
      // Same self-heal idea — this runs on every retry/mutation pass, so
      // theater mode turning on (however that happens, not just the two
      // listened-for paths below) gets caught and torn down here too, not
      // just at the moment start() first decides whether to build at all.
      teardownLayout();
      return;
    }

    const columns = document.querySelector("#columns");
    const secondary = findBestById(
      "secondary",
      (el) =>
        el.querySelector(
          "ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-compact-playlist-renderer, ytd-item-section-renderer, ytd-watch-next-secondary-results-renderer, ytd-live-chat-frame"
        ) != null
    );
    const primary = findBestById("primary", (el) => el.querySelector("video") != null);
    if (!columns || !secondary || !primary) return;

    document.documentElement.classList.add("yt-split-active");
    document.documentElement.classList.toggle("yt-split-solo", windowRole === "main");
    document.documentElement.classList.toggle("yt-split-companion", windowRole === "companion");
    if (windowRole === "companion") silenceCompanionVideo();

    let resizer = document.getElementById("yt-split-resizer");
    if (!resizer) {
      resizer = document.createElement("div");
      resizer.id = "yt-split-resizer";
      resizer.title = "Drag to resize";
      columns.appendChild(resizer);
    }
    setupResizer(resizer, columns);

    let sidePane = document.getElementById("yt-split-side-pane");
    if (!sidePane) {
      sidePane = document.createElement("div");
      sidePane.id = "yt-split-side-pane";
      columns.appendChild(sidePane);
    }

    if (windowRole === "companion") teardownAmbient();
    else ensureAmbient(columns);

    // #below (title/channel/stats/description) moves out of the video
    // column entirely and into a small collapsible section here.
    const below = primary.querySelector("#below") || document.querySelector("#below");
    ensureDescPane(sidePane, below);

    ensurePaneHeader(secondary, hasLiveChat(secondary) ? "Live Chat" : "Recommended", {
      collapsed: secondaryCollapsed,
      onToggle: (c) => { secondaryCollapsed = c; }
    });
    moveNode(secondary, sidePane);

    // Two-window pop-up: its window is narrow, and in YouTube's narrow
    // (single-column) layout the recommendations list can be moved out of
    // #secondary into the area under the player, which would put it inside
    // our description pane. Bring it back; a no-op when it's already there.
    if (windowRole === "companion") {
      const results = document.querySelector("ytd-watch-next-secondary-results-renderer");
      const related = results && results.parentElement && results.parentElement.id === "related" ? results.parentElement : results;
      if (related && !secondary.contains(related)) {
        moveNode(related, secondary.querySelector("#secondary-inner") || secondary);
      }
    }

    let vresizer = document.getElementById("yt-split-vresizer");
    if (!vresizer) {
      vresizer = document.createElement("div");
      vresizer.id = "yt-split-vresizer";
      vresizer.title = "Drag to resize";
      sidePane.appendChild(vresizer);
    } else if (vresizer.parentElement !== sidePane) {
      sidePane.appendChild(vresizer);
    }
    setupVResizer(vresizer, sidePane);

    let commentsPane = document.getElementById("yt-split-comments-pane");
    if (!commentsPane) {
      commentsPane = document.createElement("div");
      commentsPane.id = "yt-split-comments-pane";
      sidePane.appendChild(commentsPane);
    }
    ensurePaneHeader(commentsPane, "Comments", {
      collapsed: commentsCollapsed,
      onToggle: (c) => { commentsCollapsed = c; }
    });

    // Comments are absent while a stream is live (they show up once it
    // ends / becomes a VOD) — hide the pane instead of showing it empty.
    // Same duplicate-id guard as #secondary/#primary above.
    const comments = findBestById(
      "comments",
      (el) => el.querySelector("ytd-comment-thread-renderer, ytd-comments-header-renderer") != null
    );
    if (comments) {
      commentsPane.style.display = "";
      moveNode(comments, commentsPane);
    } else {
      commentsPane.style.display = "none";
    }

    // Sweep any other direct child of #columns (anything not primary,
    // resizer, sidePane, or our fixed-position ambient light layers) into
    // the side pane so it can't end up stranded in an implicit, unstyled
    // grid cell.
    Array.from(columns.children).forEach((child) => {
      if (child === primary || child === resizer || child === sidePane) return;
      if (child.id === AMBIENT_ID || child.id === AMBIENT_GRAIN_ID) return;
      moveNode(child, sidePane);
    });

    spanFullWidth(columns);
    repairSubscribeButtons();

    // Deliberately NOT reclamping side/top width here. This function runs
    // on every MutationObserver-triggered pass — and YouTube's page mutates
    // almost continuously during playback (captions, view-count ticks,
    // chat messages, lazily-loaded thumbnails). A drag's whole point is to
    // set an explicit value for the session; reclamping it against a
    // freshly re-measured container on every single one of those mutations
    // was catching a slightly different measurement moments after the drag
    // ended (e.g. the description pane's true height not being exactly what
    // was cached mid-drag) and silently snapping the dragged size back down
    // — which is exactly the "resizer jumps back after releasing it" bug.
    // Reclamping is only actually needed when the window itself is
    // resized, which is handled separately below (the window "resize"
    // listener), not here.
  }

  // Puts the page back exactly how YouTube expects it. Runs BEFORE YouTube
  // tears the watch page down internally (on yt-navigate-start) — leaving
  // moved nodes and injected wrapper divs in place past that point
  // confused YouTube's own cleanup and broke the next page (e.g. going
  // back to the home page).
  function teardownLayout() {
    document.documentElement.classList.remove("yt-split-active", "yt-split-solo", "yt-split-companion");
    document.body.classList.remove("yt-split-resizing", "yt-split-resizing-v");
    dragState = null;
    vDragState = null;
    pendingSideWidth = null;
    pendingTopHeight = null;
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
      pendingRelevant = false;
    }

    restoreMovedNodes();
    restoreWidenedAncestors();

    const secondary = document.getElementById("secondary");
    if (secondary) {
      const header = secondary.querySelector(":scope > .yt-split-pane-header");
      if (header) header.remove();
    }

    const sidePane = document.getElementById("yt-split-side-pane");
    if (sidePane) sidePane.remove();

    const resizer = document.getElementById("yt-split-resizer");
    if (resizer) resizer.remove();

    teardownAmbient();
    // #below is back in YouTube's own layout; fix the Subscribe button
    // there too once YouTube has re-rendered it.
    scheduleSubscribeRepair();
  }

  function nudgePlayerResize() {
    // YouTube's player sizes its own control bar via JS, not just CSS. After
    // we resize its container, poke it with a resize event so it re-lays
    // out the controls to match the new size.
    //
    // This MUST be tagged and NOT a plain `new Event("resize")` — our own
    // "resize" listener below (window.addEventListener("resize", ...)) has
    // no way to tell a real window resize apart from this synthetic one,
    // and it itself calls nudgePlayerResize() again at the end of its own
    // handler. Left untagged, that was a genuine infinite feedback loop:
    // every nudge (e.g. one at the end of every drag-resize frame, or one
    // at the end of every navigation) re-triggered our own debounced resize
    // handler about every 150ms, forever, for as long as the tab stayed
    // open — which then called applySideWidth() again on its own schedule,
    // silently overwriting ANY dragged side-pane width back to the
    // ideal-video default within moments of the drag ending (this was the
    // real cause of the main divider "reverting after release", not just a
    // MutationObserver race), and kept a resize-recalculation cycle running
    // continuously in the background, which is also a plausible contributor
    // to intermittent dropped clicks/spacebar on the video. Tagging it lets
    // our own listener recognize and ignore it while YouTube's own
    // listener(s) — which only check the event TYPE, "resize" either way —
    // still react to it normally.
    window.dispatchEvent(new CustomEvent("resize", { detail: { ytSplitSynthetic: true } }));
  }

  // The split layout only makes sense on a spacious, landscape-oriented
  // window — full screen or close to it. Below this, the extension does
  // nothing at all and YouTube renders completely normally, rather than
  // maintaining a separate "stacked, narrower" variant of our own layout
  // (which is where most of the edge-case bugs came from).
  const MIN_ACTIVATION_WIDTH = 900;
  const MIN_ACTIVATION_ASPECT = 1.15;

  function meetsActivationThreshold() {
    // Two-window mode: neither the video-only main window nor the tall,
    // narrow pop-up needs room for a second column.
    if (windowRole !== "none") return true;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < MIN_ACTIVATION_WIDTH) return false;
    return w / h >= MIN_ACTIVATION_ASPECT;
  }

  // Videos aren't all 16:9 (shorts-in-a-watch-page, 4:3 archival content,
  // ultrawide, etc.), so this needs the real ratio, not an assumption.
  // Prefers the <video> element's own intrinsic dimensions
  // (videoWidth/videoHeight) — set once from the media file itself,
  // completely independent of CSS/layout, so reading them needs no DOM
  // manipulation at all. Only falls back to measuring
  // #player-container-outer's rendered box (which requires briefly
  // lifting our own max-width cap to read its true, unconstrained size)
  // if metadata hasn't loaded yet. That fallback was previously used
  // unconditionally, on every single call (this runs several times per
  // navigation, from both constrainVideoSize() and applySideWidth()) —
  // repeatedly expanding the player to its unconstrained size and back is
  // exactly the kind of thing a player's own internal ResizeObserver
  // reacts to, and is a plausible cause of click-to-play/pause becoming
  // unreliable, since ResizeObserver callbacks fire asynchronously and
  // could plausibly fire against that momentary, incorrect size rather
  // than strictly following our synchronous set→measure→restore order.
  function measureVideoAspectRatio() {
    const video = document.querySelector("#primary video");
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight;
    }

    const container = document.querySelector("#player-container-outer");
    if (!container) return ASSUMED_ASPECT;

    const prev = document.documentElement.style.getPropertyValue(VIDEO_MAX_WIDTH_VAR);
    document.documentElement.style.setProperty(VIDEO_MAX_WIDTH_VAR, "none");
    const rect = container.getBoundingClientRect();
    if (prev) {
      document.documentElement.style.setProperty(VIDEO_MAX_WIDTH_VAR, prev);
    } else {
      document.documentElement.style.removeProperty(VIDEO_MAX_WIDTH_VAR);
    }

    if (rect.width > 0 && rect.height > 0) return rect.width / rect.height;
    return ASSUMED_ASPECT;
  }

  // The side pane's width isn't an arbitrary fixed default — every fresh
  // page load or new video computes it so the video renders at its
  // largest possible size for the current window (letterboxed by height,
  // same ideal size constrainVideoSize() computes for the video itself),
  // with the side pane simply getting whatever's left over. Not persisted
  // — dragging changes it live for the current viewing session only (see
  // start(), which resets to this default on every navigation). Height
  // doesn't depend on how the columns are split (it comes from the single
  // grid row), so this isn't circular with constrainVideoSize()'s own
  // width cap.
  function applySideWidth() {
    const columns = document.querySelector("#columns");
    const primaryInner = document.querySelector("#primary-inner");
    if (!columns || !primaryInner) {
      setSideWidth(DEFAULT_SIDE_WIDTH);
      return;
    }
    const columnsRect = columns.getBoundingClientRect();
    const availableHeight = primaryInner.getBoundingClientRect().height;
    if (columnsRect.width <= 0 || availableHeight <= 0) {
      setSideWidth(DEFAULT_SIDE_WIDTH);
      return;
    }

    const ratio = measureVideoAspectRatio();
    const idealVideoWidth = availableHeight * ratio;
    // Measured, not assumed: whatever part of #columns' width isn't the
    // video column's content box or the side pane (padding + divider).
    // A fixed guess that didn't match the real CSS left the video a few px
    // narrower than its column — uneven extra space beside it. Falls back
    // to the upper bound if the layout isn't measurable yet.
    const sidePane = document.querySelector("#yt-split-side-pane");
    let overhead = LAYOUT_OVERHEAD;
    if (sidePane) {
      const measured =
        columnsRect.width - primaryInner.getBoundingClientRect().width - sidePane.getBoundingClientRect().width;
      if (measured >= 0 && measured <= LAYOUT_OVERHEAD * 2) overhead = measured;
    }
    // Deliberately NOT routed through clampSideWidth() here. That
    // function's ceiling reserves minVideoWidthFor(ratio) for the video —
    // a fixed SAFETY FLOOR meant to stop a DRAG from squeezing the video
    // narrower than safe. Reusing it here was a real bug: for a
    // narrow/portrait video, its own ideal height-filling width can be
    // SMALLER than that safety floor, and clamping against the floor in
    // that case forced the video wider than it actually needs — wasting
    // the difference as empty space around the (centered) video instead
    // of handing it to the side pane. There's no "squeeze" risk to protect
    // against here in the first place: this reserves EXACTLY what the
    // video needs to fill the available height at its own real aspect
    // ratio, by definition never less than that. (The video's absolute
    // floor is still enforced independently and unconditionally by the
    // grid's own minmax(var(--yt-split-video-min-w), 1fr) in content.css —
    // that's a structural CSS guarantee, not something this needs to
    // re-implement in JS.)
    const idealSideWidth = columnsRect.width - idealVideoWidth - overhead;
    setSideWidth(Math.max(MIN_SIDE_WIDTH, idealSideWidth));
  }

  // #below no longer shares the left column with the video (it moved into
  // the side pane), so the video can use the column's FULL height. It
  // still sizes itself from WIDTH only (see note above on not fighting the
  // player's own sizing), so this caps that width — using the video's
  // actual measured aspect ratio — at whatever value makes its
  // aspect-derived height exactly fill the available height, i.e. the
  // largest the video can be while still fitting both dimensions
  // (letterboxed/centered if its aspect ratio doesn't fill the column's
  // width too). #primary-inner's measured height already excludes
  // #primary's own padding (content.css) — that's what gives the video
  // consistent breathing room on all sides, not a separate JS-side gap.
  function constrainVideoSize() {
    if (!isWatchPage()) return;
    if (!meetsActivationThreshold()) {
      document.documentElement.style.removeProperty(VIDEO_MAX_WIDTH_VAR);
      document.documentElement.style.removeProperty(VIDEO_RATIO_VAR);
      document.documentElement.style.removeProperty(VIDEO_MIN_WIDTH_VAR);
      return;
    }
    // Set independently of the availableHeight checks below — neither var
    // depends on the column's height at all, and keeping them current is
    // what makes content.css's aspect-ratio rule and the video column's
    // own grid minimum reliably protect the video any time this runs
    // (every navigation, retry, resize, and video-ended widen), not just
    // when #primary-inner's height happens to be measurable that moment.
    const ratio = measureVideoAspectRatio();
    playerMinWidth = measurePlayerMinWidth();
    document.documentElement.style.setProperty(VIDEO_RATIO_VAR, String(ratio));
    document.documentElement.style.setProperty(VIDEO_MIN_WIDTH_VAR, minVideoWidthFor(ratio) + "px");

    const primaryInner = document.querySelector("#primary-inner");
    if (!primaryInner) return;
    const availableHeight = primaryInner.getBoundingClientRect().height;
    if (availableHeight <= 0) return;
    // No rounding — CSS handles fractional pixels natively, and flooring
    // here previously left the video up to ~1px short of exactly filling
    // its target height.
    const maxVideoWidth = availableHeight * ratio;
    document.documentElement.style.setProperty(VIDEO_MAX_WIDTH_VAR, maxVideoWidth + "px");
  }

  // Theater mode changes the video's width relative to the page in a way
  // that fights this layout, so rather than trying to make the two
  // coexist, they're mutually exclusive: theater mode being on means the
  // split steps aside entirely and YouTube renders completely normally
  // (native theater layout, untouched); theater mode being off means the
  // split runs as usual. ensureLayout()/start() check this and tear down
  // if it's on — see the click/keydown listeners near the bottom of the
  // file for how a live toggle (button click or "t") gets noticed and
  // re-evaluated without needing a full navigation.
  function isTheaterMode() {
    const flexy = document.querySelector("ytd-watch-flexy");
    return !!flexy && flexy.hasAttribute("theater");
  }

  // Whether the side pane is currently widened because the video ended
  // (see enterRecsFocusMode below). Read by the window "resize" listener so
  // a genuine window resize re-maximizes the pane for the new window size
  // instead of discarding the widened state and falling back to the
  // normal ideal-video-size default — that reset-on-resize behavior is
  // correct for the DEFAULT sizing, but not for this deliberately-widened
  // state, which should persist through a resize just like it persists
  // through everything else until playback actually resumes.
  let inRecsFocusMode = false;

  // When the video finishes, there's nothing left to watch and it's a
  // natural point to shift focus to recommendations: expand it if
  // currently collapsed, COLLAPSE comments (there's nothing new to read
  // there either, and freeing its space is what actually lets
  // recommendations grow — see the flex-grow scoped rule in content.css
  // keyed off comments being collapsed), and give the side pane a lot
  // more of the window (still respecting the video's own minimum width).
  // Reverts — just the width, not the collapse states — as soon as
  // playback resumes, since at that point the video is what matters
  // again (collapsing comments here is itself automatic, same as the
  // widen; whether to re-expand it is left to the user, or to the next
  // navigation's normal reset in start()).
  function enterRecsFocusMode() {
    inRecsFocusMode = true;
    // This is an automatic widen, not the user's own choice — clearing it
    // means a resize while in this state goes through the inRecsFocusMode
    // branch above (correct), and if playback later resumes, the width
    // still reverts to the normal default (exitRecsFocusMode(), existing
    // behavior) rather than some in-between state.
    hasManualSideWidth = false;
    const secondary = document.getElementById("secondary");
    if (secondary && secondary.classList.contains("yt-split-pane-collapsed")) {
      secondary.classList.remove("yt-split-pane-collapsed");
      secondaryCollapsed = false;
    }
    const commentsPane = document.getElementById("yt-split-comments-pane");
    if (commentsPane && !commentsPane.classList.contains("yt-split-pane-collapsed")) {
      commentsPane.classList.add("yt-split-pane-collapsed");
      commentsCollapsed = true;
    }
    const columns = document.querySelector("#columns");
    if (!columns) return;
    const rect = columns.getBoundingClientRect();
    // A plain 50/50 split, not maximized toward the video's minimum. This
    // used to push the side pane all the way to clampSideWidth's ceiling
    // (as wide as possible while the video holds its guaranteed minimum
    // width) — but that deliberately sits right at the edge of the crop-
    // prevention machinery, and per explicit instruction, after repeated
    // reports of the video still overlapping/cropping at that edge despite
    // several rounds of fixes, this backs off to a safe, simple 50/50
    // instead of continuing to chase the exact edge case. 50/50 sits
    // comfortably inside the safe range for any normal window size, so it
    // should never even approach the machinery below.
    setSideWidth(clampSideWidth(rect.width * 0.5, rect));
    // Same live-measurement safety nets as the drag path (see
    // enforceMinVideoHeight()'s and preventColumnOverlap()'s own
    // comments) — this is the OTHER place that deliberately pushes the
    // video toward its minimum, so it needs the same guarantees, not just
    // the pre-computed clamp above.
    enforceMinVideoHeight();
    preventColumnOverlap();
    // The video's column just shrank significantly — let the player know
    // so its own overlay (replay button / "up next" card) re-lays out to
    // match, instead of rendering for the old, wider size. A SINGLE,
    // IMMEDIATE nudge isn't reliable here: it fires before the browser has
    // actually applied/painted the new, narrower grid column, so the
    // player can end up measuring its OLD, wider size and resizing its own
    // internal rendering surface to match that stale reading — while the
    // CSS container is already the new, smaller size (overflow: hidden),
    // so the result is a visually CROPPED video (a slice of the frame)
    // rather than a scaled-down one. Nudge again after a real paint has
    // had a chance to happen (double requestAnimationFrame — the first
    // schedules a callback for the next paint, the second confirms that
    // paint already occurred) and once more shortly after as a safety net.
    nudgePlayerResize();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        nudgePlayerResize();
        enforceMinVideoHeight();
        preventColumnOverlap();
      });
    });
    setTimeout(() => {
      nudgePlayerResize();
      enforceMinVideoHeight();
      preventColumnOverlap();
    }, 200);
  }

  function exitRecsFocusMode() {
    // Bound to every "play" event, but only the video-ended widened state
    // needs undoing. Without this guard, simply pausing and resuming (e.g.
    // clicking the video) recomputed the default width and threw away a
    // manually dragged divider (reported).
    if (!inRecsFocusMode) return;
    inRecsFocusMode = false;
    // Just let the normal ideal-video-size default recomputation take
    // back over — no need to duplicate that logic here.
    constrainVideoSize();
    applySideWidth();
  }

  // The <video> element is a fresh one every navigation (new video, or a
  // hard refresh), so this is called from start() (once per navigation)
  // rather than ensureLayout() (which runs on every DOM mutation and
  // would risk rebinding many times against the same element — the
  // dataset flag guards that too, belt and suspenders).
  function setupVideoEndedHandling() {
    const video = document.querySelector("#primary video");
    if (!video || video.dataset.ytSplitEndedBound === "1") return;
    video.dataset.ytSplitEndedBound = "1";
    video.addEventListener("ended", enterRecsFocusMode);
    video.addEventListener("play", exitRecsFocusMode);
    // If our early sizing calls ran before the video's own intrinsic
    // dimensions were available (measureVideoAspectRatio then had to use
    // the less accurate, CSS-manipulating fallback), redo them now that
    // videoWidth/videoHeight are real — avoids sitting on a slightly-off
    // size for the rest of the session.
    video.addEventListener(
      "loadedmetadata",
      () => {
        constrainVideoSize();
        applySideWidth();
      },
      { once: true }
    );
  }

  // Coalesces bursts of MutationObserver callbacks into at most one
  // ensureLayout() pass per DEBOUNCE window, instead of running them
  // synchronously for every single mutation batch.
  // YouTube's page mutates almost continuously during playback (view-count
  // ticks, chat messages, lazily-loaded recommendation thumbnails, ad
  // markers) — running a full pass on literally every one of those is
  // sustained main-thread work for the entire viewing session, which is a
  // plausible cause of clicks/keypresses on the video occasionally getting
  // dropped or delayed (the browser has to finish whatever's running before
  // it can dispatch the next input event). Self-healing (re-attaching a
  // node YouTube's own re-render detached) doesn't need millisecond
  // precision, so batching it up to ~200ms is an easy, safe trade.
  const OBSERVER_DEBOUNCE_MS = 200;
  let observerDebounceTimer = null;
  let pendingRelevant = false;

  function scheduleObserverPass(relevant) {
    if (relevant) pendingRelevant = true;
    if (observerDebounceTimer) return;
    observerDebounceTimer = setTimeout(() => {
      observerDebounceTimer = null;
      const relevantNow = pendingRelevant;
      pendingRelevant = false;
      if (relevantNow) ensureLayout();
    }, OBSERVER_DEBOUNCE_MS);
  }

  // Bumped on every start() call, and captured by each of that call's own
  // retry timeouts below — if a NEWER start() runs before an OLDER one's
  // retries have all fired (e.g. two yt-navigate-finish events close
  // together, or the user clicking through videos quickly), the stale
  // retries now no-op instead of re-running ensureLayout()/applySideWidth()
  // against whatever page happens to be current at that later moment. This
  // was previously unguarded: EVERY start() call queued its own full set of
  // four retries with no way to cancel a still-pending set from an earlier
  // call, so overlapping navigations could leave several generations of
  // retries all firing into the same shared module state at once.
  let navGeneration = 0;

  function start() {
    const myGeneration = ++navGeneration;

    if (observer) observer.disconnect();
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
      pendingRelevant = false;
    }

    if (!isWatchPage()) return;

    // Theater mode and the split are mutually exclusive — see
    // isTheaterMode()'s comment. Tear down and stop here; the click/keydown
    // listeners near the bottom of the file re-trigger start() when the
    // user toggles theater mode back off, and ensureLayout()'s own check
    // (reached via those retries/the mutation observer while NOT in
    // theater mode) catches it turning on again without needing a
    // navigation either.
    if (isTheaterMode()) {
      teardownLayout();
      return;
    }

    // Only activate on a spacious, landscape window — see
    // meetsActivationThreshold(). Below that, tear down (or stay torn
    // down) so YouTube renders completely normally instead of a
    // "stacked, narrower" variant of our own layout.
    if (!meetsActivationThreshold()) {
      teardownLayout();
      // window.innerWidth/innerHeight can be transiently wrong on the very
      // first navigation of a cold session (e.g. read before the window has
      // finished painting its chrome) — a false negative here previously
      // had no way to recover short of an actual window "resize" event
      // (which the user isn't necessarily going to trigger), matching
      // exactly the reported symptom of the split only ever appearing after
      // a manual refresh. Re-check shortly after, same idea as the
      // ensureLayout() retries below for the "elements don't exist yet"
      // case, in case this was that kind of one-off, too-early reading.
      if (!startRetryScheduled) {
        startRetryScheduled = true;
        setTimeout(() => {
          startRetryScheduled = false;
          if (isWatchPage() && meetsActivationThreshold()) start();
        }, 500);
      }
      return;
    }

    // Explicit reset, not just "not persisted" — YouTube is a single-page
    // app, so navigating to a new video reuses the SAME document; without
    // this, whatever was dragged during the PREVIOUS video would still be
    // sitting in these CSS vars (set on <html>, which survives SPA
    // navigation) and would silently carry over. Resetting here guarantees
    // every new video starts from the video-maximizing default again.
    setTopHeight(null);
    document.documentElement.style.removeProperty(SIDE_WIDTH_VAR);
    hasManualSideWidth = false;
    // Same reasoning for the video-ended widened state: it's specific to
    // whatever video just ended, not something a freshly-navigated-to video
    // should inherit. It's normally cleared by exitRecsFocusMode() on the
    // OLD video's "play" event (autoplay-next), but a manual click to a
    // DIFFERENT video tears the old <video> element down before that can
    // ever fire — leaving this stuck true and silently redirecting this
    // brand new navigation's own applySideWidth() call below into
    // recs-focus-mode width behavior instead of the normal video-maximizing
    // default it should actually get.
    inRecsFocusMode = false;
    // Description pane: always start collapsed, same "every new
    // navigation" reset as the state above — see descExpanded's own
    // comment for why this is no longer persisted via localStorage.
    // (The two-window pop-up has the room, so it starts open there.)
    descExpanded = windowRole === "companion";
    // Recommendations/comments: always start expanded, same reset — see
    // secondaryCollapsed/commentsCollapsed's own comment above.
    secondaryCollapsed = false;
    commentsCollapsed = false;

    // Wrapped: an uncaught exception anywhere in this initial pass (a null
    // reference against some not-yet-settled part of the DOM right at SPA
    // navigation time, for instance) would previously abort start()
    // silently right there — no observer, no retries, nothing — leaving the
    // page stuck un-split until the next full navigation. The retries below
    // give this a second (and third, fourth) chance regardless.
    try {
      ensureLayout();
      constrainVideoSize();
      applySideWidth();
      setupVideoEndedHandling();
    } catch (err) {
      console.error("[YouTube Split Layout] initial layout pass failed, will retry:", err);
    }

    const root = document.querySelector("ytd-watch-flexy") || document.body;
    observer = new MutationObserver((mutations) => {
      // The video player mutates its own internals constantly throughout
      // playback (captions, ad markers, quality-menu updates) — none of
      // that has anything to do with our layout, but every single one
      // used to trigger a full ensureLayout() pass anyway, since we were
      // observing its subtree too. That's sustained, ongoing main-thread
      // work for the entire viewing session (not just at load), which is
      // a plausible cause of click-to-play/pause failing intermittently
      // throughout playback rather than just right after a video loads.
      // Skip childList mutations that happened entirely inside the
      // player; attribute mutations are already narrow (attributeFilter
      // below only matches "theater" changes) so those always pass through.
      const player = document.querySelector("#player-container-outer");
      const relevant = mutations.some(
        (m) => m.type === "attributes" || !player || !player.contains(m.target)
      );
      scheduleObserverPass(relevant);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["theater"]
    });

    // A single resize nudge, not several: YouTube's own player logic can
    // treat a resize as "a resize is happening" and briefly suppress
    // click-to-play/pause right after one (to avoid misfiring during a
    // legitimate window-resize drag) — dispatching this repeatedly across
    // the first ~1.3s of every video load was a plausible cause of
    // clicking the video to play/pause failing intermittently right after
    // a video loads.
    nudgePlayerResize();
    // Explicit ensureLayout() retries (not nudgePlayerResize — see above),
    // not just reliance on the MutationObserver above: YouTube's custom
    // elements can take noticeably longer to construct than a warm refresh
    // — if #columns/#secondary/#primary didn't exist yet when ensureLayout()
    // ran above, it silently bailed out, and nothing else was re-calling it.
    // This was why the layout sometimes only appeared after a manual
    // refresh. A FIXED schedule of a few attempts (previously
    // 300/1000/2500/5000ms) used to give up permanently after the last one
    // — fine for most navigations, but a transition into a watch page from
    // somewhere structurally very different (e.g. the home page, which has
    // to tear down its entire feed and construct the whole watch-page
    // template from scratch, rather than a video-to-video navigation that
    // reuses most of it) was reported to still consistently miss all four
    // and never recover until a hard refresh. Polling instead: keep trying
    // every 500ms until the layout actually reports itself active (checked
    // via the "yt-split-active" class, not just "did ensureLayout() run
    // without throwing"), for up to ~20s, self-cancelling the moment it
    // succeeds, the page is no longer a watch page, or a newer navigation
    // (via navGeneration) has taken over.
    const RETRY_INTERVAL_MS = 500;
    const MAX_RETRY_ATTEMPTS = 40; // ~20s

    function retryUntilActive(attempt) {
      if (myGeneration !== navGeneration) return;
      if (!isWatchPage()) return;
      if (document.documentElement.classList.contains("yt-split-active")) return;
      if (attempt > MAX_RETRY_ATTEMPTS) {
        console.warn(
          "[YouTube Split Layout] layout still hasn't activated after ~20s on",
          location.href,
          "— giving up until the next navigation."
        );
        return;
      }
      setTimeout(() => {
        if (myGeneration !== navGeneration) return;
        try {
          ensureLayout();
          constrainVideoSize();
          applySideWidth();
          setupVideoEndedHandling();
        } catch (err) {
          console.error("[YouTube Split Layout] retry layout pass failed:", err);
        }
        retryUntilActive(attempt + 1);
      }, RETRY_INTERVAL_MS);
    }

    retryUntilActive(0);
  }

  // Shorts: experimental. Docks the comments engagement panel beside the
  // player instead of as a modal overlay, when it happens to be open.
  // CSS-only (no DOM moves — Shorts' reel/swipe behavior is more fragile
  // to touch), scoped to a separate class, and a pure no-op if the
  // expected panel isn't present, so it can't break Shorts playback.
  function applyShortsClass() {
    document.documentElement.classList.toggle("yt-shorts-split-active", isShortsPage());
  }

  function onNavigateFinish() {
    start();
    applyShortsClass();
    maybeClaimMain();
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return el.isContentEditable || tag === "INPUT" || tag === "TEXTAREA";
  }

  // Theater mode is a normal, available feature now (see isTheaterMode()'s
  // comment — the split just steps aside while it's on, rather than
  // blocking it). These two listeners are how a LIVE toggle (no
  // navigation) gets noticed: bound permanently, unconditionally, not tied
  // to whether the split is currently active — a short delay lets
  // YouTube's own click/keydown handler actually flip the "theater"
  // attribute first, then start() re-evaluates against the new state
  // either way (builds the split if theater just turned off, tears down if
  // it just turned on).
  function reactToTheaterToggle() {
    setTimeout(() => {
      if (isWatchPage()) start();
    }, 50);
  }

  document.addEventListener(
    "click",
    (e) => {
      if (e.target.closest(".ytp-size-button")) reactToTheaterToggle();
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key.toLowerCase() !== "t") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      reactToTheaterToggle();
    },
    true
  );

  const CHANNEL_LINK_SELECTOR =
    'a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]';

  // Recommendation items (and comment authors) show the channel name as its
  // own link, separate from the big video-link that covers most of the
  // item — on real, unmodified YouTube, hovering/clicking it goes to the
  // channel, distinctly from the rest of the card (same idea as the
  // 3-dot-menu button having its own separate hit target). Inside our
  // layout that stopped working: clicking the channel name just opened the
  // video, exactly as if you'd clicked anywhere else on the item. That
  // means the channel link's own DOM node was still there and still
  // visually in the right place (its text is what you see and aim for),
  // but something about our container's width/positioning is putting the
  // video-link's own clickable box ON TOP of it — a stacking issue we
  // couldn't pin down to one exact CSS cause (`#secondary` here isn't at
  // its own native YouTube width, and this renderer's internal layout
  // wasn't necessarily built to be tested at ours). Rather than keep
  // guessing at the CSS, this fixes it deterministically in JS: on click,
  // check what's ACTUALLY stacked at the exact pointer position
  // (elementsFromPoint, not just e.target) — if a channel link is sitting
  // there but something else caught the click instead, honor the channel
  // link since that's unambiguously what the user was aiming at.
  document.addEventListener(
    "click",
    (e) => {
      if (!document.documentElement.classList.contains("yt-split-active")) return;
      const secondary = document.getElementById("secondary");
      const commentsPane = document.getElementById("yt-split-comments-pane");
      const inScope =
        (secondary && secondary.contains(e.target)) ||
        (commentsPane && commentsPane.contains(e.target));
      if (!inScope) return;
      // Already correctly resolved to the channel link itself — nothing to
      // fix. (Deliberately NOT bailing out for just any <a> here: in the
      // exact failure case, e.target naturally resolves to the covering
      // video-link's <a>, which is precisely the wrong link that needs
      // overriding below.)
      if (e.target.closest(CHANNEL_LINK_SELECTOR)) return;

      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      const channelLink = stack.find((el) => el.matches && el.matches(CHANNEL_LINK_SELECTOR));
      if (!channelLink) return;

      e.preventDefault();
      e.stopPropagation();
      if (windowRole === "companion") sendToBackground({ type: "navigateMain", url: channelLink.href });
      else location.assign(channelLink.href);
    },
    true
  );

  // Two-phase per SPA navigation: restore/clean up before YouTube tears the
  // old page down, then (re)apply once the new page has finished rendering
  // (a no-op if the new page isn't a watch page).
  document.addEventListener("yt-navigate-start", () => {
    if (observer) observer.disconnect();
    teardownLayout();
  });
  document.addEventListener("yt-navigate-finish", onNavigateFinish);

  // Back/forward-button navigation doesn't always fire YouTube's own
  // yt-navigate-* events the same way a link click does — defensively
  // tear down here too if we've landed off a watch page.
  window.addEventListener("popstate", () => {
    if (!isWatchPage()) {
      if (observer) observer.disconnect();
      teardownLayout();
    }
  });

  // ---- Two-window mode ----
  // Toggled from the toolbar panel (src/popup.*, stored as twoWindowMode).
  // The video stays in this tab ("main", video only) and a pop-up window
  // opens on the same video ("companion", description/recommendations/
  // comments only). src/background.js owns the pairing and relays messages.
  // A window can't show part of another window's page, so the pop-up is a
  // second, real YouTube page: its own player is hidden and kept paused,
  // and links clicked there drive the main window instead.

  function sendToBackground(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (e) {
      return Promise.resolve(null); // extension reloaded; this page is orphaned
    }
  }

  function setRole(role) {
    if (role === windowRole) return;
    windowRole = role;
    if (isWatchPage()) start();
    else teardownLayout();
  }

  // Ask to be (or stay) the main tab whenever this is a visible watch page
  // with the mode on; the background opens the pop-up or points it at this
  // tab's video. Called on every navigation, so the pop-up follows along.
  function maybeClaimMain() {
    if (!twoWindowMode || windowRole === "companion") return;
    if (!isWatchPage() || document.visibilityState !== "visible") return;
    sendToBackground({
      type: "claimMain",
      url: location.href,
      screen: { left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight },
    }).then((reply) => {
      if (reply) setRole(reply.role);
    });
  }

  // The pop-up's own player is hidden; keep it paused so it never plays
  // sound or competes with the main window. (Not muted: YouTube saves the
  // mute state as a preference, which would leak into the main window.)
  function silenceCompanionVideo() {
    const video = document.querySelector("#primary video, #movie_player video");
    if (!video) return;
    if (!video.paused) video.pause();
    if (video.dataset.ytSplitSilenced === "1") return;
    video.dataset.ytSplitSilenced = "1";
    video.addEventListener("play", () => {
      if (windowRole === "companion") video.pause();
    });
  }

  // "123", "123s", "2m10s", "1h2m3s" -> seconds; null if not a timestamp.
  function parseTimestamp(t) {
    if (!t) return null;
    if (/^\d+$/.test(t)) return Number(t);
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    if (!m || !m[0]) return null;
    return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  }

  function seekMainVideo(seconds) {
    const video = document.querySelector("#primary video, #movie_player video");
    if (!video) return;
    video.currentTime = seconds;
    video.play().catch(() => {});
  }

  // In the pop-up, YouTube links (videos, channels, playlists, search,
  // hashtags) open in the main window instead, and a timestamp for the
  // video being shown seeks the main video. Other links (external sites
  // via /redirect, modifier-clicks for new tabs) behave normally.
  const MAIN_WINDOW_LINK = /^\/(watch$|shorts\/|playlist|@|channel\/|c\/|user\/|hashtag\/|results|feed\/)/;
  document.addEventListener(
    "click",
    (e) => {
      if (windowRole !== "companion" || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest && e.target.closest("a[href]");
      if (!link) return;
      let url;
      try {
        url = new URL(link.href, location.href);
      } catch (err) {
        return;
      }
      if (!/(^|\.)youtube\.com$/.test(url.hostname) || !MAIN_WINDOW_LINK.test(url.pathname)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const seconds = parseTimestamp(url.searchParams.get("t"));
      const sameVideo = url.pathname === "/watch" && url.searchParams.get("v") === new URLSearchParams(location.search).get("v");
      if (sameVideo && seconds !== null) {
        sendToBackground({ type: "seek", seconds });
      } else {
        url.searchParams.delete("ytsplit");
        sendToBackground({ type: "navigateMain", url: url.href });
      }
    },
    true
  );

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === "role") setRole(msg.role);
      else if (msg.type === "seek" && windowRole === "main") seekMainVideo(msg.seconds);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.twoWindowMode) return;
      twoWindowMode = !!changes.twoWindowMode.newValue;
      if (twoWindowMode) maybeClaimMain();
      else if (windowRole === "main") setRole("none");
    });
  } catch (e) {
    // extension context gone; nothing to sync
  }

  // Switching to this tab (or un-minimizing its window) moves the pairing here.
  document.addEventListener("visibilitychange", maybeClaimMain);

  // Learn this tab's role and the mode. The pop-up retries briefly in case
  // its page loaded before the background finished recording the pairing.
  function hello(attempt) {
    sendToBackground({ type: "hello" }).then((reply) => {
      if (!reply) return;
      twoWindowMode = !!reply.mode;
      if (reply.role === "none" && COMPANION_HINT && twoWindowMode && attempt < 5) {
        setTimeout(() => hello(attempt + 1), 400);
        return;
      }
      setRole(reply.role);
      maybeClaimMain();
    });
  }
  hello(0);

  onNavigateFinish();

  // Re-nudge on actual window resizing too (e.g. dragging the window to a
  // different size/ratio), debounced so we don't spam it while dragging.
  // Also handles crossing the activation threshold in either direction —
  // shrinking below it tears down back to normal YouTube, growing back
  // above it (re)builds the split layout.
  let resizeDebounce;
  window.addEventListener("resize", (e) => {
    // Ignore our own synthetic nudges — see nudgePlayerResize()'s comment.
    // Without this, every nudge re-triggered this very handler, which ends
    // with its own nudgePlayerResize() call, forever.
    if (e.detail && e.detail.ytSplitSynthetic) return;
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (!isWatchPage()) return;
      scheduleSubscribeRepair();

      const isActive = document.documentElement.classList.contains("yt-split-active");
      if (!meetsActivationThreshold()) {
        if (isActive) {
          if (observer) observer.disconnect();
          teardownLayout();
        }
        return;
      }
      if (!isActive) {
        start();
        return;
      }

      nudgePlayerResize();
      if (!vDragState && Date.now() - lastVDragEndAt > DRAG_END_GRACE_MS) reclampTopHeight();
      if (!dragState && Date.now() - lastDragEndAt > DRAG_END_GRACE_MS) {
        constrainVideoSize();
        if (inRecsFocusMode) {
          // Video-ended widened state — re-maximize for the NEW window
          // size instead of falling back to the normal default, which
          // would otherwise silently discard the widened state on the
          // very next window resize.
          enterRecsFocusMode();
        } else if (hasManualSideWidth) {
          // A manual drag — re-apply the user's chosen PROPORTION for the
          // new window size, not the raw pixel value. This used to always
          // fall through to applySideWidth() unconditionally, silently
          // reverting any drag the instant the user resized their browser
          // window at all. The first fix for that kept the side pane at
          // its OLD fixed pixel width instead — which is also wrong, per
          // explicit correction: "it should rmb the ratio between each
          // columns, instead of just keeping one's width while changing
          // the rest" — a fixed pixel width means the VIDEO absorbs 100%
          // of whatever the window resize changed, silently drifting the
          // 50/50 (or whatever) split the user actually chose. Scaling by
          // manualSideWidthRatio (captured at drag-end — see
          // onDocumentMouseUp()) keeps both columns changing together,
          // proportionally.
          const columns = document.querySelector("#columns");
          if (columns) {
            const columnsRect = columns.getBoundingClientRect();
            setSideWidth(clampSideWidth(manualSideWidthRatio * columnsRect.width, columnsRect));
            enforceMinVideoHeight();
            preventColumnOverlap();
          } else {
            applySideWidth();
          }
        } else {
          applySideWidth();
        }
      }
    }, 150);
  });
})();
