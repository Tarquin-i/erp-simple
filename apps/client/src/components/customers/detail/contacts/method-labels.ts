import type { CustomerContactMethodType } from "@/request/customers";

export const contactMethodLabels: Record<CustomerContactMethodType, string> = {
  phone: "电话",
  email: "邮箱",
  wechat: "微信",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  kingwin_alibaba: "将为阿里巴巴",
  kingwin_international_station: "将为国际站",
  huivo_international_station: "汇合国际站",
};
