const seedIdPrefixes = {
  customer: "d0000001",
  contact: "d0000002",
  method: "d0000003",
  communication: "d0000004",
  customerTag: "d0000005",
  communicationTag: "d0000006",
  address: "d0000007",
  product: "d0000008",
  payout: "d0000009",
} as const;

export function seedId(kind: keyof typeof seedIdPrefixes, index: number) {
  return `${seedIdPrefixes[kind]}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function resolveSeedTags(
  names: readonly string[],
  kind: "customerTag" | "communicationTag",
  rows: { id: string; normalizedName: string }[]
) {
  return new Map(
    names.map((name, index) => {
      const tag =
        rows.find((row) => row.id === seedId(kind, index + 1)) ??
        rows.find((row) => row.normalizedName === name.toLowerCase());
      if (!tag) throw new Error(`缺少种子标签：${name}。`);
      return [name, tag.id] as const;
    })
  );
}
