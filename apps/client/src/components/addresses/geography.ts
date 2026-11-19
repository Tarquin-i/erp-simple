import { allCountries } from "country-region-data";
import type { Region } from "country-region-data";
import { format, getAllCountries } from "postal-code-checker";

type GeographyOption = {
  code: string;
  name: string;
  keywords: string;
};

const countryDisplayNames = new Intl.DisplayNames(["zh-CN"], {
  type: "region",
  fallback: "none",
});
const chinaRegionNames: Record<string, string> = {
  AH: "安徽省",
  BJ: "北京市",
  CQ: "重庆市",
  FJ: "福建省",
  GD: "广东省",
  GS: "甘肃省",
  GX: "广西壮族自治区",
  GZ: "贵州省",
  HA: "河南省",
  HB: "湖北省",
  HE: "河北省",
  HI: "海南省",
  HK: "香港特别行政区",
  HL: "黑龙江省",
  HN: "湖南省",
  JL: "吉林省",
  JS: "江苏省",
  JX: "江西省",
  LN: "辽宁省",
  MO: "澳门特别行政区",
  NM: "内蒙古自治区",
  NX: "宁夏回族自治区",
  QH: "青海省",
  SC: "四川省",
  SD: "山东省",
  SH: "上海市",
  SN: "陕西省",
  SX: "山西省",
  TJ: "天津市",
  TW: "台湾省",
  XJ: "新疆维吾尔自治区",
  XZ: "西藏自治区",
  YN: "云南省",
  ZJ: "浙江省",
};

const postalCountries = new Set(
  getAllCountries().map(({ countryCode }) => countryCode)
);
const supportedCountries = allCountries.filter(([, code]) =>
  postalCountries.has(code)
);
const regionsByCountry = new Map<string, Region[]>(
  supportedCountries.map(([, code, regions]) => [code, regions])
);

/** 与后端使用同一份国家和地区范围，显示名称支持中文搜索。 */
export const addressCountries: readonly GeographyOption[] =
  supportedCountries.map(([name, code]) => ({
    code,
    name: countryDisplayNames.of(code) ?? name,
    keywords: `${code} ${name}`,
  }));

/**
 * 读取国家或地区的一级行政区选项。国内使用省级中文名称。
 * @param countryCode 双字母国家或地区代码。
 * @returns 行政区选项。数据源没有该国家或地区时返回空数组。
 */
export function getAddressRegions(
  countryCode: string
): readonly GeographyOption[] {
  const code = countryCode.toUpperCase();
  const regions = regionsByCountry.get(code) ?? [];
  return regions.map(([name, regionCode]) => ({
    code: regionCode,
    name: (code === "CN" ? chinaRegionNames[regionCode] : undefined) ?? name,
    keywords: `${regionCode} ${name}`,
  }));
}

/**
 * 按后端的国家或地区规则校验并规范化邮编。
 * @param countryCode 双字母国家或地区代码。
 * @param postalCode 用户输入的邮编。
 * @returns 规范化后的邮编，格式无效时返回 null。
 */
export function formatAddressPostalCode(
  countryCode: string,
  postalCode: string
) {
  if (!regionsByCountry.has(countryCode.toUpperCase())) return null;
  const formatted = format(countryCode, postalCode);
  return formatted && formatted.length <= 32 ? formatted : null;
}
