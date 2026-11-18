import {
  AsYouType,
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "@repo/phone";
import { ChevronDown } from "lucide-react";
import { type ComponentProps, useState } from "react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const countryPriority = new Map<CountryCode, number>([
  ["CN", 1],
  ["HK", 2],
  ["MO", 3],
  ["TW", 4],
]);
const countryNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const countries = getCountries()
  .map((code) => ({
    code,
    name: code === "CN" ? "中国大陆" : (countryNames.of(code) ?? code),
    callingCode: `+${getCountryCallingCode(code)}`,
  }))
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
  onCountryChange,
  ...inputProps
}: ComponentProps<typeof InputGroupInput> & {
  country: CountryCode;
  callingCode?: string;
  onCountryChange: (country: CountryCode) => void;
}) {
  const [open, setOpen] = useState(false);
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
        <Popover open={open && !inputProps.disabled} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <InputGroupButton
              aria-label={`国家或地区：${countryLabel}`}
              disabled={inputProps.disabled}
            >
              {!countryMatches
                ? internationalPrefix
                : internationalPrefix || !current
                  ? country
                  : `${country} ${current.callingCode}`}
              <ChevronDown aria-hidden="true" />
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 gap-1 p-1.5">
            <Combobox
              inline
              open
              autoHighlight
              defaultInputValue=""
              items={countries}
              value={countryMatches ? (current ?? null) : null}
              itemToStringLabel={({ name, code, callingCode }) =>
                `${name} ${code} ${callingCode}`
              }
              onValueChange={(option) => {
                if (!option) return;
                onCountryChange(option.code);
                setOpen(false);
              }}
            >
              <ComboboxInput
                aria-label="搜索国家、地区或区号"
                placeholder="搜索国家、地区或区号"
                showTrigger={false}
                className="w-full [&_[data-slot=input-group-addon]:empty]:hidden"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229)
                  ) {
                    event.preventBaseUIHandler();
                  }
                }}
              />
              <ComboboxEmpty className="not-empty:flex">
                没有匹配的国家或地区
              </ComboboxEmpty>
              <ComboboxList className="max-h-56">
                {(option) => (
                  <ComboboxItem key={option.code} value={option}>
                    <span className="flex-1 truncate">{option.name}</span>
                    <span className="text-muted-foreground">
                      {option.callingCode}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </Combobox>
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
      <InputGroupInput {...inputProps} type="tel" />
    </InputGroup>
  );
}
