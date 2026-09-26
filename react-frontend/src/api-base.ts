type BrowserLocation = Pick<Location, "hostname" | "origin" | "protocol">;

export function apiBaseFor(location: BrowserLocation, configuredBase = import.meta.env.VITE_API_URL) {
  if (configuredBase) return configuredBase.replace(/\/$/, "");
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return isLocal ? `${location.protocol}//${location.hostname}:3000/api` : `${location.origin}/api`;
}

export function defaultApiBase() {
  return apiBaseFor(window.location);
}
