import {
  listOptionOperator,
  listOptionValue,
  readListOptionValues,
} from "@/lib/list-option-query";
import { readListPageSize } from "@/lib/list-page-size";
import { communicationStatusLabels } from "@/request/communication";
import type {
  CommunicationListQuery,
  CommunicationStatus,
} from "@/request/communication";

import { readCommunicationPage } from "../navigation";

declare module "@tanstack/react-router" {
  interface HistoryState {
    communicationListQuery?: CommunicationListQuery;
    communicationRecoveryMessage?: string;
  }
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function searchText(value: unknown, limit: number) {
  if (typeof value !== "string") return undefined;
  return value.replaceAll("\0", "").trim().slice(0, limit) || undefined;
}

/** 清理链接或历史状态中的列表条件，避免把非法值传给接口。 */
export function parseCommunicationListQuery(
  search: Record<string, unknown>
): CommunicationListQuery {
  const statuses = readListOptionValues(search.status, (value) => {
    const status = searchText(value, 16);
    return status && Object.hasOwn(communicationStatusLabels, status)
      ? (status as CommunicationStatus)
      : undefined;
  });
  const tags = readListOptionValues(search.tagId, (value) => {
    const tag = searchText(value, 36);
    return tag && uuidPattern.test(tag) ? tag.toLowerCase() : undefined;
  });
  const owners = readListOptionValues(search.ownerUserId, (value) =>
    searchText(value, 128)
  );

  return {
    search: searchText(
      typeof search.search === "number" ? String(search.search) : search.search,
      256
    ),
    status: listOptionValue(statuses),
    statusOperator: listOptionOperator(statuses.length, search.statusOperator),
    tagId: listOptionValue(tags),
    tagOperator: listOptionOperator(tags.length, search.tagOperator),
    ownerUserId: listOptionValue(owners),
    ownerOperator: listOptionOperator(owners.length, search.ownerOperator),
    page: readCommunicationPage(search.page),
    pageSize: readListPageSize(search.pageSize),
  };
}

/** 恢复从独立沟通列表进入新建或详情前的查询条件。 */
export function readCommunicationListQueryFromState(
  state: unknown
): CommunicationListQuery {
  if (
    !state ||
    typeof state !== "object" ||
    !("communicationListQuery" in state)
  )
    return {};
  const { communicationListQuery } = state;
  return communicationListQuery && typeof communicationListQuery === "object"
    ? parseCommunicationListQuery(
        communicationListQuery as Record<string, unknown>
      )
    : {};
}
