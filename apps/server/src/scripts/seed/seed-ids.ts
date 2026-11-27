const seedIdPrefixes = {
  customer: "d0000001",
  contact: "d0000002",
  method: "d0000003",
  communication: "d0000004",
  address: "d0000007",
  product: "d0000008",
  payout: "d0000009",
} as const;

export function seedId(kind: keyof typeof seedIdPrefixes, index: number) {
  return `${seedIdPrefixes[kind]}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
