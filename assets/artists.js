(function () {
  const FALLBACK_FORM =
    "https://docs.google.com/forms/d/e/1FAIpQLSfGwg5DFVhOQMZO1pNtcIV09MbeE12C663SO8bZIcOpp4iYbA/viewform";
  const FORM_ARTIST_ENTRY = "entry.381858076";
  const PAGE_SIZE = 12;

  const grid = document.getElementById("artist-grid");
  const empty = document.getElementById("artist-empty");
  const stats = document.getElementById("artist-stats");
  const search = document.getElementById("artist-search");
  const moreWrap = document.getElementById("artist-more");
  const moreBtn = document.getElementById("artist-more-btn");
  const formLink = document.getElementById("artist-form-link");
  const filterButtons = document.querySelectorAll("[data-filter]");

  let catalog = [];
  let formURL = FALLBACK_FORM;
  let filter = "all";
  let visibleCount = PAGE_SIZE;

  function lang() {
    return document.documentElement.dataset.lang === "en" ? "en" : "es";
  }

  function fold(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function httpsURL(raw) {
    try {
      const url = new URL((raw || "").trim());
      if (url.protocol !== "https:") return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function displayName(entry) {
    return (entry.names && entry.names[0]) || "";
  }

  function typeLabel(type) {
    if (lang() === "en") {
      if (type === "store") return "Store";
      if (type === "merch") return "Merch";
      return "Site";
    }
    if (type === "store") return "Tienda";
    if (type === "merch") return "Merch";
    return "Web";
  }

  function liveLinks(entry) {
    return (entry.links || []).filter((link) => httpsURL(link.url));
  }

  function compareNames(a, b) {
    return displayName(a).localeCompare(displayName(b), lang() === "en" ? "en" : "es", {
      sensitivity: "base",
    });
  }

  function submitURL(artist) {
    const url = new URL(formURL || FALLBACK_FORM);
    const name = (artist || "").trim();
    if (name) url.searchParams.set(FORM_ARTIST_ENTRY, name);
    return url.href;
  }

  function bindFormLink(anchor, artist) {
    if (!anchor) return;
    anchor.href = submitURL(artist);
    anchor.rel = "noopener noreferrer";
    anchor.target = "_blank";
  }

  function renderStats(shown, matching, withLinks) {
    const total = catalog.length;
    if (lang() === "en") {
      stats.textContent = `${withLinks} with a link · ${shown} of ${matching} shown · ${total} in the list`;
    } else {
      stats.textContent = `${withLinks} con enlace · ${shown} de ${matching} visibles · ${total} en la lista`;
    }
  }

  function filteredRows(query) {
    const q = fold(query);
    return catalog
      .filter((entry) => {
        const links = liveLinks(entry);
        const matches = !q || (entry.names || []).some((name) => fold(name).includes(q));
        if (!matches) return false;
        if (filter === "links" && links.length === 0) return false;
        return true;
      })
      .sort((a, b) => {
        const aLinks = liveLinks(a).length > 0 ? 0 : 1;
        const bLinks = liveLinks(b).length > 0 ? 0 : 1;
        if (aLinks !== bLinks) return aLinks - bLinks;
        return compareNames(a, b);
      });
  }

  function cardFor(entry) {
    const links = liveLinks(entry);
    const card = document.createElement("article");
    card.className = "artist-card" + (links.length ? " has-links" : "");
    const title = document.createElement("h3");
    title.textContent = displayName(entry);
    card.appendChild(title);

    if (links.length === 0) {
      const none = document.createElement("p");
      none.className = "artist-none";
      none.textContent = lang() === "en" ? "No verified store yet" : "Aún sin tienda verificada";
      card.appendChild(none);
      const send = document.createElement("a");
      send.className = "artist-chip is-submit";
      send.textContent = lang() === "en" ? "Submit a link" : "Enviar enlace";
      bindFormLink(send, displayName(entry));
      card.appendChild(send);
    } else {
      const list = document.createElement("div");
      list.className = "artist-chips";
      links.forEach((link) => {
        const url = httpsURL(link.url);
        if (!url) return;
        const a = document.createElement("a");
        a.className = "artist-chip";
        a.href = url;
        a.rel = "noopener noreferrer";
        a.target = "_blank";
        a.textContent = link.label || typeLabel(link.type);
        list.appendChild(a);
      });
      card.appendChild(list);
    }
    return card;
  }

  function render(query) {
    const rows = filteredRows(query);
    const shown = rows.slice(0, visibleCount);
    const fragment = document.createDocumentFragment();
    shown.forEach((entry) => fragment.appendChild(cardFor(entry)));
    grid.replaceChildren(fragment);

    empty.hidden = rows.length > 0;
    if (moreWrap) moreWrap.hidden = shown.length >= rows.length;
    renderStats(
      shown.length,
      rows.length,
      catalog.filter((entry) => liveLinks(entry).length > 0).length
    );
  }

  function setPlaceholder() {
    if (!search) return;
    search.placeholder = lang() === "en" ? search.dataset.placeholderEn : search.dataset.placeholderEs;
  }

  function applyFilter(next) {
    filter = next === "links" ? "links" : "all";
    visibleCount = PAGE_SIZE;
    filterButtons.forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.filter === filter ? "true" : "false");
    });
    render(search ? search.value : "");
  }

  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPlaceholder();
      render(search ? search.value : "");
    });
  });

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => applyFilter(btn.dataset.filter));
  });

  if (search) {
    setPlaceholder();
    search.addEventListener("input", () => {
      visibleCount = PAGE_SIZE;
      render(search.value);
    });
  }

  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      render(search ? search.value : "");
    });
  }

  const params = new URLSearchParams(location.search);
  const preset = params.get("artist") || "";
  if (preset && search) search.value = preset;
  bindFormLink(formLink, preset);

  function useCatalog(data) {
    catalog = Array.isArray(data && data.artists) ? data.artists : [];
    const nextForm = httpsURL(data && data.formURL);
    formURL = nextForm || FALLBACK_FORM;
    bindFormLink(formLink, preset);
    render(search ? search.value : "");
  }

  function embeddedCatalog() {
    const data = window.VERBbeArtistsCatalog;
    return data && Array.isArray(data.artists) ? data : null;
  }

  const embedded = embeddedCatalog();
  if (embedded) useCatalog(embedded);

  fetch("artists.json", { cache: "no-cache" })
    .then((res) => {
      if (!res.ok) throw new Error("artists.json");
      return res.json();
    })
    .then((data) => useCatalog(data))
    .catch(() => {
      if (embedded) return;
      catalog = [];
      render("");
      stats.textContent = lang() === "en" ? "Couldn’t load the list." : "No se pudo cargar la lista.";
    });
})();

(function () {
  const stage = document.querySelector("[data-sale]");
  const buy = document.querySelector("[data-sale-buy]");
  if (!stage || !buy) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function pay() {
    stage.classList.remove("is-paid");
    void stage.offsetWidth;
    stage.classList.add("is-paid");
  }

  buy.addEventListener("click", pay);
  if (!reduce) {
    stage.addEventListener("pointerenter", () => stage.classList.add("is-hot"));
    stage.addEventListener("pointerleave", () => {
      if (!stage.matches(":focus-within")) stage.classList.remove("is-hot");
    });
  }
})();
