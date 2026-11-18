export const relatedTabs = [
  { value: "communication", label: "沟通记录" },
  { value: "products", label: "产品" },
  { value: "orders", label: "订单" },
  { value: "addresses", label: "地址" },
] as const;

export type CustomerDetailTab =
  | "contacts"
  | (typeof relatedTabs)[number]["value"];

export function isCustomerDetailTab(
  value: unknown
): value is CustomerDetailTab {
  return value === "contacts" || relatedTabs.some((tab) => tab.value === value);
}
