(() => {
  if (!("serviceWorker" in navigator)) return;

  const installButton = document.querySelector("[data-pwa-install]");
  const instructions = document.querySelector("[data-pwa-instructions]");
  const offlineReady = document.querySelector("[data-pwa-ready]");
  const standalone = window.matchMedia("(display-mode: standalone)");
  let installPrompt;

  function hideInstall() {
    if (!installButton) return;
    installButton.hidden = true;
    instructions.hidden = true;
    installButton.setAttribute("aria-expanded", "false");
  }

  if (installButton && !standalone.matches && !navigator.standalone) {
    installButton.hidden = false;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event;
    });
    installButton.addEventListener("click", async () => {
      if (installPrompt) {
        const prompt = installPrompt;
        installPrompt = null;
        try {
          await prompt.prompt();
          return;
        } catch {
          // The browser menu can still be used.
        }
      }
      instructions.hidden = !instructions.hidden;
      installButton.setAttribute("aria-expanded", String(!instructions.hidden));
    });
    window.addEventListener("appinstalled", hideInstall);
  }

  navigator.serviceWorker.register("/service-worker.js?app=nl-exchange")
    .then(() => navigator.serviceWorker.ready)
    .then(() => { if (offlineReady) offlineReady.hidden = false; })
    .catch((error) => console.warn("Offline setup failed", error));
})();
