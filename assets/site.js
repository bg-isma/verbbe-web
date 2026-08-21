(function () {
  const fine = window.matchMedia("(pointer: fine)").matches;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const terminal = document.querySelector("[data-terminal]");
  const commandEl = document.querySelector("[data-command]");
  const outputEl = document.querySelector("[data-output]");
  const copyBtn = document.querySelector("[data-copy]");
  let method = "install";
  let os = /Mac/i.test(navigator.platform || "") ? "mac" : /Win/i.test(navigator.platform || "") ? "win" : "linux";

  function musicPath(osName) {
    return osName === "win" ? "%USERPROFILE%\\Music" : "~/Music";
  }

  function currentCommand() {
    const path = musicPath(os);
    if (method === "install" && os !== "win") {
      return `curl -fsSL https://verbbe.com/install.sh | bash\nverbbe start --music ${path}`;
    }
    if (method === "docker") {
      if (os === "win") {
        return `git clone https://github.com/bg-isma/Verbbe.git\ncd Verbbe\\server\nset VERBBE_MUSIC=${path}\ndocker compose up --build`;
      }
      return `git clone https://github.com/bg-isma/Verbbe.git\ncd Verbbe/server\nVERBBE_MUSIC=${path} docker compose up --build`;
    }
    return `npx verbbe start --music ${path}`;
  }

  function currentOutput() {
    return [
      '<span class="c-dim">  music   ~/Music</span>',
      '<span class="c-dim">  port    4747</span>',
      "",
      '<span class="c-dim">  Local    </span>http://127.0.0.1:4747',
      '<span class="c-dim">  Wi-Fi    </span><span class="c-lime">http://192.168.1.42:4747</span>',
    ].join("\n");
  }

  function renderCommand() {
    if (commandEl) {
      commandEl.textContent = currentCommand()
        .split("\n")
        .map((line) => `$ ${line}`)
        .join("\n");
    }
    if (outputEl) outputEl.innerHTML = currentOutput();
  }

  if (terminal) {
    terminal.querySelectorAll("[data-os]").forEach((btn) => {
      btn.setAttribute("aria-selected", btn.dataset.os === os ? "true" : "false");
    });
    terminal.addEventListener("click", (event) => {
      const methodBtn = event.target.closest("[data-method]");
      const osBtn = event.target.closest("[data-os]");
      if (methodBtn) {
        method = methodBtn.dataset.method;
        terminal.querySelectorAll("[data-method]").forEach((btn) => {
          btn.setAttribute("aria-selected", btn === methodBtn ? "true" : "false");
        });
        renderCommand();
      }
      if (osBtn) {
        os = osBtn.dataset.os;
        terminal.querySelectorAll("[data-os]").forEach((btn) => {
          btn.setAttribute("aria-selected", btn === osBtn ? "true" : "false");
        });
        renderCommand();
      }
    });
    renderCommand();
  }

  if (copyBtn && commandEl) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(currentCommand());
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
      } catch (_) {
        /* ignore */
      }
    });
  }

  document.querySelectorAll("[data-glow]").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    });
  });

  const stack = document.querySelector("[data-tilt]");
  if (stack && fine && !reduce) {
    stack.addEventListener("pointermove", (event) => {
      const rect = stack.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      stack.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 8}deg)`;
    });
    stack.addEventListener("pointerleave", () => {
      stack.style.transform = "";
    });
  }

  if (!reduce) {
    document.querySelectorAll(".magnet").forEach((btn) => {
      btn.addEventListener("pointermove", (event) => {
        const rect = btn.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        btn.style.transform = `translate(${dx * 0.22}px, ${dy * 0.28}px)`;
      });
      btn.addEventListener("pointerleave", () => {
        btn.style.transform = "";
      });
    });
  }
})();
