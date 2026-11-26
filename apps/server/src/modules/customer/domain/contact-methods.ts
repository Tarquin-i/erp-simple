interface PrimaryMethod {
  id: string;
  isPrimary: boolean;
}

// 仅邮箱可以有多条，重复邮箱按去空格、忽略大小写判断。
export function rememberContactMethod(
  seen: Set<string>,
  { type, value }: { type: string; value: string }
) {
  const key = type === "email" ? `email:${value.trim().toLowerCase()}` : type;
  if (seen.has(key)) {
    return type === "email" ? "contactDuplicateEmail" : "contactDuplicateType";
  }
  seen.add(key);
}

export function preparePrimaryMethods<T extends { isPrimary?: boolean }>(
  methods: T[],
  editing: boolean
) {
  const primaryCount = methods.filter((method) => method.isPrimary).length;
  if (primaryCount > 1) {
    return { ok: false, reason: "contactMultiplePrimary" } as const;
  }
  if (editing && methods.length > 0 && primaryCount === 0) {
    return { ok: false, reason: "contactPrimaryRequired" } as const;
  }
  return {
    ok: true,
    methods: methods.map((method, index) => ({
      ...method,
      isPrimary: primaryCount === 0 ? index === 0 : method.isPrimary === true,
    })),
  } as const;
}

export function hasConflictingMethodType(
  methods: readonly { id: string; type: string }[],
  methodId: string,
  type: string
) {
  return (
    type !== "email" &&
    methods.some((method) => method.id !== methodId && method.type === type)
  );
}

export function shouldAddPrimaryMethod(
  methods: readonly { isPrimary: boolean }[],
  requestedPrimary: boolean | undefined
) {
  return (
    requestedPrimary === true || !methods.some((method) => method.isPrimary)
  );
}

/** 候选按持久层提供的创建时间、ID 顺序递补。 */
export function findNextPrimaryMethod<T extends PrimaryMethod>(
  methods: readonly T[],
  excludedId?: string
) {
  return methods.find((method) => method.id !== excludedId);
}

export function planPrimaryMethodChange(
  methods: readonly PrimaryMethod[],
  current: PrimaryMethod,
  requestedPrimary: boolean | undefined,
  restoredPrimary?: PrimaryMethod
) {
  const primary = restoredPrimary
    ? restoredPrimary.id === current.id
    : requestedPrimary;
  const replacement = restoredPrimary
    ? restoredPrimary.id !== current.id && !restoredPrimary.isPrimary
      ? restoredPrimary
      : undefined
    : primary === false && current.isPrimary
      ? findNextPrimaryMethod(methods, current.id)
      : undefined;
  if (primary === false && current.isPrimary && !replacement) {
    return { ok: false, reason: "contactOnlyMethodPrimary" } as const;
  }
  return {
    ok: true,
    primary,
    replacementId: replacement?.id,
    clearPrevious: primary === true || Boolean(restoredPrimary && replacement),
  } as const;
}
