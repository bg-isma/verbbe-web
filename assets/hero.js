(function () {
  const albums = {
    ventanas: { title: "Luz de medianoche", artist: "Nilo Marés", album: "Ventanas al mar" },
    porche: { title: "Carta a casa", artist: "Vera Solís", album: "Porche de verano" },
    estatica: { title: "Frecuencia verde", artist: "Onda Norte", album: "Sal y estática" },
    faros: { title: "Marea baja", artist: "Río Calder", album: "Faros bajos" },
    papel: { title: "Linterna de papel", artist: "Lina Voss", album: "Papel de arroz" },
  };

  const deck = document.querySelector("[data-deck]");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
  });

  if (!deck) return;

  const crate = deck.querySelector("[data-crate]");
  let current = "estatica";

  if (!crate) return;

  function settleFan() {
    crate.querySelectorAll(".fan-card").forEach((btn) => btn.classList.add("is-set"));
  }

  if (reduce) settleFan();
  else window.setTimeout(settleFan, 1600);

  function render(id) {
    current = albums[id] ? id : "estatica";
    crate.querySelectorAll("[data-album]").forEach((btn) => {
      const on = btn.dataset.album === current;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.style.zIndex = on ? "9" : "";
    });
    const url = new URL(location.href);
    url.searchParams.set("album", current);
    history.replaceState(null, "", url);
  }

  crate.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-album]");
    if (!btn) return;
    render(btn.dataset.album);
  });

  crate.addEventListener("keydown", (event) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = [...crate.querySelectorAll("[data-album]")];
    const index = buttons.findIndex((btn) => btn.dataset.album === current);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    event.preventDefault();
    buttons[next].focus();
    render(buttons[next].dataset.album);
  });

  const preset = new URLSearchParams(location.search).get("album");
  render(preset && albums[preset] ? preset : "estatica");
})();
