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
