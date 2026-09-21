document.getElementById("year").textContent = new Date().getFullYear();

// Cursor-follow spotlight on feature cards. --mx/--my drive the
// radial-gradient position in style.css's .feature-card::after — with no
// JS (or before the first mousemove), those custom properties are simply
// unset and the CSS falls back to the card's own center, so there's no
// broken/half-lit state to worry about if this never runs.
document.querySelectorAll(".feature-card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mx", e.clientX - rect.left + "px");
    card.style.setProperty("--my", e.clientY - rect.top + "px");
  });
});

// Scroll-reveal: fade/rise elements in as they enter the viewport. The
// "reveal" (hidden-until-shown) class is added HERE, by script, rather
// than being present in the HTML/CSS by default — so a visitor with JS
// disabled (or a crawler, or this script failing for any reason) just
// sees every section fully visible immediately, never a page stuck
// invisible. IntersectionObserver only ever ADDS "is-visible"; once
// added it's never removed, so this can't flicker on scroll-back-up.
const revealTargets = document.querySelectorAll(".feature-card, .steps");
if ("IntersectionObserver" in window) {
  revealTargets.forEach((el) => el.classList.add("reveal"));
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  revealTargets.forEach((el) => observer.observe(el));
}

// Before/scrolled/after mockup: auto-loops through three phases once it
// scrolls into view, showing panes slide/resize into their new positions
// (see the long comment on .morph-demo in style.css for why this is built
// as plain left/top/width/height percentage transitions rather than
// anything resembling the earlier drag-slider). The middle "scrolled"
// phase demonstrates the actual problem this extension solves — on real
// YouTube, scrolling down to reach recommendations/comments scrolls the
// video itself off-screen — rather than just asserting it in copy.
// Respects prefers-reduced-motion by settling directly on the "after"
// state (the most informative one, and the one with no motion left to
// object to) with no animation or loop at all.
const morphDemo = document.getElementById("morphDemo");
if (morphDemo) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    morphDemo.classList.add("is-after");
  } else if ("IntersectionObserver" in window) {
    let loopTimer = null;
    // classes: what .morph-demo should have during this phase (besides
    // none, which is the plain "before" state). hold: how long to stay on
    // this phase before advancing to the next one — "after" holds much
    // longer than the others specifically to leave room for the pane
    // auto-scroll cycle below to actually play out.
    const PHASES = [
      { classes: [], hold: 1400 },
      { classes: ["is-scrolled"], hold: 1500 },
      { classes: ["is-after"], hold: 6200 },
    ];

    // Recommended/Comments auto-scroll: once the "after" state's panes
    // have (mostly) finished resizing, scroll each .morph-scroll-list to
    // its bottom and back, demonstrating that these panes scroll
    // independently while the video stays put — the actual point of the
    // whole demo, worth showing directly rather than leaving the panes
    // static once split. Plain scrollTop + scroll-behavior:smooth (CSS)
    // rather than a CSS keyframe animation, since the scrollable distance
    // depends on real content height vs. the pane's rendered size —
    // something only the browser's own layout can measure, not a
    // percentage guessed up front.
    let scrollCancels = [];
    function stopPaneAutoScroll() {
      scrollCancels.forEach((cancel) => cancel());
      scrollCancels = [];
      document.querySelectorAll(".morph-scroll-list").forEach((el) => {
        el.scrollTop = 0;
      });
    }
    function startPaneAutoScroll(el) {
      let cancelled = false;
      function cycle() {
        if (cancelled) return;
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 0) {
          return; // nothing to scroll — every row already fits
        }
        el.scrollTo({ top: max, behavior: "smooth" });
        setTimeout(() => {
          if (cancelled) return;
          el.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(() => {
            if (!cancelled) cycle();
          }, 1900);
        }, 1900);
      }
      cycle();
      return () => {
        cancelled = true;
      };
    }

    let phaseIndex = 0;
    function applyPhase(i) {
      morphDemo.classList.remove("is-scrolled", "is-after");
      stopPaneAutoScroll();
      PHASES[i].classes.forEach((c) => morphDemo.classList.add(c));
      if (PHASES[i].classes.includes("is-after")) {
        // Waits out the panes' own 0.85s resize transition (see
        // .morph-pane in style.css) so scrolling only starts once each
        // pane is actually at its final "after" size.
        setTimeout(() => {
          if (!morphDemo.classList.contains("is-after")) return;
          document.querySelectorAll(".morph-rec .morph-scroll-list, .morph-comments .morph-scroll-list").forEach((el) => {
            scrollCancels.push(startPaneAutoScroll(el));
          });
        }, 900);
      }
      loopTimer = setTimeout(() => {
        phaseIndex = (phaseIndex + 1) % PHASES.length;
        applyPhase(phaseIndex);
      }, PHASES[i].hold);
    }
    const morphObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && loopTimer === null) {
            loopTimer = setTimeout(() => applyPhase(0), 1600);
          } else if (!entry.isIntersecting && loopTimer !== null) {
            clearTimeout(loopTimer);
            loopTimer = null;
            stopPaneAutoScroll();
          }
        });
      },
      { threshold: 0.4 }
    );
    morphObserver.observe(morphDemo);
  }
}
