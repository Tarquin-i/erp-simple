import { UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SetStateAction } from "react";

import { useDataTableFilters } from "@/components/shared/data-table-filter";
import type {
  ColumnConfig,
  ColumnOption,
  FiltersState,
} from "@/components/shared/data-table-filter/core/types";
import { Button } from "@/components/ui/button";
import {
  listOptionLimit,
  listOptionOperator,
  listOptionValue,
  listOptionValues,
} from "@/lib/list-option-query";
import type { AddressListItem, AddressListQuery } from "@/request/addresses";
import { listCustomerOwners } from "@/request/customers";

type QueryUpdater = (previous: AddressListQuery) => AddressListQuery;

const ownerColumn = {
  id: "ownerUserId",
  type: "option",
  displayName: "业务员",
  icon: UserRound,
  flatValueOptions: true,
  accessor: () => undefined,
} satisfies ColumnConfig<AddressListItem, "option">;
const serverRows: AddressListItem[] = [];

function readFilters(query: AddressListQuery): FiltersState {
  const values = listOptionValues(query.ownerUserId);
  return values.length
    ? [
        {
          columnId: ownerColumn.id,
          type: ownerColumn.type,
          operator:
            listOptionOperator(values.length, query.ownerOperator) ?? "is",
          values,
        },
      ]
    : [];
}

/** 将所属客户的业务员选项接入地址目录的服务端筛选。 */
export function useAddressListFilters(
  query: AddressListQuery,
  onQueryChange: (update: QueryUpdater) => void
) {
  const [owners, setOwners] = useState<ColumnOption[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void listCustomerOwners(controller.signal).then(
      ({ owners }) => {
        if (!controller.signal.aborted) {
          setOwners(owners.map(({ id, name }) => ({ value: id, label: name })));
        }
      },
      () => {
        if (!controller.signal.aborted) setError(true);
      }
    );
    return () => controller.abort();
  }, [retry]);

  const onFiltersChange = useCallback(
    (update: SetStateAction<FiltersState>) =>
      onQueryChange((previous) => {
        const filters =
          typeof update === "function" ? update(readFilters(previous)) : update;
        const filter = filters.find(
          ({ columnId }) => columnId === ownerColumn.id
        );
        const values = [
          ...new Set(
            filter?.values.filter((value) => typeof value === "string")
          ),
        ];
        if (values.length > listOptionLimit) return previous;

        const current = listOptionValues(previous.ownerUserId);
        const operator = listOptionOperator(values.length, filter?.operator);
        if (
          previous.ownerOperator === operator &&
          current.length === values.length &&
          current.every((value, index) => value === values[index])
        )
          return previous;

        return {
          ...previous,
          ownerUserId: listOptionValue(values),
          ownerOperator: operator,
          page: undefined,
        };
      }),
    [onQueryChange]
  );

  const columnsConfig = useMemo(() => {
    const missing = listOptionValues(query.ownerUserId).filter(
      (id) => !owners?.some(({ value }) => value === id)
    );
    const options = [
      ...(owners ?? []),
      ...missing.map((id) => ({
        value: id,
        label: owners || error ? "所选业务员不可用" : "正在读取选项…",
      })),
    ];
    return [
      {
        ...ownerColumn,
        options,
        renderFilterValue: owners
          ? undefined
          : () => (
              <div className="flex items-center justify-between gap-2 p-3 text-sm">
                {error ? (
                  <>
                    <span role="alert" className="text-destructive">
                      暂时无法加载选项。
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setError(false);
                        setRetry((attempt) => attempt + 1);
                      }}
                    >
                      重试
                    </Button>
                  </>
                ) : (
                  <span role="status" className="text-muted-foreground">
                    正在读取选项…
                  </span>
                )}
              </div>
            ),
      },
    ] satisfies ColumnConfig<AddressListItem, "option">[];
  }, [owners, error, query.ownerUserId]);

  const filters = useMemo(() => readFilters(query), [query]);
  return useDataTableFilters({
    columnsConfig,
    strategy: "server",
    data: serverRows,
    filters,
    onFiltersChange,
  });
}
