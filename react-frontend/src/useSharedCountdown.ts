import { useEffect, useState } from "react";
import type { SharedTimer } from "./types";

export const defaultSharedTimer = (durationSeconds = 45): SharedTimer => ({ version: 0, durationSeconds, remainingSeconds: durationSeconds, status: "idle", startedAt: null, updatedAt: "" });

export function useSharedCountdown(timer: SharedTimer, serverClockOffsetMs = 0) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    setClock(Date.now());
    if (timer.status !== "running") return;
    const handle = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, [timer.startedAt, timer.status, timer.version]);
  const elapsed = timer.status === "running" && timer.startedAt ? Math.floor(((clock + serverClockOffsetMs) - Date.parse(timer.startedAt)) / 1000) : 0;
  const seconds = Math.max(0, timer.remainingSeconds - elapsed);
  return { seconds, running: timer.status === "running" && seconds > 0 };
}
