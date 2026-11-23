import type { ProductType } from "@/request/products";

type ProductAttribute = {
  options: readonly string[];
  maxLength: number;
  allowCustom: boolean;
};

const finishedSizesByType: Partial<Record<ProductType, readonly string[]>> = {
  "pull-tab": [
    "48*76 mm",
    "51*76 mm",
    "51*51 mm",
    "44*60 mm",
    "47.5*66.6 mm",
    "48*96 mm",
    "53圆",
    "45圆",
    "40圆",
    "38圆",
    "60圆",
  ],
  "recharge-card": ["86*54 mm"],
  lottery: [
    "100*50 mm",
    "100*75 mm",
    "100*70 mm",
    "101.6*101.6 mm",
    "76.2*50.8 mm",
    "100*150 mm",
  ],
};

const defaultFinishedSizes = [
  ...new Set(Object.values(finishedSizesByType).flat()),
];

export const productAttributes = {
  specification: {
    options: ["200g", "210g", "250g", "280g", "285g", "300g", "305g", "350g"],
    maxLength: 128,
    allowCustom: true,
  },
  finishedSize: {
    options: defaultFinishedSizes,
    maxLength: 64,
    allowCustom: true,
  },
  paperType: {
    options: ["灰芯纸", "蓝芯纸", "双铜", "白卡"],
    maxLength: 64,
    allowCustom: true,
  },
  colorCount: {
    options: ["4C+4C", "4C+1C", "4C", "1C"],
    maxLength: 32,
    allowCustom: true,
  },
  surfaceTreatment: {
    options: [
      "过油-光油",
      "过油-亮油",
      "过油-哑油",
      "过油-雾面油",
      "覆膜-光膜",
      "覆膜-哑膜",
    ],
    maxLength: 64,
    allowCustom: false,
  },
  finalMolding: {
    options: ["直角", "圆角", "异形"],
    maxLength: 64,
    allowCustom: false,
  },
  variableColor: {
    options: ["彩色", "黑色"],
    maxLength: 64,
    allowCustom: true,
  },
  variationMethod: {
    options: ["可变条形码", "可变二维码", "可变图案", "可变数字"],
    maxLength: 64,
    allowCustom: true,
  },
  dieCutDirection: {
    options: ["上", "下", "左", "右", "四边揭开"],
    maxLength: 32,
    allowCustom: true,
  },
  peelOffQuantity: {
    options: ["1", "3", "5"],
    maxLength: 10,
    allowCustom: true,
  },
  scratchOffArea: {
    options: ["彩色刮银", "银色刮银"],
    maxLength: 64,
    allowCustom: true,
  },
} satisfies Record<string, ProductAttribute>;

export type ProductAttributeField = keyof typeof productAttributes;

export function readProductAttributeOptions(
  field: ProductAttributeField,
  productType: ProductType | ""
): readonly string[] {
  if (field === "finishedSize" && productType) {
    return finishedSizesByType[productType] ?? defaultFinishedSizes;
  }
  return productAttributes[field].options;
}
