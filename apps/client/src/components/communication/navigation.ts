function readUuidSearchParam(value: unknown) {
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  ) {
    return value.toLowerCase();
  }
  return undefined;
}

/** 读取客户页签来源，供新建、详情和编辑之间保留返回位置。 */
export function readCommunicationOrigin(search: Record<string, unknown>): {
  customerId?: string;
} {
  const customerId = readUuidSearchParam(search.customerId);
  return customerId ? { customerId } : {};
}

/** 进入恢复页时记录用户选中的提交，防止切页期间回落到普通新建。 */
export function readCommunicationCreationSearch(
  search: Record<string, unknown>
): { customerId?: string; submissionId?: string } {
  return {
    ...readCommunicationOrigin(search),
    submissionId: readUuidSearchParam(search.submissionId),
  };
}
