import type { SeedCustomerDefinition } from "./customer-definitions";

export const seedCommunicationStatuses = [
  "pending",
  "urgent",
  "completed",
] as const;

export const seedCommunicationTemplates = [
  {
    subject: "包装需求确认",
    summary: (definition: SeedCustomerDefinition) =>
      `演示沟通：已与${definition.contact}确认初步需求。\n${definition.remark}\n下一步：整理规格、数量和工艺要求，发送确认清单。`,
  },
  {
    subject: "样品报价与交期确认",
    summary: () =>
      `演示沟通：由同部门同事协助跟进样品和报价。\n客户希望比较两种包装方案，需确认样品费用与预计交期。\n下一步：汇总反馈并更新沟通状态。`,
  },
] as const;
