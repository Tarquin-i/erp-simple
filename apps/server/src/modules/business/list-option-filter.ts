import { fail } from "../organization/errors";

export type ListOptionFilter<T extends string = string> = {
  values: T[];
  excluded: boolean;
};

/** 校验列表筛选参数，去重后按不同选项数校验运算符。省略运算符时包含所选项。 */
export function readListOptionFilter<T extends string>(
  values: string[] | undefined,
  operators: string[] | undefined,
  label: string,
  parse: (item: string) => T
): ListOptionFilter<T> | undefined {
  if (operators && operators.length > 1) {
    fail(400, `${label}筛选只接受一个运算符。`);
  }
  const operator = operators?.[0];
  if (!values?.length) {
    if (operator !== undefined) fail(400, `请选择要筛选的${label}。`);
    return;
  }
  if (values.length > 100) fail(400, `${label}筛选最多接受 100 项。`);
  const distinctValues = [...new Set(values.map(parse))];
  const multiple = distinctValues.length > 1;
  const include = multiple ? "is any of" : "is";
  const exclude = multiple ? "is none of" : "is not";
  if (operator !== undefined && operator !== include && operator !== exclude) {
    fail(400, `请选择与${label}所选项数量匹配的筛选运算符。`);
  }
  return { values: distinctValues, excluded: operator === exclude };
}
