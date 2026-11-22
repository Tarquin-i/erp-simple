declare module "@tanstack/react-router" {
  interface HistoryState {
    communicationEditFromDetail?: string;
  }
}

function readUuidSearchParam(value: unknown) {
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  ) {
    return value.toLowerCase();
  }
  return undefined;
}

/** 校验分页参数，第一页由列表使用默认值。 */
export function readCommunicationPage(value: unknown) {
  const page =
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value))
      ? Number(value)
      : undefined;
  return page !== undefined &&
    Number.isInteger(page) &&
    page > 1 &&
    page <= 1_000_000
    ? page
    : undefined;
}

export type CommunicationOrigin = {
  customerId?: string;
  communicationPage?: number;
};

/** 读取客户页签来源，供新建、详情和编辑之间保留返回位置。 */
export function readCommunicationOrigin(
  search: Record<string, unknown>
): CommunicationOrigin {
  const customerId = readUuidSearchParam(search.customerId);
  return customerId
    ? {
        customerId,
        communicationPage: readCommunicationPage(search.communicationPage),
      }
    : {};
}

/** 进入恢复页时记录用户选中的提交，防止切页期间回落到普通新建。 */
export function readCommunicationCreationSearch(
  search: Record<string, unknown>
): CommunicationOrigin & { submissionId?: string } {
  return {
    ...readCommunicationOrigin(search),
    submissionId: readUuidSearchParam(search.submissionId),
  };
}
