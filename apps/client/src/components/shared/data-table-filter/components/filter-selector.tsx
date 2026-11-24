import {
  FilterMenuCheckbox,
  FilterMenuCommand,
  FilterMenuContent,
  FilterMenuSearch,
} from '@/components/shared/filter-menu'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ChevronRightIcon, FilterIcon } from 'lucide-react'
import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import React from 'react'
import type {
  Column,
  ColumnDataType,
  DataTableFilterActions,
  FilterStrategy,
  FiltersState,
} from '../core/types'
import { isAnyOf } from '../lib/array'
import { getColumn } from '../lib/helpers'
import { type Locale, t } from '../lib/i18n'
import { FilterValueController } from './filter-value'

interface FilterSelectorProps<TData> {
  filters: FiltersState
  columns: Column<TData>[]
  actions: DataTableFilterActions
  strategy: FilterStrategy
  locale?: Locale
  trigger?: React.ReactElement
  align?: 'start' | 'center' | 'end'
}

export const FilterSelector = memo(__FilterSelector) as typeof __FilterSelector

function __FilterSelector<TData>({
  filters,
  columns,
  actions,
  strategy,
  locale = 'en',
  trigger,
  align = 'start',
}: FilterSelectorProps<TData>) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [property, setProperty] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  const column = property ? getColumn(columns, property) : undefined
  const filter = property
    ? filters.find((f) => f.columnId === property)
    : undefined

  const hasFilters = filters.length > 0
  const flat = columns.some((column) => column.flatValueOptions)
  const MenuCommand = flat ? FilterMenuCommand : Command
  const MenuSearch = flat ? FilterMenuSearch : CommandInput

  useEffect(() => {
    if (property && inputRef) {
      inputRef.current?.focus()
      setValue('')
    }
  }, [property])

  // biome-ignore lint/correctness/useExhaustiveDependencies: need filters to be updated
  const content = useMemo(
    () =>
      property && column ? (
        <FilterValueController
          filter={filter}
          column={column as Column<TData, ColumnDataType>}
          actions={actions}
          strategy={strategy}
          locale={locale}
        />
      ) : (
        <MenuCommand
          loop
          filter={(value, search, keywords) => {
            const extendValue = `${value} ${keywords?.join(' ')}`
            return extendValue.toLowerCase().includes(search.toLowerCase())
              ? 1
              : 0
          }}
        >
          <MenuSearch
            value={value}
            onValueChange={setValue}
            ref={inputRef}
            placeholder={t('search', locale)}
          />
          <CommandEmpty>{t('noresults', locale)}</CommandEmpty>
          <CommandList className={flat ? undefined : 'max-h-fit'}>
            <CommandGroup>
              {columns.map((column) => (
                <FilterableColumn
                  key={column.id}
                  column={column}
                  setProperty={setProperty}
                />
              ))}
              <QuickSearchFilters
                search={value}
                filters={filters}
                columns={columns}
                actions={actions}
                strategy={strategy}
                locale={locale}
              />
            </CommandGroup>
          </CommandList>
        </MenuCommand>
      ),
    [
      property,
      column,
      filter,
      filters,
      columns,
      actions,
      strategy,
      locale,
      value,
      flat,
      MenuCommand,
      MenuSearch,
    ],
  )

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setValue('')
          setProperty(undefined)
        }
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            className={cn('h-7', hasFilters && 'w-fit !px-2')}
          >
            <FilterIcon className="size-4" />
            {!hasFilters && <span>{t('filter', locale)}</span>}
          </Button>
        )}
      </PopoverTrigger>
      <FilterMenuContent flat={flat} align={align} side="bottom">
        {content}
      </FilterMenuContent>
    </Popover>
  )
}

export function FilterableColumn<TData, TType extends ColumnDataType, TVal>({
  column,
  setProperty,
}: {
  column: Column<TData, TType, TVal>
  setProperty: (value: string) => void
}) {
  const itemRef = useRef<HTMLDivElement>(null)

  const prefetch = useCallback(() => {
    column.prefetchOptions()
    column.prefetchValues()
    column.prefetchFacetedUniqueValues()
    column.prefetchFacetedMinMaxValues()
  }, [column])

  useEffect(() => {
    const target = itemRef.current

    if (!target) return

    // Set up MutationObserver
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const isSelected = target.getAttribute('data-selected') === 'true'
          if (isSelected) prefetch()
        }
      }
    })

    // Set up observer
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['data-selected'],
    })

    // Cleanup on unmount
    return () => observer.disconnect()
  }, [prefetch])

  return (
    <CommandItem
      ref={itemRef}
      value={column.id}
      keywords={[column.displayName]}
      onSelect={() => setProperty(column.id)}
      onMouseEnter={prefetch}
    >
      <div className="inline-flex items-center gap-1.5">
        <column.icon strokeWidth={2.25} className="size-4" />
        <span>{column.displayName}</span>
      </div>
    </CommandItem>
  )
}

interface QuickSearchFiltersProps<TData> {
  search?: string
  filters: FiltersState
  columns: Column<TData>[]
  actions: DataTableFilterActions
  strategy: FilterStrategy
  locale?: Locale
}

export const QuickSearchFilters = memo(
  __QuickSearchFilters,
) as typeof __QuickSearchFilters

function __QuickSearchFilters<TData>({
  search,
  filters,
  columns,
  actions,
  strategy,
  locale = 'en',
}: QuickSearchFiltersProps<TData>) {
  if (!search || search.trim().length < 2) return null

  const cols = columns.filter((column) =>
    isAnyOf<ColumnDataType>(column.type, ['option', 'multiOption']),
  )

  return (
    <>
      {cols.map((column) => {
        const filter = filters.find((f) => f.columnId === column.id)
        const options = column.getOptions()
        const optionsCount = column.getFacetedUniqueValues()

        function handleOptionSelect(value: string, check: boolean) {
          if (check) actions.addFilterValue(column, [value])
          else actions.removeFilterValue(column, [value])
        }

        return (
          <React.Fragment key={column.id}>
            {options.map((v) => {
              const checked = Boolean(filter?.values.includes(v.value))
              const count = optionsCount?.get(v.value)

              return (
                <CommandItem
                  key={v.value}
                  value={v.value}
                  keywords={[v.label, v.value]}
                  onSelect={() => {
                    handleOptionSelect(v.value, !checked)
                  }}
                  className="group"
                  aria-checked={column.flatValueOptions ? checked : undefined}
                >
                  <div className="flex items-center gap-1.5 group">
                    {column.flatValueOptions ? (
                      <FilterMenuCheckbox checked={checked} />
                    ) : (
                      <Checkbox
                        checked={checked}
                        className="opacity-0 data-[state=checked]:opacity-100 group-data-[selected=true]:opacity-100 dark:border-ring mr-1"
                      />
                    )}
                    <div className="flex items-center w-4 justify-center">
                      {v.icon &&
                        (isValidElement(v.icon) ? (
                          v.icon
                        ) : (
                          <v.icon className="size-4 text-primary" />
                        ))}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <span className="text-muted-foreground">
                        {column.displayName}
                      </span>
                      <ChevronRightIcon className="size-3.5 text-muted-foreground/75" />
                      <span>
                        {v.label}
                        <sup
                          className={cn(
                            count == null && 'hidden',
                            'ml-0.5 tabular-nums tracking-tight text-muted-foreground',
                            count === 0 && 'slashed-zero',
                          )}
                        >
                          {typeof count === 'number'
                            ? (count < 100 ? count : '100+')
                            : ''}
                        </sup>
                      </span>
                    </div>
                  </div>
                </CommandItem>
              )
            })}
          </React.Fragment>
        )
      })}
    </>
  )
}
