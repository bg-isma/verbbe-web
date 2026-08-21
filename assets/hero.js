(function () {
  const visual = document.getElementById("hero-visual");
  const fan = visual && visual.querySelector(".cover-fan");
  if (!visual || !fan) return;

  const pointer = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };

  window.addEventListener(
    "pointermove",
    (event) => {
      const rect = visual.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    },
    { passive: true },
  );

  function tick() {
    now.x += (pointer.x - now.x) * 0.08;
    now.y += (pointer.y - now.y) * 0.08;
    const x = Math.max(-1, Math.min(1, now.x));
    const y = Math.max(-1, Math.min(1, now.y));
    fan.style.transform = "rotateY(" + x * 18 + "deg) rotateX(" + (10 - y * 8) + "deg)";
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
