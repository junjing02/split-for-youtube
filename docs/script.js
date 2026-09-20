document.getElementById("year").textContent = new Date().getFullYear();

// Before/after comparison slider. Position is applied directly as inline
// styles (clip-path on the "after" panel, left on the handle) every drag
// move / animation frame — see style.css's comment on the .compare-stage
// rule for why this doesn't use a CSS custom property + transition instead
// (a real, reproducible Chromium repaint bug with that approach).
(function () {
  const stage = document.getElementById("compareStage");
  const panelAfter = document.getElementById("panelAfter");
  const handle = document.getElementById("compareHandle");
  if (!stage || !panelAfter || !handle) return;

  function applyPos(percent) {
    const clamped = Math.min(96, Math.max(4, percent));
    panelAfter.style.clipPath = `inset(0 ${100 - clamped}% 0 0)`;
    handle.style.left = clamped + "%";
  }

  function percentFromClientX(clientX) {
    const rect = stage.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  let dragging = false;
  let introRaf = null;

  function cancelIntro() {
    if (introRaf != null) {
      cancelAnimationFrame(introRaf);
      introRaf = null;
    }
  }

  function onPointerDown(e) {
    cancelIntro();
    dragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    applyPos(percentFromClientX(clientX));
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    applyPos(percentFromClientX(clientX));
  }

  function onPointerUp() {
    dragging = false;
  }

  stage.addEventListener("mousedown", onPointerDown);
  stage.addEventListener("touchstart", onPointerDown, { passive: true });
  document.addEventListener("mousemove", onPointerMove);
  document.addEventListener("touchmove", onPointerMove, { passive: true });
  document.addEventListener("mouseup", onPointerUp);
  document.addEventListener("touchend", onPointerUp);

  // Eases from `from` to `to` over `durationMs`, calling applyPos every
  // frame — a plain rAF tween instead of a CSS transition, so it can be
  // cancelled instantly and cleanly (cancelIntro) the moment a real drag
  // starts, with no risk of an old animation still owning the value.
  function tween(from, to, durationMs, onDone) {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      applyPos(from + (to - from) * eased);
      if (t < 1) {
        introRaf = requestAnimationFrame(step);
      } else if (onDone) {
        onDone();
      }
    }
    introRaf = requestAnimationFrame(step);
  }

  // A one-time auto sweep (before -> after -> resting point) the first time
  // the demo scrolls into view, so visitors who never touch it still see
  // both states.
  let hasPlayed = false;
  function playIntro() {
    if (hasPlayed) return;
    hasPlayed = true;
    applyPos(12);
    setTimeout(() => {
      tween(12, 88, 900, () => {
        setTimeout(() => tween(88, 50, 900), 500);
      });
    }, 400);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) playIntro();
    },
    { threshold: 0.5 }
  );
  observer.observe(stage);
})();
