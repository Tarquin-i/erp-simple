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
  const tagId = searchText(search.tagId, 36);
  const status = searchText(search.status, 16);

  return {
    search: searchText(
      typeof search.search === "number" ? String(search.search) : search.search,
      256
    ),
    status:
      status && Object.hasOwn(communicationStatusLabels, status)
        ? (status as CommunicationStatus)
        : undefined,
    tagId: tagId && uuidPattern.test(tagId) ? tagId.toLowerCase() : undefined,
    ownerUserId: searchText(search.ownerUserId, 128),
    page: readCommunicationPage(search.page),
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
