import type { PayoutDefinition } from "@repo/db/schema";

export const seedPayoutDefinitions = {
  cash: {
    groups: [
      {
        id: "cash-prizes",
        name: "现金大奖",
        prizes: [
          { id: "grand", name: "头奖", amount: 500, quantity: 3 },
          { id: "first", name: "一等奖", amount: 100, quantity: 30 },
        ],
      },
      {
        id: "participation-prizes",
        name: "参与奖励",
        prizes: [{ id: "bonus", name: "参与奖", amount: 2, quantity: 600 }],
      },
    ],
  },
  voucher: {
    groups: [
      {
        id: "voucher-prizes",
        name: "抵用券",
        prizes: [
          { id: "premium", name: "超值抵用券", amount: 50, quantity: 10 },
          { id: "standard", name: "通用抵用券", amount: 12.5, quantity: 100 },
        ],
      },
    ],
  },
  overseas: {
    groups: [
      {
        id: "overseas-prizes",
        name: "活动奖励",
        prizes: [
          { id: "grand", name: "特别奖", amount: 25, quantity: 6 },
          { id: "bonus", name: "幸运奖", amount: 2, quantity: 240 },
        ],
      },
    ],
  },
  draft: { groups: [] },
} satisfies Record<string, PayoutDefinition>;

export const seedPayoutEntries = [
  {
    index: 1,
    customerIndex: 1,
    productType: "pull-tab",
    name: "夏日嘉年华首批奖表",
    ticketCount: 20000,
    unitPrice: "5",
    plan: "cash",
  },
  {
    index: 2,
    customerIndex: 1,
    productType: "pull-tab",
    name: "夏日嘉年华加印奖表",
    ticketCount: 10000,
    unitPrice: "5",
    plan: "voucher",
  },
  {
    index: 3,
    customerIndex: 1,
    productType: "lottery",
    name: "Summer Draw 2026",
    ticketCount: 10000,
    unitPrice: "1.5",
    plan: "overseas",
  },
  {
    index: 4,
    customerIndex: 3,
    productType: "scratch-card",
    name: "会员积分抽奖方案",
    ticketCount: 20000,
    unitPrice: "2.5",
    plan: "cash",
  },
  {
    index: 5,
    customerIndex: 3,
    productType: "scratch-card",
    name: "会员积分抽奖加开场",
    ticketCount: 5000,
    unitPrice: "2.5",
    plan: "voucher",
  },
  {
    index: 6,
    customerIndex: 3,
    productType: "user-defined",
    name: "展会现场兑奖草案",
    ticketCount: 8000,
    unitPrice: "3",
    plan: "draft",
  },
  {
    index: 7,
    customerIndex: 7,
    productType: "lottery",
    name: "周年庆抽奖券首批",
    ticketCount: 25000,
    unitPrice: "1.25",
    plan: "overseas",
  },
  {
    index: 8,
    customerIndex: 7,
    productType: "lottery",
    name: "Anniversary Draw 2026",
    ticketCount: 10000,
    unitPrice: "1.25",
    plan: "overseas",
  },
  {
    index: 9,
    customerIndex: 7,
    productType: "pull-tab",
    name: "夏日嘉年华周末专场",
    ticketCount: 15000,
    unitPrice: "4",
    plan: "cash",
  },
  {
    index: 10,
    customerIndex: 9,
    productType: "scratch-card",
    name: "松果会员日刮奖",
    ticketCount: 12000,
    unitPrice: "3",
    plan: "voucher",
  },
  {
    index: 11,
    customerIndex: 9,
    productType: "scratch-card",
    name: "松果会员日返场刮奖",
    ticketCount: 8000,
    unitPrice: "3",
    plan: "voucher",
  },
  {
    index: 12,
    customerIndex: 9,
    productType: "lottery",
    name: "秋季新品抽奖券",
    ticketCount: 10000,
    unitPrice: "2",
    plan: "overseas",
  },
] as const;
