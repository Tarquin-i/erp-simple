import {
  AsYouType,
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "@repo/phone";
import { type ComponentProps, useId } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { SearchableSelect } from "@/components/ui/searchable-select";

const countryPriority = new Map<CountryCode, number>([
  ["CN", 1],
  ["HK", 2],
  ["MO", 3],
  ["TW", 4],
]);
const countryNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const countries = getCountries()
  .map((code) => {
    const callingCode = `+${getCountryCallingCode(code)}`;
    return {
      code,
      name: code === "CN" ? "中国大陆" : (countryNames.of(code) ?? code),
      callingCode,
      keywords: `${code} ${callingCode}`,
    };
  })
  .sort(
    (a, b) =>
      (countryPriority.get(a.code) ?? 5) - (countryPriority.get(b.code) ?? 5) ||
      a.name.localeCompare(b.name, "zh-CN")
  );

/**
 * 按拨出地区识别输入中的国际前缀，并使用与保存相同的号码解析规则。
 * @param value 正在编辑的号码。
 * @param defaultCountry 未写国际区号时使用的国家或地区。
 * @returns 严格解析后的号码、国际区号和切换地区时可保留的本地号码草稿。
 */
export function readPhoneDraft(value: string, defaultCountry: CountryCode) {
  const text = value.trim();
  const input = new AsYouType(defaultCountry);
  input.input(text);
  const number = parsePhoneNumberFromString(text, {
    defaultCountry,
    extract: false,
  });
  const callingCode = input.getCallingCode();
  // 严格解析可能拒绝未输完的号码。仅对数字和拨号分隔符使用输入解析的结果。
  const nationalValue = !callingCode
    ? undefined
    : number
      ? `${number.nationalNumber}${number.ext ? ` ext. ${number.ext}` : ""}`
      : /^[+\d\s().-]+$/u.test(text)
        ? input.getNumberValue()?.slice(callingCode.length + 1)
        : undefined;
  return {
    number,
    international: input.isInternational(),
    callingCode,
    nationalValue,
  };
}

export function PhoneNumberInput({
  country,
  callingCode,
  portalContainer,
  onCountryChange,
  ...inputProps
}: ComponentProps<typeof InputGroupInput> & {
  country: CountryCode;
  callingCode?: string;
  portalContainer?: ComponentProps<typeof SearchableSelect>["container"];
  onCountryChange: (country: CountryCode) => void;
}) {
  const countryId = useId();
  const current = countries.find((option) => option.code === country);
  const internationalPrefix = callingCode ? `+${callingCode}` : undefined;
  const countryMatches =
    !internationalPrefix || current?.callingCode === internationalPrefix;
  const countryLabel = countryMatches
    ? `${current?.name ?? country} ${current?.callingCode ?? ""}`
    : internationalPrefix;

  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchableSelect
          id={countryId}
          items={countries}
          value={countryMatches ? (current ?? null) : null}
          placeholder={country}
          searchPlaceholder="搜索国家、地区或区号"
          emptyMessage="没有匹配的国家或地区"
          disabled={inputProps.disabled}
          container={portalContainer}
          compactTrigger={{
            label: !countryMatches
              ? (internationalPrefix ?? country)
              : internationalPrefix || !current
                ? country
                : `${country} ${current.callingCode}`,
            ariaLabel: `国家或地区：${countryLabel}`,
          }}
          getOptionKey={(option) => option.code}
          renderOption={(option) => (
            <>
              <span className="flex-1 truncate">{option.name}</span>
              <span className="text-muted-foreground">
                {option.callingCode}
              </span>
            </>
          )}
          onValueChange={(option) => onCountryChange(option.code)}
        />
      </InputGroupAddon>
      <InputGroupInput {...inputProps} type="tel" />
    </InputGroup>
  );
}
