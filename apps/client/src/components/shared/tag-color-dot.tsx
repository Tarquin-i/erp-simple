export function hasVisibleTagColor(color?: string | null): color is string {
  return (
    typeof color === "string" &&
    /^#[\da-f]{6}$/i.test(color) &&
    color !== "#111111"
  );
}

export function TagColorDot({ color }: { color?: string | null }) {
  if (!hasVisibleTagColor(color)) return null;

  return (
    <span
      aria-hidden="true"
      data-slot="tag-color-dot"
      className="size-2 shrink-0 rounded-full ring-1 ring-foreground/10"
      style={{ backgroundColor: color }}
    />
  );
}
