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

  // Active nav on scroll
  const sections = ["overview", "program-nl", "program-dk", "practical", "contact"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const navLinks = [...(nav?.querySelectorAll("a") || [])];

  const setActive = () => {
    const y = window.scrollY + 120;
    let current = sections[0]?.id;
    sections.forEach((sec) => {
      if (sec.offsetTop <= y) current = sec.id;
    });
    navLinks.forEach((link) => {
      const href = link.getAttribute("href")?.slice(1);
      link.classList.toggle("is-active", href === current);
    });
  };

  window.addEventListener("scroll", setActive, { passive: true });
  setActive();

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
        countEl.textContent =
          visible === 1 ? "1 spørgsmål" : `${visible} spørgsmål`;
      }
    };

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
    const resetBtn = document.querySelector("[data-pack-reset]");

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
    };

    packForm.addEventListener("change", update);
    resetBtn?.addEventListener("click", () => {
      boxes.forEach((box) => {
        box.checked = false;
      });
      update();
    });
    update();
  }
})();
