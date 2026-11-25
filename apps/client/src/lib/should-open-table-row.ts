import type { MouseEvent } from "react";

export function shouldOpenTableRow(event: MouseEvent<HTMLTableRowElement>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    window.getSelection()?.toString()
  ) {
    return false;
  }

  const { currentTarget, target } = event;
  return (
    target instanceof Element &&
    currentTarget.contains(target) &&
    !target.closest("a,button,[role='button']")
  );
}
