export const DEFAULT_LIST_PAGE_SIZE = 20;

export const LIST_PAGE_SIZES: readonly number[] = [
  10,
  DEFAULT_LIST_PAGE_SIZE,
  50,
  100,
];

export function readListPageSize(value: unknown): number | undefined {
  const size =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : undefined;

  if (
    size === undefined ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 100 ||
    size === DEFAULT_LIST_PAGE_SIZE
  ) {
    return undefined;
  }

  return size;
}
