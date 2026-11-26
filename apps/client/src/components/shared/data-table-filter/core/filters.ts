import { isAnyOf, uniq } from '../lib/array'
import { isColumnOptionArray } from '../lib/helpers'
import { memo } from '../lib/memo'
import type {
  Column,
  ColumnConfig,
  ColumnDataType,
  ColumnOption,
  ElementType,
  FilterStrategy,
  Nullable,
  TableColumnConfig,
} from './types'

export function getColumnOptions<TData, TType extends ColumnDataType, TVal>(
  column: ColumnConfig<TData, TType, TVal>,
  data: TData[],
  strategy: FilterStrategy,
): ColumnOption[] {
  if (!isAnyOf(column.type, ['option', 'multiOption'])) {
    console.warn(
      'Column options can only be retrieved for option and multiOption columns',
    )
    return []
  }

  if (strategy === 'server' && !column.options) {
    throw new Error('column options are required for server-side filtering')
  }

  if (column.options) {
    return column.options
  }

  const filtered = data
    .flatMap(column.accessor)
    .filter((v): v is NonNullable<TVal> => v !== undefined && v !== null)

  let models = uniq(filtered)

  const orderFn = column.orderFn?.bind(column)
  if (orderFn) {
    models = models.sort((m1, m2) =>
      orderFn(
        m1 as ElementType<NonNullable<TVal>>,
        m2 as ElementType<NonNullable<TVal>>,
      ),
    )
  }

  const transformOptionFn = column.transformOptionFn?.bind(column)
  if (transformOptionFn) {
    // Memoize transformOptionFn calls
    const memoizedTransform = memo(
      () => [models],
      (deps) =>
        deps[0].map((m) =>
          transformOptionFn(m as ElementType<NonNullable<TVal>>),
        ),
    )
    return memoizedTransform()
  }

  if (isColumnOptionArray(models)) return models

  throw new Error(
    `[data-table-filter] [${column.id}] Either provide static options, a transformOptionFn, or ensure the column data conforms to ColumnOption type`,
  )
}

export function getColumnValues<TData, TType extends ColumnDataType, TVal>(
  column: ColumnConfig<TData, TType, TVal>,
  data: TData[],
) {
  // Memoize accessor calls
  const memoizedAccessor = memo(
    () => [data],
    (deps) =>
      deps[0]
        .flatMap(column.accessor)
        .filter(
          (v): v is NonNullable<TVal> => v !== undefined && v !== null,
        ) as ElementType<NonNullable<TVal>>[],
  )

  const raw = memoizedAccessor()

  if (!isAnyOf(column.type, ['option', 'multiOption'])) {
    return raw
  }

  if (column.options) {
    return raw
      .map((v) => column.options?.find((o) => o.value === v)?.value)
      .filter((v) => v !== undefined && v !== null)
  }

  const transformOptionFn = column.transformOptionFn?.bind(column)
  if (transformOptionFn) {
    const memoizedTransform = memo(
      () => [raw],
      (deps) =>
        deps[0].map(
          (v) => transformOptionFn(v) as ElementType<NonNullable<TVal>>,
        ),
    )
    return memoizedTransform()
  }

  if (isColumnOptionArray(raw)) {
    return raw
  }

  throw new Error(
    `[data-table-filter] [${column.id}] Either provide static options, a transformOptionFn, or ensure the column data conforms to ColumnOption type`,
  )
}

export function getFacetedUniqueValues<
  TData,
  TType extends ColumnDataType,
  TVal,
>(
  column: ColumnConfig<TData, TType, TVal>,
  values: readonly unknown[],
  strategy: FilterStrategy,
): Map<string, number> | undefined {
  if (!isAnyOf(column.type, ['option', 'multiOption'])) {
    console.warn(
      'Faceted unique values can only be retrieved for option and multiOption columns',
    )
    return new Map<string, number>()
  }

  if (strategy === 'server') {
    return column.facetedOptions
  }

  const acc = new Map<string, number>()

  if (isColumnOptionArray(values)) {
    for (const option of values) {
      const curr = acc.get(option.value) ?? 0
      acc.set(option.value, curr + 1)
    }
  } else {
    for (const option of values) {
      if (typeof option !== 'string') continue
      const curr = acc.get(option) ?? 0
      acc.set(option, curr + 1)
    }
  }

  return acc
}

export function getFacetedMinMaxValues<
  TData,
  TType extends ColumnDataType,
  TVal,
>(
  column: ColumnConfig<TData, TType, TVal>,
  data: TData[],
  strategy: FilterStrategy,
): [number, number] | undefined {
  if (column.type !== 'number') return undefined // Only applicable to number columns

  if (typeof column.min === 'number' && typeof column.max === 'number') {
    return [column.min, column.max]
  }

  if (strategy === 'server') {
    return undefined
  }

  const values = data
    .flatMap((row) => column.accessor(row) as Nullable<number>)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))

  if (values.length === 0) {
    return [0, 0] // Fallback to config or reasonable defaults
  }

  const min = Math.min(...values)
  const max = Math.max(...values)

  return [min, max]
}

export function createColumns<TData>(
  data: TData[],
  columnConfigs: ReadonlyArray<TableColumnConfig<TData>>,
  strategy: FilterStrategy,
): Column<TData>[] {
  return columnConfigs.map((config) => {
    // Values passed to these callbacks come from the same column's accessor.
    const columnConfig = config as ColumnConfig<TData>
    const getOptions: () => ColumnOption[] = memo(
      () => [data, strategy, columnConfig.options] as const,
      ([data, strategy]) => getColumnOptions(columnConfig, data, strategy),
    )

    const getValues = memo(
      () => [data, strategy],
      () => (strategy === 'client' ? getColumnValues(columnConfig, data) : []),
    )

    const getUniqueValues: () => Map<string, number> | undefined = memo(
      () => [getValues(), strategy] as const,
      ([values, strategy]) =>
        getFacetedUniqueValues(columnConfig, values, strategy),
    )

    const getMinMaxValues: () => [number, number] | undefined = memo(
      () => [data, strategy],
      () => getFacetedMinMaxValues(columnConfig, data, strategy),
    )

    // Create the Column instance
    const column: Column<TData> = {
      ...columnConfig,
      getOptions,
      getValues,
      getFacetedUniqueValues: getUniqueValues,
      getFacetedMinMaxValues: getMinMaxValues,
      // Prefetch methods will be added below
      prefetchOptions: async () => {}, // Placeholder, defined below
      prefetchValues: async () => {},
      prefetchFacetedUniqueValues: async () => {},
      prefetchFacetedMinMaxValues: async () => {},
      _prefetchedOptionsCache: null, // Initialize private cache
      _prefetchedValuesCache: null,
      _prefetchedFacetedUniqueValuesCache: null,
      _prefetchedFacetedMinMaxValuesCache: null,
    }

    if (strategy === 'client') {
      // Define prefetch methods with access to the column instance
      column.prefetchOptions = async (): Promise<void> => {
        if (!column._prefetchedOptionsCache) {
          await new Promise((resolve) =>
            setTimeout(() => {
              const options = getOptions()
              column._prefetchedOptionsCache = options
              // console.log(`Prefetched options for ${columnConfig.id}`)
              resolve(undefined)
            }, 0),
          )
        }
      }

      column.prefetchValues = async (): Promise<void> => {
        if (!column._prefetchedValuesCache) {
          await new Promise((resolve) =>
            setTimeout(() => {
              const values = getValues()
              column._prefetchedValuesCache = values
              // console.log(`Prefetched values for ${columnConfig.id}`)
              resolve(undefined)
            }, 0),
          )
        }
      }

      column.prefetchFacetedUniqueValues = async (): Promise<void> => {
        if (!column._prefetchedFacetedUniqueValuesCache) {
          await new Promise((resolve) =>
            setTimeout(() => {
              const facetedMap = getUniqueValues()
              column._prefetchedFacetedUniqueValuesCache = facetedMap ?? null
              // console.log(
              //   `Prefetched faceted unique values for ${columnConfig.id}`,
              // )
              resolve(undefined)
            }, 0),
          )
        }
      }

      column.prefetchFacetedMinMaxValues = async (): Promise<void> => {
        if (!column._prefetchedFacetedMinMaxValuesCache) {
          await new Promise((resolve) =>
            setTimeout(() => {
              const value = getMinMaxValues()
              column._prefetchedFacetedMinMaxValuesCache = value ?? null
              // console.log(
              //   `Prefetched faceted min/max values for ${columnConfig.id}`,
              // )
              resolve(undefined)
            }, 0),
          )
        }
      }
    }

    return column
  })
}
