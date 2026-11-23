import { useEffect, useState } from "react";

import { TagSelector } from "@/components/customers/list/tag-selector";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  communicationStatusLabels,
  getCommunicationTag,
  listCommunicationOwners,
  listCommunicationTags,
} from "@/request/communication";
import type {
  CommunicationListQuery,
  CommunicationListTag,
  CommunicationStatus,
} from "@/request/communication";

export type CommunicationFilters = Pick<
  CommunicationListQuery,
  "status" | "tagId" | "ownerUserId"
>;

const all = "__all__";
const statusChoices = Object.entries(communicationStatusLabels);

export function CommunicationListFilters({
  filters,
  selectedTag,
  onApply,
}: {
  filters: CommunicationFilters;
  selectedTag?: CommunicationListTag;
  onApply: (filters: CommunicationFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [owners, setOwners] =
    useState<Awaited<ReturnType<typeof listCommunicationOwners>>["owners"]>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void listCommunicationOwners(controller.signal).then(
      ({ owners }) => {
        if (!controller.signal.aborted) setOwners(owners);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "暂时无法加载业务员。"
          );
      }
    );
    return () => controller.abort();
  }, [retry]);

  const missingOwner =
    draft.ownerUserId && !owners?.some(({ id }) => id === draft.ownerUserId);

  return (
    <div role="form" aria-label="沟通筛选">
      <PopoverHeader className="border-b px-4 py-3">
        <PopoverTitle>筛选沟通</PopoverTitle>
      </PopoverHeader>
      <div className="space-y-4 p-4">
        {error && (
          <div className="flex items-center justify-between gap-3" role="alert">
            <span className="text-xs text-destructive">{error}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setError("");
                setRetry((attempt) => attempt + 1);
              }}
            >
              重试
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-2">
            <Label
              htmlFor="communication-status-filter"
              preventControlActivation
            >
              状态
            </Label>
            <Select
              value={draft.status ?? all}
              onValueChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  status:
                    value === all ? undefined : (value as CommunicationStatus),
                }))
              }
            >
              <SelectTrigger
                id="communication-status-filter"
                className="w-full data-[size=default]:h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={all}>全部状态</SelectItem>
                {statusChoices.map(([status, label]) => (
                  <SelectItem key={status} value={status}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-2">
            <Label
              htmlFor="communication-owner-filter"
              preventControlActivation
            >
              业务员
            </Label>
            <Select
              disabled={!owners}
              value={draft.ownerUserId ?? all}
              onValueChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  ownerUserId: value === all ? undefined : value,
                }))
              }
            >
              <SelectTrigger
                id="communication-owner-filter"
                className="w-full data-[size=default]:h-9"
              >
                {owners || error ? (
                  <SelectValue />
                ) : (
                  <span className="text-muted-foreground">正在加载…</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={all}>全部业务员</SelectItem>
                {missingOwner && draft.ownerUserId && (
                  <SelectItem value={draft.ownerUserId}>已选业务员</SelectItem>
                )}
                {owners?.map(({ id, name }) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <TagSelector
          tagId={draft.tagId}
          selectedTag={selectedTag}
          loadTags={listCommunicationTags}
          loadTag={getCommunicationTag}
          inputId="communication-tag-filter"
          onChange={(tagId) => setDraft((previous) => ({ ...previous, tagId }))}
        />
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <Button type="button" variant="ghost" onClick={() => onApply({})}>
          重置
        </Button>
        <Button type="button" onClick={() => onApply(draft)}>
          应用筛选
        </Button>
      </div>
    </div>
  );
}
