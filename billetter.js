(() => {
  "use strict";

  const form = document.querySelector("[data-tickets-form]");
  if (!form) return;

  const access = document.querySelector("[data-tickets-access]");
  const codeInput = document.querySelector("[data-tickets-code]");
  const submitButton = document.querySelector("[data-tickets-submit]");
  const status = document.querySelector("[data-tickets-status]");
  const toolbar = document.querySelector("[data-tickets-toolbar]");
  const lockButton = document.querySelector("[data-tickets-lock]");
  const retryButton = document.querySelector("[data-tickets-retry]");
  const list = document.querySelector("[data-tickets-list]");
  const directions = ["outbound", "return", "roundtrip"];
  const downloadUrls = new Set();

  let tickets = [];
  let busy = false;
  let authenticated = false;
  let statusKey = "tickets.status.checking";
  let statusTone = "loading";

  function text(key, vars) {
    return window.SiteI18n?.t(key, vars) || key;
  }

  function language() {
    const lang = window.SiteI18n?.getLang() || document.documentElement.lang;
    return ["da", "en", "nl"].includes(lang) ? lang : "en";
  }

  function setStatus(key, tone = "info") {
    statusKey = key;
    statusTone = tone;
    status.textContent = key ? text(key) : "";
    status.dataset.state = tone;
    retryButton.hidden = tone !== "error" || key === "tickets.status.wrongCode";
  }

  function setBusy(value) {
    busy = value;
    form.setAttribute("aria-busy", String(value));
    list.setAttribute("aria-busy", String(value));
    codeInput.disabled = value;
    submitButton.disabled = value;
    lockButton.disabled = value;
    retryButton.disabled = value;
    submitButton.textContent = text(value ? "tickets.access.unlocking" : "tickets.access.unlock");
    list.querySelectorAll("a").forEach((link) => {
      if (value) link.setAttribute("aria-disabled", "true");
      else link.removeAttribute("aria-disabled");
    });
  }

  function clearDownloads() {
    downloadUrls.forEach((url) => URL.revokeObjectURL(url));
    downloadUrls.clear();
  }

  function showAccess() {
    authenticated = false;
    tickets = [];
    list.replaceChildren();
    list.hidden = true;
    toolbar.hidden = true;
    access.hidden = false;
    codeInput.value = "";
    codeInput.removeAttribute("aria-invalid");
    clearDownloads();
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      return await fetch(path, {
        ...options,
        credentials: "same-origin",
        mode: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json", ...options.headers },
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function requestError(response, operation) {
    if (response.status === 401) {
      showAccess();
      const wrongCode = operation === "unlock";
      codeInput.setAttribute("aria-invalid", String(wrongCode));
      setStatus(wrongCode ? "tickets.status.wrongCode" : "tickets.status.sessionExpired", "error");
      return;
    }
    setStatus(response.status === 429 ? "tickets.status.rateLimited" : "tickets.status.unavailable", "error");
  }

  function localized(value) {
    if (!value || typeof value !== "object") return "";
    return value[language()] || value.en || value.da || value.nl || "";
  }

  function validLocalized(value, limit) {
    return value && typeof value === "object" && ["da", "en", "nl"].every((lang) =>
      typeof value[lang] === "string" && value[lang].length > 0 && value[lang].length <= limit
    );
  }

  function validateTickets(value) {
    if (!value || !Array.isArray(value.tickets) || value.tickets.length > 100) return null;
    const filenames = new Set();
    for (const ticket of value.tickets) {
      if (!ticket || typeof ticket.filename !== "string" ||
          !/^[a-z0-9][a-z0-9._-]*\.pdf$/.test(ticket.filename) ||
          ticket.filename.length > 200 || ticket.filename.includes("..") ||
          filenames.has(ticket.filename) || !directions.includes(ticket.direction) ||
          !["ticket", "reservation"].includes(ticket.kind) ||
          !Number.isInteger(ticket.passengers) || ticket.passengers < 1 || ticket.passengers > 1000 ||
          !validLocalized(ticket.title, 300) || !validLocalized(ticket.description, 1500) ||
          typeof ticket.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ticket.sha256)) {
        return null;
      }
      filenames.add(ticket.filename);
    }
    return value.tickets;
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }

  async function downloadTicket(event, ticket) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (busy || !authenticated) return;
    setBusy(true);
    setStatus("tickets.status.loading", "loading");
    try {
      const response = await request(`/api/tickets/files/${encodeURIComponent(ticket.filename)}`, {
        headers: { Accept: "application/pdf" },
      });
      if (!response.ok) {
        requestError(response, "download");
        return;
      }
      if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/pdf")) {
        setStatus("tickets.status.invalidData", "error");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      downloadUrls.add(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = ticket.filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.delete(url);
      }, 60000);
      setStatus("tickets.status.unlocked", "success");
    } catch {
      setStatus("tickets.status.network", "error");
    } finally {
      setBusy(false);
    }
  }

  function renderTickets() {
    list.replaceChildren();
    if (!authenticated) return;
    const fragment = document.createDocumentFragment();
    if (tickets.length === 0) {
      fragment.append(element("p", "tickets-empty", text("tickets.empty")));
    }
    directions.forEach((direction) => {
      const group = tickets.filter((ticket) => ticket.direction === direction);
      if (!group.length) return;
      const section = element("section", "tickets-section");
      const heading = element("h2", "", text(`tickets.section.${direction}`));
      heading.id = `tickets-${direction}`;
      section.setAttribute("aria-labelledby", heading.id);
      section.append(heading);
      const grid = element("div", "tickets-grid");
      group.forEach((ticket) => {
        const card = element("article", "ticket-card");
        const meta = element("div", "ticket-meta");
        meta.append(element("span", "ticket-kind", text(`tickets.kind.${ticket.kind}`)));
        meta.append(element("span", "", text("tickets.meta.passengers", { n: ticket.passengers })));
        const title = localized(ticket.title);
        const link = element("a", "btn btn-primary tickets-download", text("tickets.download"));
        link.href = `/api/tickets/files/${encodeURIComponent(ticket.filename)}`;
        link.download = ticket.filename;
        link.setAttribute("aria-label", `${text("tickets.download")}: ${title}`);
        link.addEventListener("click", (event) => downloadTicket(event, ticket));
        card.append(meta, element("h3", "ticket-title", title),
          element("p", "ticket-description", localized(ticket.description)), link);
        grid.append(card);
      });
      section.append(grid);
      fragment.append(section);
    });
    list.append(fragment);
    list.hidden = false;
    toolbar.hidden = false;
    access.hidden = true;
    if (busy) list.querySelectorAll("a").forEach((link) => link.setAttribute("aria-disabled", "true"));
  }

  async function loadManifest() {
    setStatus("tickets.status.loading", "loading");
    const response = await request("/api/tickets/manifest");
    if (!response.ok) {
      showAccess();
      requestError(response, "manifest");
      return;
    }
    let validated;
    try {
      validated = validateTickets(await response.json());
    } catch {
      validated = null;
    }
    if (!validated) {
      showAccess();
      setStatus("tickets.status.invalidData", "error");
      return;
    }
    authenticated = true;
    tickets = validated;
    renderTickets();
    setStatus("tickets.status.unlocked", "success");
  }

  async function checkSession() {
    if (busy) return;
    setBusy(true);
    setStatus("tickets.status.checking", "loading");
    try {
      const response = await request("/api/tickets/session");
      if (!response.ok) {
        showAccess();
        if (response.status === 401) setStatus("");
        else requestError(response, "session");
        return;
      }
      const session = await response.json();
      if (session.authenticated === true) await loadManifest();
      else {
        showAccess();
        setStatus("");
      }
    } catch {
      showAccess();
      setStatus("tickets.status.network", "error");
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const code = codeInput.value;
    codeInput.value = "";
    codeInput.removeAttribute("aria-invalid");
    setBusy(true);
    setStatus("tickets.status.loading", "loading");
    try {
      const response = await request("/api/tickets/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        requestError(response, "unlock");
        return;
      }
      await loadManifest();
      if (authenticated) document.querySelector("[data-tickets-heading]").focus();
    } catch {
      showAccess();
      setStatus("tickets.status.network", "error");
    } finally {
      setBusy(false);
      if (!authenticated) codeInput.focus();
    }
  });

  lockButton.addEventListener("click", async () => {
    if (busy) return;
    showAccess();
    setBusy(true);
    setStatus("tickets.status.checking", "loading");
    try {
      const response = await request("/api/tickets/lock", { method: "POST" });
      if (response.ok || response.status === 401) setStatus("tickets.status.locked", "success");
      else requestError(response, "lock");
    } catch {
      setStatus("tickets.status.network", "error");
    } finally {
      setBusy(false);
      codeInput.focus();
    }
  });

  retryButton.addEventListener("click", checkSession);
  document.addEventListener("site:langchange", () => {
    renderTickets();
    setStatus(statusKey, statusTone);
    submitButton.textContent = text(busy ? "tickets.access.unlocking" : "tickets.access.unlock");
  });

  checkSession();
})();
