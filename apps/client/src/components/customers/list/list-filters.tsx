import { useEffect, useState } from "react";

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
import { listCustomerChannels, listCustomerOwners } from "@/request/customers";
import type {
  CustomerChannel,
  CustomerListQuery,
  CustomerOwner,
  CustomerTag,
} from "@/request/customers";

import { TagFilter } from "./tag-filter";

type Filters = Pick<CustomerListQuery, "channelCode" | "tagId" | "ownerUserId">;

const allValues = "__all__";

export function CustomerListFilters({
  filters,
  selectedTag,
  onApply,
}: {
  filters: Filters;
  selectedTag?: CustomerTag;
  onApply: (filters: Filters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [options, setOptions] = useState<{
    channels: CustomerChannel[];
    owners: CustomerOwner[];
  }>();
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listCustomerChannels(controller.signal),
      listCustomerOwners(controller.signal),
    ])
      .then(([{ channels }, { owners }]) => {
        if (!controller.signal.aborted) setOptions({ channels, owners });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOptionsError(
          error instanceof Error ? error.message : "暂时无法加载筛选选项。"
        );
      });
    return () => controller.abort();
  }, [optionsRetry]);

  return (
    <div role="form" aria-label="客户筛选">
      <PopoverHeader className="border-b px-4 py-3">
        <PopoverTitle>筛选客户</PopoverTitle>
      </PopoverHeader>
      <div className="space-y-4 p-4">
        {optionsError && (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="text-xs text-destructive">{optionsError}</p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setOptionsError("");
                setOptionsRetry((value) => value + 1);
              }}
            >
              重试
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FilterSelect
            id="customer-channel-filter"
            label="渠道"
            allLabel="全部渠道"
            value={draft.channelCode}
            items={(options?.channels ?? []).map(({ code, name }) => ({
              id: code,
              name,
            }))}
            disabled={!options}
            pending={!options && !optionsError}
            onChange={(channelCode) =>
              setDraft((prev) => ({ ...prev, channelCode }))
            }
          />
          <FilterSelect
            id="customer-owner-filter"
            label="业务员"
            allLabel="全部业务员"
            value={draft.ownerUserId}
            items={options?.owners ?? []}
            disabled={!options}
            pending={!options && !optionsError}
            onChange={(ownerUserId) =>
              setDraft((prev) => ({ ...prev, ownerUserId }))
            }
          />
        </div>
        <TagFilter
          tagId={draft.tagId}
          selectedTag={selectedTag}
          onChange={(tagId) => setDraft((prev) => ({ ...prev, tagId }))}
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

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  items,
  disabled,
  pending,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value?: string;
  items: Array<{ id: string; name: string }>;
  disabled: boolean;
  pending: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const missing = value && !items.some((item) => item.id === value);

  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        disabled={disabled}
        value={value ?? allValues}
        onValueChange={(next) =>
          onChange(next === allValues ? undefined : next)
        }
      >
        <SelectTrigger id={id} className="w-full data-[size=default]:h-9">
          {pending ? (
            <span className="text-muted-foreground">正在加载…</span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValues}>{allLabel}</SelectItem>
          {missing && <SelectItem value={value}>已选{label}</SelectItem>}
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
