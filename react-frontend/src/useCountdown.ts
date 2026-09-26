import { useEffect, useState } from "react";

export function useCountdown(initialSeconds = 45) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running || seconds <= 0) return;
    const handle = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(handle);
  }, [running, seconds]);

  useEffect(() => { if (seconds === 0) setRunning(false); }, [seconds]);

  return {
    seconds,
    running,
    start: () => setRunning(true),
    pause: () => setRunning(false),
    reset: () => { setRunning(false); setSeconds(initialSeconds); },
  };
}
