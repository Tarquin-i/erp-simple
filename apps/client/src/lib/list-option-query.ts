export type ListOptionOperator = "is" | "is not" | "is any of" | "is none of";
export type ListOptionValue<T extends string = string> = T | T[];

export const listOptionLimit = 100;

export function listOptionValues<T extends string>(
  value: ListOptionValue<T> | undefined
) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function listOptionValue<T extends string>(values: T[]) {
  return values.length > 1 ? values : values[0];
}

/** 按选中项数量规范化运算符，保留包含或排除语义。单项包含是接口的默认值。 */
export function listOptionOperator(
  count: number,
  operator: unknown
): ListOptionOperator | undefined {
  if (!count) return undefined;
  const excluded = operator === "is not" || operator === "is none of";
  if (count === 1) return excluded ? "is not" : undefined;
  return excluded ? "is none of" : "is any of";
}

export function readListOptionValues<T extends string>(
  value: unknown,
  parse: (entry: unknown) => T | undefined
) {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values.flatMap((entry) => {
        const parsed = parse(typeof entry === "number" ? String(entry) : entry);
        return parsed === undefined ? [] : [parsed];
      })
    ),
  ].slice(0, listOptionLimit);
}
