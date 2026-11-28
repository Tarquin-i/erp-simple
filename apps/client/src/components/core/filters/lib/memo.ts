export function memo<TDeps extends readonly unknown[], TResult>(
  getDeps: () => TDeps,
  compute: (deps: TDeps) => TResult
): () => TResult {
  let cached: { deps: TDeps; result: TResult } | undefined;

  return () => {
    const deps = getDeps();
    if (cached && shallowEqual(cached.deps, deps)) return cached.result;

    const result = compute(deps);
    cached = { deps, result };
    return result;
  };
}

function shallowEqual<T>(arr1: readonly T[], arr2: readonly T[]): boolean {
  if (arr1 === arr2) return true;
  if (arr1.length !== arr2.length) return false;

  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return false;
  }
  return true;
}
