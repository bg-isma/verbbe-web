(function () {
  document.documentElement.classList.add("js");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const overlay = document.querySelector("[data-menu]");
  const navToggle = document.querySelector("[data-nav-toggle]");

  function defaultOs() {
    return /Mac/i.test(navigator.platform || "") ? "mac" : /Win/i.test(navigator.platform || "") ? "win" : "linux";
  }

  function musicPath(osName) {
    return osName === "win" ? "%USERPROFILE%\\Music" : "~/Music";
  }

  function dataPath(osName) {
    return osName === "win" ? "%USERPROFILE%\\.verbbe" : "~/.verbbe";
  }

  function bin(method) {
    return method === "cli" ? "npx verbbe" : "verbbe";
  }

  function installCommand(method, os) {
    const path = musicPath(os);
    if (method === "install" && os !== "win") {
      return `curl -fsSL https://verbbe.com/install.sh | bash\nverbbe start --music ${path}`;
    }
    if (method === "docker") {
      if (os === "win") {
        return `git clone https://github.com/bg-isma/verbbe.git\ncd verbbe\\server\nset MUSIC_LOCATION=${path}\nset VERBBE_MUSIC=${path}\nset DB_PASSWORD=changeme\ndocker compose up --build`;
      }
      return `git clone https://github.com/bg-isma/verbbe.git\ncd verbbe/server\nDB_PASSWORD=$(openssl rand -hex 24) MUSIC_LOCATION=${path} VERBBE_MUSIC=${path} docker compose up --build`;
    }
    return `npx verbbe start --music ${path}`;
  }

  function installOutput(os) {
    const path = musicPath(os);
    const data = dataPath(os);
    return [
      `<span class="c-dim">music   ${path}</span>`,
      `<span class="c-dim">data    ${data}</span>`,
      `<span class="c-dim">stack   postgres · redis · api · worker</span>`,
      `<span class="c-dim">mode    lan</span>`,
      '<span class="term-line"><span class="c-dim">Local</span><span class="term-url">http://127.0.0.1:4747</span></span>',
      '<span class="term-line"><span class="c-dim">Home</span><span class="term-url">http://192.168.1.42:4747</span></span>',
    ].join("");
  }

  function removeCommand(method, os, action) {
    if (method === "docker") {
      const cd = os === "win" ? "cd verbbe\\server" : "cd verbbe/server";
      if (action === "stop") return `${cd}\ndocker compose stop`;
      if (action === "keep") return `${cd}\ndocker compose down`;
      return os === "win" ? `${cd}\ndocker compose down -v\nrmdir /s /q data` : `${cd}\ndocker compose down -v\nrm -rf data`;
    }
    const tool = bin(method);
    if (action === "stop") return `${tool} stop`;
    if (action === "keep") return `${tool} uninstall --keep-data`;
    return `${tool} uninstall`;
  }

  function removeOutput(os, action) {
    const data = dataPath(os);
    if (action === "stop") {
      return [
        '<span class="c-dim">stopped</span>',
        `<span class="c-dim">data    ${data} still there</span>`,
        '<span class="term-line"><span class="term-url c-lime">Music files on disk were not touched</span></span>',
      ].join("");
    }
    if (action === "keep") {
      return [
        '<span class="c-dim">uninstalled</span>',
        `<span class="c-dim">catalog kept in ${data}</span>`,
        '<span class="term-line"><span class="term-url c-lime">Music files on disk were not touched</span></span>',
      ].join("");
    }
    return [
      '<span class="c-dim">uninstalled</span>',
      `<span class="c-dim">catalog removed from ${data}</span>`,
      '<span class="term-line"><span class="term-url c-lime">Music files on disk were not touched</span></span>',
    ].join("");
  }

  function bindTerminal(root) {
    const kind = root.getAttribute("data-terminal") || "install";
    const commandEl = root.querySelector("[data-command]");
    const outputEl = root.querySelector("[data-output]");
    const copyBtn = root.querySelector("[data-copy]");
    let method = "install";
    let os = defaultOs();
    let action = "uninstall";

    function commandText() {
      return kind === "remove" ? removeCommand(method, os, action) : installCommand(method, os);
    }

    function render() {
      if (commandEl) {
        commandEl.textContent = commandText()
          .split("\n")
          .map((line) => `$ ${line}`)
          .join("\n");
      }
      if (outputEl) {
        outputEl.innerHTML = kind === "remove" ? removeOutput(os, action) : installOutput(os);
      }
      root.querySelectorAll("[data-os]").forEach((btn) => {
        btn.setAttribute("aria-selected", btn.dataset.os === os ? "true" : "false");
      });
    }

    root.addEventListener("click", (event) => {
      const methodBtn = event.target.closest("[data-method]");
      const osBtn = event.target.closest("[data-os]");
      const actionBtn = event.target.closest("[data-action]");
      if (methodBtn && root.contains(methodBtn)) {
        method = methodBtn.dataset.method;
        root.querySelectorAll("[data-method]").forEach((btn) => {
          btn.setAttribute("aria-selected", btn === methodBtn ? "true" : "false");
        });
        render();
      }
      if (osBtn && root.contains(osBtn)) {
        os = osBtn.dataset.os;
        render();
      }
      if (actionBtn && root.contains(actionBtn)) {
        action = actionBtn.dataset.action;
        root.querySelectorAll("[data-action]").forEach((btn) => {
          btn.setAttribute("aria-selected", btn === actionBtn ? "true" : "false");
        });
        render();
      }
    });

    if (copyBtn && commandEl) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(commandText());
          copyBtn.classList.add("is-done");
          const es = copyBtn.querySelector(".lang-es");
          const en = copyBtn.querySelector(".lang-en");
          if (es) es.textContent = "Copiado";
          if (en) en.textContent = "Copied";
          setTimeout(() => {
            copyBtn.classList.remove("is-done");
            if (es) es.textContent = "Copiar";
            if (en) en.textContent = "Copy";
          }, 1400);
        } catch (_) {}
      });
    }

    if (kind === "install") {
      const params = new URLSearchParams(location.search);
      const presetMethod = params.get("method");
      const presetOs = params.get("os");
      if (presetMethod === "cli" || presetMethod === "install" || presetMethod === "docker") {
        method = presetMethod;
        root.querySelectorAll("[data-method]").forEach((btn) => {
          btn.setAttribute("aria-selected", btn.dataset.method === method ? "true" : "false");
        });
      }
      if (presetOs === "mac" || presetOs === "linux" || presetOs === "win") os = presetOs;
      root.addEventListener("click", () => {
        const url = new URL(location.href);
        url.searchParams.set("method", method);
        url.searchParams.set("os", os);
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      });
    }

    render();
    return { getMethod: () => method, getOs: () => os };
  }

  document.querySelectorAll("[data-terminal]").forEach(bindTerminal);

  function setNavOpen(open) {
    const wasOpen = overlay && overlay.classList.contains("is-open");
    document.body.classList.toggle("menu-open", open);
    if (overlay) {
      if (open) {
        overlay.classList.remove("is-open");
        if (!reduce) void overlay.offsetWidth;
        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
        overlay.removeAttribute("inert");
      } else {
        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
        overlay.setAttribute("inert", "");
      }
    }
    if (navToggle) navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    const closeBtn = overlay && overlay.querySelector("[data-nav-close]");
    if (open && closeBtn) closeBtn.focus();
    else if (!open && wasOpen && navToggle) navToggle.focus();
  }

  if (overlay && navToggle) {
    overlay.setAttribute("inert", "");
    navToggle.addEventListener("click", () => {
      setNavOpen(!overlay.classList.contains("is-open"));
    });
    overlay.querySelectorAll("[data-nav-close]").forEach((btn) => {
      btn.addEventListener("click", () => setNavOpen(false));
    });
    overlay.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setNavOpen(false));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && overlay.classList.contains("is-open")) setNavOpen(false);
    });
  }

  const screens = {
    home: {
      src: "assets/device/home.png",
      es: "Carrusel de álbumes, hechas para ti y el mini player.",
      en: "Album carousel, made-for-you rows, and the mini player.",
      altEs: "Inicio de Verbbe con el carrusel de álbumes",
      altEn: "Verbbe Home with the album carousel",
    },
    player: {
      src: "assets/device/player.png",
      es: "Pantalla completa, letras si el archivo las trae, cola y favoritos.",
      en: "Full player, lyrics if the file has them, queue, and favorites.",
      altEs: "Reproductor a pantalla completa de Verbbe",
      altEn: "Verbbe full-screen player",
    },
    library: {
      src: "assets/device/library.png",
      es: "Canciones, álbumes, artistas, géneros y playlists de esta fuente.",
      en: "Songs, albums, artists, genres, and playlists from this source.",
      altEs: "Biblioteca de Verbbe",
      altEn: "Verbbe library",
    },
    server: {
      src: "assets/device/server.png",
      es: "Pegas la URL del PC. Local y servidor no se mezclan.",
      en: "Paste the PC URL. Local and server stay apart.",
      altEs: "Pantalla para conectar el servidor Verbbe",
      altEn: "Verbbe server connection screen",
    },
  };

  const stageImg = document.querySelector("[data-stage-img]");
  const stageNext = document.querySelector("[data-stage-next]");
  const stageCap = document.querySelector("[data-screen-cap]");
  const stagePanel = document.getElementById("panel-screen");
  const screenButtons = document.querySelectorAll("[data-screen]");
  let stageBusy = false;
  let stageQueued = null;

  function lang() {
    return document.documentElement.dataset.lang === "en" ? "en" : "es";
  }

  function screenCopy(screen) {
    return lang() === "en" ? { cap: screen.en, alt: screen.altEn } : { cap: screen.es, alt: screen.altEs };
  }

  function applyScreenChrome(id, screen) {
    const copy = screenCopy(screen);
    if (stageImg) stageImg.alt = copy.alt;
    if (stageCap) {
      const es = stageCap.querySelector(".lang-es");
      const en = stageCap.querySelector(".lang-en");
      if (es) es.textContent = screen.es;
      if (en) en.textContent = screen.en;
    }
    screenButtons.forEach((btn) => {
      const on = btn.dataset.screen === id;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      if (on && stagePanel) stagePanel.setAttribute("aria-labelledby", btn.id);
    });
    const url = new URL(location.href);
    url.searchParams.set("view", id);
    history.replaceState(null, "", url.hash ? url.pathname + url.search + url.hash : url.pathname + url.search);
  }

  function finishStageSwap(screen) {
    const stack = stageImg && stageImg.closest(".shot-stack");
    if (stageImg) {
      stageImg.src = screen.src;
      stageImg.alt = screenCopy(screen).alt;
    }
    if (stack) {
      stack.classList.add("is-hold");
      stack.classList.remove("is-xfade");
      void stack.offsetWidth;
      stack.classList.remove("is-hold");
    }
    stageBusy = false;
    if (stageQueued) {
      const nextId = stageQueued;
      stageQueued = null;
      setScreen(nextId);
    }
  }

  function setScreen(id, instant) {
    const screen = screens[id] || screens.home;
    applyScreenChrome(id, screen);
    if (!stageImg) return;
    const current = stageImg.getAttribute("src");
    if (current === screen.src) return;

    const stack = stageImg.closest(".shot-stack");
    const frame = stageImg.closest(".show-frame");
    const hidden = !stack || (frame && getComputedStyle(frame).display === "none");
    if (instant || reduce || !stageNext || hidden) {
      stageImg.src = screen.src;
      if (stageNext) stageNext.src = screen.src;
      return;
    }
    if (stageBusy) {
      stageQueued = id;
      return;
    }

    stageBusy = true;
    stageNext.src = screen.src;
    const onEnd = (event) => {
      if (event.propertyName !== "opacity") return;
      stack.removeEventListener("transitionend", onEnd);
      window.clearTimeout(failSafe);
      finishStageSwap(screen);
    };
    const failSafe = window.setTimeout(() => {
      stack.removeEventListener("transitionend", onEnd);
      finishStageSwap(screen);
    }, 700);
    stack.addEventListener("transitionend", onEnd);
    requestAnimationFrame(() => stack.classList.add("is-xfade"));
  }

  function setupAsk() {
    document.querySelectorAll(".ask-list details").forEach((item) => {
      const summary = item.querySelector("summary");
      const panel = item.querySelector(".ask-panel");
      if (!summary || !panel) return;
      let busy = false;

      summary.addEventListener("click", (event) => {
        event.preventDefault();
        if (busy) return;
        const isOpen = item.hasAttribute("open");

        if (reduce) {
          if (isOpen) item.removeAttribute("open");
          else item.setAttribute("open", "");
          panel.style.height = "";
          return;
        }

        busy = true;
        const release = () => { busy = false; };
        if (isOpen) {
          panel.style.height = `${panel.scrollHeight}px`;
          void panel.offsetHeight;
          panel.style.height = "0px";
          const onEnd = (e) => {
            if (e.propertyName !== "height") return;
            panel.removeEventListener("transitionend", onEnd);
            window.clearTimeout(failSafe);
            item.removeAttribute("open");
            release();
          };
          const failSafe = window.setTimeout(() => {
            panel.removeEventListener("transitionend", onEnd);
            item.removeAttribute("open");
            release();
          }, 700);
          panel.addEventListener("transitionend", onEnd);
        } else {
          item.setAttribute("open", "");
          panel.style.height = "0px";
          void panel.offsetHeight;
          panel.style.height = `${panel.scrollHeight}px`;
          const onEnd = (e) => {
            if (e.propertyName !== "height") return;
            panel.removeEventListener("transitionend", onEnd);
            window.clearTimeout(failSafe);
            panel.style.height = "auto";
            release();
          };
          const failSafe = window.setTimeout(() => {
            panel.removeEventListener("transitionend", onEnd);
            panel.style.height = "auto";
            release();
          }, 700);
          panel.addEventListener("transitionend", onEnd);
        }
      });
    });
  }

  setupAsk();

  if (screenButtons.length && stageImg) {
    screenButtons.forEach((btn) => {
      btn.addEventListener("click", () => setScreen(btn.dataset.screen));
    });
    const presetView = new URLSearchParams(location.search).get("view");
    if (presetView && screens[presetView]) setScreen(presetView, true);
  }

  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (stageImg) {
        const current = [...screenButtons].find((el) => el.getAttribute("aria-selected") === "true");
        if (current) setScreen(current.dataset.screen);
      }
      window.requestAnimationFrame(fillRibbon);
    });
  });

  function fillRibbon() {
    const ribbon = document.querySelector("[data-ticker]");
    const track = ribbon && ribbon.querySelector(".ribbon-track");
    const source = track && track.querySelector(".ribbon-set");
    if (!track || !source) return;

    const template = source.cloneNode(true);
    template.removeAttribute("aria-hidden");
    track.style.animation = "none";
    track.replaceChildren(template.cloneNode(true));
    const first = track.firstElementChild;
    const minWidth = Math.max(window.innerWidth * 2, 1) + first.offsetWidth;
    while (track.scrollWidth < minWidth) {
      const clone = template.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
    }
    track.style.setProperty("--ribbon-shift", `${first.offsetWidth}px`);
    track.style.setProperty("--ribbon-duration", `${Math.max(22, first.offsetWidth / 42)}s`);
    void track.offsetWidth;
    track.style.animation = "";
  }

  fillRibbon();
  let ribbonResize = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(ribbonResize);
    ribbonResize = window.setTimeout(fillRibbon, 120);
  });

  function playArtistFill(row) {
    if (!row || row.dataset.filled === "1") return;
    row.dataset.filled = "1";
    const pcts = row.querySelectorAll("[data-artist-pct]");
    const setPct = (n) => pcts.forEach((el) => { el.textContent = `${n}%`; });
    const syncWidth = () => {
      row.style.setProperty("--row-w", `${Math.round(row.getBoundingClientRect().width)}px`);
    };
    syncWidth();
    if (reduce) {
      row.classList.add("is-filled");
      setPct(100);
      return;
    }
    const duration = 1250;
    const start = performance.now();
    requestAnimationFrame(() => row.classList.add("is-filled"));
    requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setPct(Math.round(eased * 100));
      if (t < 1) requestAnimationFrame(tick);
    });
  }

  const revealEls = document.querySelectorAll("[data-reveal]");
  const artistRow = document.querySelector("[data-artist-fill]");
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -10% 0px" },
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  if (artistRow) {
    const syncArtistWidth = () => {
      artistRow.style.setProperty("--row-w", `${Math.round(artistRow.getBoundingClientRect().width)}px`);
    };
    window.addEventListener("resize", syncArtistWidth);
    if (!reduce && "IntersectionObserver" in window) {
      const aio = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            playArtistFill(artistRow);
            aio.unobserve(entry.target);
          });
        },
        { threshold: 0.45 },
      );
      aio.observe(artistRow);
    } else {
      playArtistFill(artistRow);
    }
  }

})();
