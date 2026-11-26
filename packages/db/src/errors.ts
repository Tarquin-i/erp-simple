/**
 * 判断错误是否来自指定的 PostgreSQL 约束。
 * @param error 捕获到的错误，可能包装了底层数据库错误。
 * @param code 要匹配的 SQLSTATE 错误码。
 * @param constraint 要匹配的数据库约束名。
 * @returns 所检查的错误对象同时匹配错误码和约束名时为 `true`，否则为 `false`。
 */
export function isConstraintError(
  error: unknown,
  code: string,
  constraint: string
) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === code &&
    "constraint_name" in cause &&
    cause.constraint_name === constraint
  );
}
