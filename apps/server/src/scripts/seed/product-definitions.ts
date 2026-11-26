export const seedProductDefaults = {
  specification: "双面印刷",
  packagingSpecification: "100 张/包，10 包/箱",
  colorCount: "4C + 4C",
  paperType: "250 g/m² 铜版纸",
  finalMolding: "模切",
  surfaceTreatment: "哑膜",
  variableColor: "黑色",
  variationMethod: "流水编号",
  currencyCode: "CNY",
  remark: "演示产品，尺寸和价格仅供流程测试。",
} as const;

export const seedProductTemplates = {
  "pull-tab": {
    index: 1,
    name: "夏日嘉年华揭开卡",
    englishName: "Summer Carnival Pull Tab",
    finishedSize: "102 × 51 mm",
    dieCutDirection: "纵向",
    peelOffQuantity: 3,
    unitPrice: "0.685",
  },
  lottery: {
    index: 2,
    name: "周年活动抽奖券",
    englishName: "Anniversary Raffle Ticket",
    finishedSize: "155 × 70 mm",
    scratchOffArea: "背面右下角",
    currencyCode: "USD",
    unitPrice: "0.1275",
  },
  "scratch-card": {
    index: 3,
    name: "会员积分刮刮卡",
    englishName: "Member Rewards Scratch Card",
    finishedSize: "90 × 54 mm",
    scratchOffArea: "正面中央",
    surfaceTreatment: "局部光油",
    unitPrice: "0.42",
  },
  "hang-tag": {
    index: 4,
    name: "棉麻系列商品吊牌",
    englishName: "Linen Collection Hang Tag",
    finishedSize: "45 × 90 mm",
    paperType: "300 g/m² 再生牛皮纸",
    finalMolding: "模切打孔",
    unitPrice: "0.295",
  },
  "recharge-card": {
    index: 5,
    name: "体验馆储值卡",
    englishName: "Experience Center Recharge Card",
    finishedSize: "86 × 54 mm",
    surfaceTreatment: "双面覆哑膜",
    unitPrice: "0.91",
  },
  "tax-stamp": {
    index: 6,
    name: "原产地追溯税票",
    englishName: "Origin Traceability Tax Stamp",
    finishedSize: "38 × 20 mm",
    paperType: "80 g/m² 易碎纸",
    surfaceTreatment: "防伪光油",
    currencyCode: "EUR",
    unitPrice: "0.1625",
  },
  "user-defined": {
    index: 7,
    name: "展会兑奖凭证",
    englishName: "Exhibition Redemption Voucher",
    customerDefinedType: "活动兑奖券",
    finishedSize: "120 × 60 mm",
    variationMethod: "逐张生成核销二维码",
    unitPrice: "0.35",
  },
} as const;

export const seedProductTypesByCustomer = new Map<
  number,
  readonly (keyof typeof seedProductTemplates)[]
>([
  [
    1,
    [
      "pull-tab",
      "lottery",
      "scratch-card",
      "hang-tag",
      "recharge-card",
      "tax-stamp",
      "user-defined",
    ],
  ],
  [
    3,
    [
      "pull-tab",
      "lottery",
      "scratch-card",
      "hang-tag",
      "recharge-card",
      "user-defined",
    ],
  ],
  [7, ["pull-tab", "lottery", "tax-stamp"]],
  [
    9,
    [
      "pull-tab",
      "lottery",
      "scratch-card",
      "hang-tag",
      "recharge-card",
      "user-defined",
    ],
  ],
]);
