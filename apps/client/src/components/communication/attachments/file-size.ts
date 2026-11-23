const fileSizeFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
});

/**
 * 将附件字节数转换为适合页面展示的大小。
 * @param bytes 非负的附件字节数。
 * @returns 以 B、KB 或 MB 为单位的文本。
 */
export function formatFileSize(bytes: number) {
  const kibibytes = bytes / 1024;
  if (kibibytes < 1) return `${bytes} B`;
  if (kibibytes < 1024) return `${fileSizeFormat.format(kibibytes)} KB`;
  return `${fileSizeFormat.format(kibibytes / 1024)} MB`;
}

/** 用完整的单位表示上限，避免四舍五入使提示与实际字节数不符。 */
export function formatAttachmentUploadLimit(bytes: number) {
  for (const [unit, factor] of [
    ["GiB", 1024 ** 3],
    ["MiB", 1024 ** 2],
    ["KiB", 1024],
  ] as const) {
    if (bytes % factor === 0)
      return `${fileSizeFormat.format(bytes / factor)} ${unit}`;
  }
  return `${fileSizeFormat.format(bytes)} B`;
}
