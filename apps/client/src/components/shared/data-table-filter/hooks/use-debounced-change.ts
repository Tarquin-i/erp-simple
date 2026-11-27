import { useEffect, useEffectEvent } from "react";

export function useDebouncedChange<T>(
  value: T | null,
  onChange: (value: T) => void,
  delayMs = 500
) {
  const commitChange = useEffectEvent(onChange);

  useEffect(() => {
    if (value === null) return;

    const timeoutId = window.setTimeout(() => commitChange(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);
}
