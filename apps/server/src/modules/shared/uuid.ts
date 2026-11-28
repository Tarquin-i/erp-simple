const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function normalizeUuid(value: unknown) {
  return typeof value === "string" && uuidPattern.test(value)
    ? value.toLowerCase()
    : undefined;
}
