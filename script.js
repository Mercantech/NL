(() => {
  const body = document.body;
  const toggle = document.querySelector("[data-menu-toggle]");
  const nav = document.getElementById("main-nav");

  toggle?.addEventListener("click", () => {
    const open = body.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  nav?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      body.classList.remove("nav-open");
      toggle?.setAttribute("aria-expanded", "false");
    });
  });

  // Reveal schedule rows
  const rows = document.querySelectorAll(".schedule-row");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const row = entry.target;
            const siblings = [
              ...row.parentElement.querySelectorAll(".schedule-row"),
            ];
            const i = siblings.indexOf(row);
            row.style.transitionDelay = `${Math.min(i, 12) * 30}ms`;
            row.classList.add("is-visible");
            io.unobserve(row);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -24px 0px" }
    );
    rows.forEach((row) => io.observe(row));
  } else {
    rows.forEach((row) => row.classList.add("is-visible"));
  }

  // Filter chips per programme
  document.querySelectorAll("[data-filter-group]").forEach((group) => {
    const key = group.getAttribute("data-filter-group");
    const schedule = document.querySelector(`[data-schedule="${key}"]`);
    if (!schedule) return;

    group.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        group.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        const filter = chip.getAttribute("data-filter");
        schedule.querySelectorAll(".schedule-row").forEach((row) => {
          const type = row.getAttribute("data-type");
          const show =
            filter === "all" ||
            type === filter ||
            (filter === "school" && type === "arrive");
          row.classList.toggle("is-dimmed", !show);
        });
      });
    });
  });

  // Floating side-nav: active section on scroll + hide over hero
  const sideNav = document.querySelector("[data-side-nav]");
  if (sideNav) {
    const sideLinks = [...sideNav.querySelectorAll("[data-side-link]")];
    const sideSections = sideLinks
      .map((link) => {
        const id = link.getAttribute("href")?.replace(/^#/, "");
        return id ? document.getElementById(id) : null;
      })
      .filter(Boolean);

    const setSideActive = () => {
      const y = window.scrollY + window.innerHeight * 0.28;
      let current = sideSections[0]?.id;
      sideSections.forEach((sec) => {
        if (sec.offsetTop <= y) current = sec.id;
      });
      sideLinks.forEach((link) => {
        const id = link.getAttribute("href")?.replace(/^#/, "");
        link.classList.toggle("is-active", id === current);
      });
    };

    window.addEventListener("scroll", setSideActive, { passive: true });
    setSideActive();

    const hero = document.querySelector(
      ".hero, .y26-hero, .qa-hero, .pack-hero, .years-hero, .lo-hero"
    );
    if (hero && "IntersectionObserver" in window) {
      const heroIo = new IntersectionObserver(
        ([entry]) => {
          sideNav.classList.toggle("is-hero-hidden", entry.isIntersecting);
        },
        { threshold: 0.2, rootMargin: "-8% 0px -40% 0px" }
      );
      heroIo.observe(hero);
      sideNav.classList.add("is-hero-hidden");
    } else if (hero) {
      const syncHero = () => {
        const rect = hero.getBoundingClientRect();
        const visible = rect.bottom > 80 && rect.top < window.innerHeight * 0.55;
        sideNav.classList.toggle("is-hero-hidden", visible);
      };
      window.addEventListener("scroll", syncHero, { passive: true });
      syncHero();
    }
  }

  // Q&A page: search + category filters
  const qaList = document.querySelector("[data-qa-list]");
  if (qaList) {
    const items = [...qaList.querySelectorAll("[data-qa-item]")];
    const search = document.querySelector("[data-qa-search]");
    const chips = document.querySelectorAll("[data-qa-filter]");
    const empty = document.querySelector("[data-qa-empty]");
    const countEl = document.querySelector("[data-qa-count]");
    let activeFilter = "all";

    const applyQaFilter = () => {
      const q = (search?.value || "").trim().toLowerCase();
      let visible = 0;
      items.forEach((item) => {
        const cat = item.getAttribute("data-cat");
        const text = item.textContent.toLowerCase();
        const matchCat = activeFilter === "all" || cat === activeFilter;
        const matchSearch = !q || text.includes(q);
        const show = matchCat && matchSearch;
        item.classList.toggle("is-hidden", !show);
        if (show) visible += 1;
      });
      if (empty) empty.hidden = visible > 0;
      if (countEl) {
        const i18n = window.SiteI18n;
        if (visible === 1) {
          countEl.textContent = i18n?.t("script.qa.count.one") || "1 question";
        } else {
          countEl.textContent = (
            i18n?.t("script.qa.count.many", { n: visible }) ||
            `${visible} questions`
          );
        }
      }
    };

    document.addEventListener("site:langchange", applyQaFilter);

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        chips.forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        activeFilter = chip.getAttribute("data-qa-filter") || "all";
        applyQaFilter();
      });
    });

    search?.addEventListener("input", applyQaFilter);

    // Only one accordion open at a time
    items.forEach((item) => {
      item.addEventListener("toggle", () => {
        if (!item.open) return;
        items.forEach((other) => {
          if (other !== item) other.open = false;
        });
      });
    });
  }

  // Packing checklist (localStorage)
  const packForm = document.querySelector("[data-pack-form]");
  if (packForm) {
    const STORAGE_KEY = "nl-pack-checklist-v1";
    const boxes = [...packForm.querySelectorAll('input[type="checkbox"]:not(:disabled)')];
    const doneEl = document.querySelector("[data-pack-done]");
    const totalEl = document.querySelector("[data-pack-total]");
    const fillEl = document.querySelector("[data-pack-fill]");
    const barEl = document.querySelector("[data-pack-bar]");
    const pctEl = document.querySelector("[data-pack-pct]");
    const hintEl = document.querySelector("[data-pack-hint]");
    const ringEl = document.querySelector("[data-pack-ring]");
    const doneBanner = document.querySelector("[data-pack-done-banner]");
    const resetBtn = document.querySelector("[data-pack-reset]");
    const groups = [...packForm.querySelectorAll("[data-pack-group]")];

    const hintKeys = [
      { max: 0, key: "script.pack.hint.0" },
      { max: 25, key: "script.pack.hint.25" },
      { max: 50, key: "script.pack.hint.50" },
      { max: 75, key: "script.pack.hint.75" },
      { max: 99, key: "script.pack.hint.99" },
      { max: 100, key: "script.pack.hint.100" },
    ];

    const hintFor = (pct) => {
      const i18n = window.SiteI18n;
      for (const h of hintKeys) {
        if (pct <= h.max) {
          return i18n?.t(h.key) || h.key;
        }
      }
      return i18n?.t("script.pack.hint.100") || "";
    };

    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      } catch {
        return {};
      }
    })();

    boxes.forEach((box) => {
      if (saved[box.value]) box.checked = true;
    });

    const updateGroups = () => {
      groups.forEach((group) => {
        const groupBoxes = [...group.querySelectorAll('input[type="checkbox"]:not(:disabled)')];
        const done = groupBoxes.filter((b) => b.checked).length;
        const countEl = group.querySelector("[data-group-count]");
        if (countEl) {
          countEl.textContent = `${done} / ${groupBoxes.length}`;
        }
        group.classList.toggle("is-group-done", groupBoxes.length > 0 && done === groupBoxes.length);
      });
    };

    const update = () => {
      const state = {};
      let done = 0;
      boxes.forEach((box) => {
        state[box.value] = box.checked;
        if (box.checked) done += 1;
        box.closest(".pack-item")?.classList.toggle("is-checked", box.checked);
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const total = boxes.length;
      const pct = total ? Math.round((done / total) * 100) : 0;

      if (doneEl) doneEl.textContent = String(done);
      if (totalEl) totalEl.textContent = String(total);
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (barEl) barEl.setAttribute("aria-valuenow", String(pct));
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (hintEl) hintEl.textContent = hintFor(pct);
      if (ringEl) {
        ringEl.style.setProperty("--pct", String(pct));
        ringEl.classList.toggle("is-complete", pct === 100);
      }
      if (doneBanner) doneBanner.hidden = pct !== 100;
      updateGroups();
    };

    packForm.addEventListener("change", update);
    resetBtn?.addEventListener("click", () => {
      boxes.forEach((box) => {
        box.checked = false;
      });
      update();
    });
    document.addEventListener("site:langchange", update);
    update();
  }

  // Previous years lightbox
  const yearsDialog = document.querySelector("[data-years-dialog]");
  const yearsDialogImg = document.querySelector("[data-years-dialog-img]");
  if (yearsDialog && yearsDialogImg) {
    document.querySelectorAll("[data-years-lightbox]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const full = btn.getAttribute("data-full") || btn.querySelector("img")?.src;
        const alt = btn.querySelector("img")?.alt || "";
        if (!full) return;
        yearsDialogImg.src = full;
        yearsDialogImg.alt = alt;
        yearsDialog.showModal();
      });
    });
    yearsDialog.querySelector("[data-years-close]")?.addEventListener("click", () => {
      yearsDialog.close();
    });
    yearsDialog.addEventListener("click", (e) => {
      if (e.target === yearsDialog) yearsDialog.close();
    });
  }

})();
