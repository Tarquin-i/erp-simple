import { TagBadge } from "./tag-badge";

export function ListBadgeSummary({
  items,
  showColors = true,
}: {
  items: readonly { name: string; color?: string | null }[];
  showColors?: boolean;
}) {
  const first = items[0];
  if (!first) return <span className="text-muted-foreground">—</span>;

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      title={items.map(({ name }) => name).join("、")}
    >
      <TagBadge
        name={first.name}
        color={showColors ? first.color : undefined}
        className="shrink"
      />
      {items.length > 1 && (
        <span className="shrink-0 text-xs text-muted-foreground">
          等{items.length - 1}个
        </span>
      )}
    </div>
  );
}
