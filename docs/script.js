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

// Before/after mockup: auto-loops between the two states once it scrolls
// into view, showing panes slide/resize into their new positions (see the
// long comment on .morph-demo in style.css for why this is built as plain
// left/top/width/height percentage transitions rather than anything
// resembling the earlier drag-slider). Respects prefers-reduced-motion by
// just settling on the "after" state (the more informative one) with no
// animation at all, rather than looping motion those visitors asked to
// avoid.
const morphDemo = document.getElementById("morphDemo");
if (morphDemo) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    morphDemo.classList.add("is-after");
  } else if ("IntersectionObserver" in window) {
    let loopTimer = null;
    function loop() {
      const goingToAfter = !morphDemo.classList.contains("is-after");
      morphDemo.classList.toggle("is-after", goingToAfter);
      loopTimer = setTimeout(loop, goingToAfter ? 3200 : 2400);
    }
    const morphObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && loopTimer === null) {
            loopTimer = setTimeout(loop, 1600);
          } else if (!entry.isIntersecting && loopTimer !== null) {
            clearTimeout(loopTimer);
            loopTimer = null;
          }
        });
      },
      { threshold: 0.4 }
    );
    morphObserver.observe(morphDemo);
  }
}
