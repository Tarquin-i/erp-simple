export const seedCustomerChannels = [
  { code: "huivo_international_station", name: "汇合国际站" },
  { code: "kingwin_international_station", name: "将为国际站" },
  { code: "huivo_alibaba", name: "汇合阿里巴巴" },
  { code: "kingwin_alibaba", name: "将为阿里巴巴" },
];

export const seedCustomerDefinitions = [
  {
    companyName: "演示·星河包装科技有限公司",
    department: "a",
    owner: "a1",
    contact: "林经理",
    remark: "关注彩盒印刷质量，本周确认首轮打样方案。",
  },
  {
    companyName: "演示·青禾文创工作室",
    department: "a",
    owner: "a1",
    contact: "陈女士",
    remark: "文创礼盒采购，需提供环保纸材与工艺建议。",
  },
  {
    companyName: "演示·晨光礼品贸易有限公司",
    department: "a",
    owner: "a2",
    contact: "周经理",
    remark: "节日礼品包装项目，先报价，再确认批量订单。",
  },
  {
    companyName: "演示·远山品牌设计有限公司",
    department: "a",
    owner: "a2",
    contact: "许先生",
    remark: "长期合作客户，偏好简洁设计和稳定交期。",
  },
  {
    companyName: "演示·海棠食品有限公司",
    department: "a",
    owner: "a2",
    contact: "吴经理",
    remark: "新品外盒需要防潮处理，待确认包装尺寸。",
  },
  {
    companyName: "演示·云帆跨境商贸有限公司",
    department: "a",
    owner: "a2",
    contact: "郑女士",
    remark: "跨境电商包装，需确认运输保护与外箱要求。",
  },
  {
    companyName: "演示·锦程印务有限公司",
    department: "b",
    owner: "b1",
    contact: "唐经理",
    remark: "计划分批采购，先确认纸张与印刷色差标准。",
  },
  {
    companyName: "演示·橙光活动策划有限公司",
    department: "b",
    owner: "b1",
    contact: "何女士",
    remark: "活动物料项目，交付时间较紧，需要优先跟进。",
  },
  {
    companyName: "演示·松果创意用品有限公司",
    department: "b",
    owner: "b2",
    contact: "赵经理",
    remark: "关注定制工艺，样品确认后安排后续报价。",
  },
  {
    companyName: "演示·南风文化传媒有限公司",
    department: "b",
    owner: "b2",
    contact: "孙先生",
    remark: "品牌周边包装，待客户提供最终设计稿。",
  },
  {
    companyName: "演示·拾光日用科技有限公司",
    department: "b",
    owner: "b2",
    contact: "冯女士",
    remark: "日用品套装礼盒，需比较两种材质方案。",
  },
  {
    companyName: "演示·知行教育用品有限公司",
    department: "b",
    owner: "b2",
    contact: "陆经理",
    remark: "教学用品包装，采购数量和交付批次待确认。",
  },
] as const;

export type SeedCustomerDefinition = (typeof seedCustomerDefinitions)[number];

const additionalMethods = [
  "whatsapp",
  "linkedin",
  "kingwin_alibaba",
  "kingwin_international_station",
  "huivo_international_station",
] as const;

export function createSeedContactMethods(index: number) {
  const additionalType =
    additionalMethods[(index - 1) % additionalMethods.length];
  return [
    {
      type: "phone" as const,
      value: `1380000${String(index).padStart(4, "0")}`,
      isPrimary: true,
    },
    {
      type: "email" as const,
      value: `sales${index}@seed.example`,
      isPrimary: false,
    },
    {
      type: "wechat" as const,
      value: `demo_contact_${index}`,
      isPrimary: false,
    },
    {
      type: additionalType,
      value:
        additionalType === "whatsapp"
          ? `1390000${String(index).padStart(4, "0")}`
          : additionalType === "linkedin"
            ? `https://www.linkedin.com/in/demo-contact-${index}`
            : `demo_platform_${index}`,
      isPrimary: false,
    },
  ];
}
