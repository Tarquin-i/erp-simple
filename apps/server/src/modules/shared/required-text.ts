export function validateRequiredText(
  value: unknown,
  label: string,
  max: number
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string") {
    return { ok: false, message: `请填写${label}。` };
  }
  const text = value.trim();
  if (!text || text.length > max || text.includes("\0")) {
    return {
      ok: false,
      message: `请检查${label}，长度应在 1 至 ${max} 个字符之间。`,
    };
  }
  return { ok: true, value: text };
}
