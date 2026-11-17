/** 读取客户页签来源，供新建、详情和编辑之间保留返回位置。 */
export function readCommunicationOrigin(search: Record<string, unknown>): {
  customerId?: string;
} {
  const { customerId } = search;
  if (
    typeof customerId === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(customerId)
  ) {
    return { customerId: customerId.toLowerCase() };
  }
  return {};
}
