(function () {
  const storageKey = "verbbe.lang";

  function currentLang() {
    return document.documentElement.dataset.lang === "es" ? "es" : "en";
  }

  function setLang(lang) {
    const next = lang === "es" ? "es" : "en";
    document.documentElement.lang = next;
    document.documentElement.dataset.lang = next;
    try {
      localStorage.setItem(storageKey, next);
    } catch (_) {
      /* ignore private mode */
    }
    document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.langBtn === next ? "true" : "false");
    });
    document.querySelectorAll('a[href$=".html"], a[href*=".html?"]').forEach((anchor) => {
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        url.searchParams.set("lang", next);
        const relative = url.pathname.split("/").pop() || "index.html";
        anchor.setAttribute("href", relative + url.search + url.hash);
      } catch (_) {
        /* ignore */
      }
    });
  }

  setLang(currentLang());

  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    btn.addEventListener("click", () => setLang(btn.dataset.langBtn));
  });
})();
