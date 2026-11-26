import { allCountries } from "country-region-data";
import { format, getAllCountries } from "postal-code-checker";

const postalCountries = new Set(
  getAllCountries().map(({ countryCode }) => countryCode)
);
const supportedCountries = new Map<string, string>(
  allCountries
    .filter(([, code]) => postalCountries.has(code))
    .map(([name, code]) => [code, name])
);

type PostalAddress = {
  countryCode: string;
  province: string | null;
  city: string;
  district: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
};

export function normalizeCountryCode(code: string) {
  const normalized = code.toUpperCase();
  return /^[A-Za-z]{2}$/u.test(code) && supportedCountries.has(normalized)
    ? normalized
    : undefined;
}

/** 按国家或地区规范化已填写的邮编，保留前导零和字母。 */
export function normalizePostalCode(countryCode: string, postalCode: string) {
  const formatted = format(countryCode, postalCode);
  return formatted && formatted.length <= 32 ? formatted : undefined;
}

/** 根据地区变化计算需要重新填写和清空的地址字段。 */
export function resolvePostalAddressPatch(
  address: Pick<PostalAddress, "countryCode" | "province">,
  input: Partial<PostalAddress>
) {
  const countryChanged =
    input.countryCode !== undefined &&
    input.countryCode !== address.countryCode;
  const provinceChanged =
    input.province !== undefined && input.province !== address.province;
  const locationChanged = countryChanged || provinceChanged;

  if (locationChanged && input.city === undefined) {
    return {
      ok: false,
      reason: countryChanged
        ? "countryChangeRequiresCity"
        : "provinceChangeRequiresCity",
    } as const;
  }

  const nextPostalCode = locationChanged
    ? (input.postalCode ?? null)
    : input.postalCode;
  const postalCode =
    nextPostalCode != null
      ? normalizePostalCode(
          input.countryCode ?? address.countryCode,
          nextPostalCode
        )
      : nextPostalCode;
  if (nextPostalCode != null && postalCode === undefined) {
    return { ok: false, reason: "invalidPostalCode" } as const;
  }
  return {
    ok: true,
    fields: {
      province: countryChanged ? (input.province ?? null) : input.province,
      district: locationChanged ? (input.district ?? null) : input.district,
      postalCode,
    },
  } as const;
}

/** 按中国或国际地址顺序拼接非空地址字段，保留邮编。 */
export function formatAddress(address: PostalAddress) {
  const {
    countryCode,
    province,
    city,
    district,
    addressLine1,
    addressLine2,
    postalCode,
  } = address;
  if (countryCode === "CN") {
    const location = [
      "中国",
      province,
      city,
      district,
      addressLine1,
      addressLine2,
    ]
      .filter(Boolean)
      .join("");
    return [location, postalCode].filter(Boolean).join(" ");
  }

  const countryName = supportedCountries.get(countryCode) ?? countryCode;
  return [
    addressLine2,
    addressLine1,
    district,
    city,
    province,
    postalCode,
    countryName,
  ]
    .filter(Boolean)
    .join(", ");
}
