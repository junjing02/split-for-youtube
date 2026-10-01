document.getElementById("year").textContent = new Date().getFullYear();

// Nav: show its bottom border only once the page has scrolled.
const nav = document.querySelector(".nav");
if (nav) {
  const updateNav = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
  updateNav();
  window.addEventListener("scroll", updateNav, { passive: true });
}

// Copy buttons (chrome://extensions can't be opened from a link). Hidden
// in the HTML and only revealed where the Clipboard API is available.
if (navigator.clipboard && window.isSecureContext) {
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = "Copied";
        btn.classList.add("is-copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("is-copied");
        }, 1600);
      } catch (e) {
        // Clipboard blocked; the URL is still right there to copy by hand.
      }
    });
  });
}

// Mockup timeline: steps through how the extension actually behaves by
// swapping state classes on #morphDemo (style.css holds every state's
// geometry; each step here is just "which classes, which caption, how
// long"). Starts when the mockup scrolls into view, pauses and resets when
// it leaves. With prefers-reduced-motion it settles on the split layout
// with no motion at all.
const morphDemo = document.getElementById("morphDemo");
if (morphDemo) {
  const caption = morphDemo.querySelector(".morph-caption");
  const lists = morphDemo.querySelectorAll(".morph-rec .morph-scroll-list, .morph-comments .morph-scroll-list");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setCaption(text) {
    if (!caption || !text || caption.textContent === text) return;
    caption.classList.add("is-changing");
    setTimeout(() => {
      caption.textContent = text;
      caption.classList.remove("is-changing");
    }, 200);
  }

  function scrollLists(toEnd) {
    lists.forEach((el) => {
      el.scrollTo({ top: toEnd ? el.scrollHeight - el.clientHeight : 0, behavior: "smooth" });
    });
  }

  if (reduceMotion) {
    morphDemo.classList.add("is-after");
    if (caption) caption.textContent = "With Split for YouTube";
  } else if ("IntersectionObserver" in window) {
    const STATES = [
      "is-scrolled",
      "is-after",
      "is-dragged",
      "comments-collapsed",
      "cursor-divider",
      "cursor-comments",
      "cursor-collapsed",
      "cursor-press",
    ];
    const SPLIT = "With Split for YouTube";
    const SCROLL = "Scroll freely — the video stays put";
    const DRAG = "Drag the divider to resize";
    const COLLAPSE = "Collapse what you don't need";
    // cls: the complete set of state classes for the step. hold: ms before
    // the next step. Pane/cursor moves take 0.85s (style.css), so holds
    // that follow a move are longer than that.
    const STEPS = [
      { cls: [], caption: "Regular YouTube", hold: 1800, enter: () => scrollLists(false) },
      { cls: ["is-scrolled"], caption: "Scroll down — the video scrolls away", hold: 2100 },
      { cls: ["is-after"], caption: SPLIT, hold: 2000 },
      { cls: ["is-after"], caption: SCROLL, hold: 1800, enter: () => scrollLists(true) },
      { cls: ["is-after"], caption: SCROLL, hold: 1500, enter: () => scrollLists(false) },
      { cls: ["is-after", "cursor-divider"], caption: DRAG, hold: 1000 },
      { cls: ["is-after", "cursor-divider", "is-dragged"], caption: DRAG, hold: 1500 },
      { cls: ["is-after", "cursor-divider"], caption: DRAG, hold: 1300 },
      { cls: ["is-after", "cursor-comments"], caption: COLLAPSE, hold: 1000 },
      { cls: ["is-after", "cursor-comments", "cursor-press"], caption: COLLAPSE, hold: 160 },
      { cls: ["is-after", "cursor-comments", "comments-collapsed"], caption: COLLAPSE, hold: 1600 },
      { cls: ["is-after", "cursor-collapsed", "comments-collapsed"], caption: COLLAPSE, hold: 1000 },
      { cls: ["is-after", "cursor-collapsed", "comments-collapsed", "cursor-press"], caption: COLLAPSE, hold: 160 },
      { cls: ["is-after", "cursor-collapsed"], caption: COLLAPSE, hold: 1400 },
      { cls: ["is-after"], caption: SPLIT, hold: 1200 },
    ];

    let timer = null;
    let index = 0;

    function applyStep(i) {
      const step = STEPS[i];
      morphDemo.classList.remove(...STATES);
      morphDemo.classList.add(...step.cls);
      setCaption(step.caption);
      if (step.enter) step.enter();
      timer = setTimeout(() => {
        index = (index + 1) % STEPS.length;
        applyStep(index);
      }, step.hold);
    }

    function reset() {
      clearTimeout(timer);
      timer = null;
      index = 0;
      morphDemo.classList.remove(...STATES);
      scrollLists(false);
      setCaption(STEPS[0].caption);
    }

    const morphObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && timer === null) {
            timer = setTimeout(() => applyStep(0), 1000);
          } else if (!entry.isIntersecting && timer !== null) {
            reset();
          }
        });
      },
      { threshold: 0.4 }
    );
    morphObserver.observe(morphDemo);
  }
}

// Two-window demo: starts as one window in the normal split; the cursor
// opens the extension's toolbar panel and flips "Two windows"; the main
// window shrinks to video only as a second window slides in with the
// panes; then the cursor clicks a recommendation (both windows switch
// videos) and a timestamp (the main video jumps); then it loops. State
// classes on #twDemo carry the visuals (style.css); the cursor is placed by
// measuring the real target elements, so it lands on them at any size.
// Runs only while on screen; with prefers-reduced-motion it shows the
// two-window state as a still frame.
const twDemo = document.getElementById("twDemo");
if (twDemo) {
  const stage = twDemo.querySelector(".tw-stage");
  const cursor = twDemo.querySelector(".tw-cursor");
  const caption = twDemo.querySelector(".tw-caption");
  const STATES = [
    "tw-two",
    "tw-cursor-on",
    "tw-press",
    "tw-panel-open",
    "tw-toggled",
    "tw-press-rec",
    "tw-press-ts",
    "tw-reloading",
    "tw-switched",
    "tw-seeked",
  ];
  const ONE = "One window: the normal split";
  const TOGGLE = "Switch on Two windows from the toolbar";
  const TWO = "Video here, comments there";
  const SWITCH = "Click a video in the second window";
  const SEEK = "Click a timestamp to jump";

  function swapCaption(text) {
    if (!caption || !text || caption.textContent === text) return;
    caption.classList.add("is-changing");
    setTimeout(() => {
      caption.textContent = text;
      caption.classList.remove("is-changing");
    }, 200);
  }

  // Cursor hotspot onto an element, a little in from its left edge.
  function pointAt(selector, xFraction = 0.3) {
    const el = twDemo.querySelector(selector);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    cursor.style.left = `${r.left - s.left + Math.min(r.width * xFraction, 40)}px`;
    cursor.style.top = `${r.top - s.top + r.height * 0.5}px`;
  }

  // Off the bottom right corner, out of sight.
  function park() {
    cursor.style.left = "90%";
    cursor.style.top = "104%";
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    twDemo.classList.add("tw-two");
    if (caption) caption.textContent = TWO;
  } else if ("IntersectionObserver" in window) {
    const ON = ["tw-two"];
    const STEPS = [
      { cls: [], caption: ONE, hold: 2200, enter: park },
      { cls: ["tw-cursor-on"], caption: TOGGLE, hold: 1000, enter: () => pointAt(".tw-ext-icon", 0.5) },
      { cls: ["tw-cursor-on", "tw-press"], caption: TOGGLE, hold: 160 },
      { cls: ["tw-cursor-on", "tw-panel-open"], caption: TOGGLE, hold: 800, enter: () => pointAt(".tw-switch", 0.5) },
      { cls: ["tw-cursor-on", "tw-panel-open", "tw-press"], caption: TOGGLE, hold: 160 },
      { cls: ["tw-cursor-on", "tw-panel-open", "tw-toggled"], caption: TOGGLE, hold: 600 },
      { cls: ON, caption: TWO, hold: 2600, enter: park },
      { cls: [...ON, "tw-cursor-on"], caption: SWITCH, hold: 1000, enter: () => pointAt(".tw-list-a .tw-target-rec .stack-lines") },
      { cls: [...ON, "tw-cursor-on", "tw-press", "tw-press-rec"], caption: SWITCH, hold: 180 },
      { cls: [...ON, "tw-cursor-on", "tw-reloading", "tw-switched"], caption: "Both windows switch together", hold: 350 },
      { cls: [...ON, "tw-cursor-on", "tw-switched"], hold: 1900 },
      { cls: [...ON, "tw-cursor-on", "tw-switched"], caption: SEEK, hold: 1000, enter: () => pointAt(".tw-ts") },
      { cls: [...ON, "tw-cursor-on", "tw-switched", "tw-press", "tw-press-ts"], caption: SEEK, hold: 180 },
      { cls: [...ON, "tw-cursor-on", "tw-switched", "tw-seeked"], caption: "The video jumps to that moment", hold: 2000 },
      { cls: [...ON, "tw-switched", "tw-seeked"], hold: 1000, enter: park },
    ];

    let twTimer = null;
    let twIndex = 0;

    function twStep(i) {
      const step = STEPS[i];
      twDemo.classList.remove(...STATES);
      twDemo.classList.add(...step.cls);
      swapCaption(step.caption);
      if (step.enter) step.enter();
      twTimer = setTimeout(() => {
        twIndex = (twIndex + 1) % STEPS.length;
        twStep(twIndex);
      }, step.hold);
    }

    new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && twTimer === null) {
            twTimer = setTimeout(() => twStep(0), 600);
          } else if (!entry.isIntersecting && twTimer !== null) {
            clearTimeout(twTimer);
            twTimer = null;
            twIndex = 0;
            twDemo.classList.remove(...STATES);
            park();
            swapCaption(ONE);
          }
        });
      },
      { threshold: 0.4 }
    ).observe(twDemo);
  }
}
