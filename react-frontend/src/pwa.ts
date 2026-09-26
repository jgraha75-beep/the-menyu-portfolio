export function registerPwa() {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The application remains usable online when registration is unavailable.
    });
  }, { once: true });
}
