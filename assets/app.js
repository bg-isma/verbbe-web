(function () {
  const storageKey = "verbbe.lang";

  function pageLang() {
    const lang = (document.documentElement.lang || "es").toLowerCase();
    return lang.indexOf("en") === 0 ? "en" : "es";
  }

  function siblingPath(targetLang) {
    const path = location.pathname || "/";
    const swapped = path.replace(/^\/(es|en)(?=\/|$)/, "/" + targetLang);
    if (swapped !== path) return swapped + location.search + location.hash;
    // Fallback: home of target locale
    return "/" + targetLang + "/" + location.hash;
  }

  // Persist current locale for the root chooser
  try {
    localStorage.setItem(storageKey, pageLang());
  } catch (_) {
    /* ignore */
  }

  document.querySelectorAll("a[hreflang], a[data-lang-link]").forEach((link) => {
    const target = link.getAttribute("hreflang") || link.getAttribute("data-lang-link");
    if (target !== "es" && target !== "en") return;
    link.addEventListener("click", (event) => {
      // Prefer same page sibling when href already points at the other tree
      try {
        localStorage.setItem(storageKey, target);
      } catch (_) {
        /* ignore */
      }
      const href = link.getAttribute("href") || "";
      if (!href || href === "#") {
        event.preventDefault();
        location.assign(siblingPath(target));
      }
    });
  });

  // Mark pressed state on language controls
  const current = pageLang();
  document.querySelectorAll(".lang-switch a[hreflang]").forEach((link) => {
    const on = link.getAttribute("hreflang") === current;
    link.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
})();
