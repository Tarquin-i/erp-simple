import { toastManager } from "@/components/shared/toast";

/** 复制地址信息，并通过 Toast 提示剪贴板写入结果。 */
export async function copyAddressValue(
  value: string,
  successMessage: string,
  errorMessage: string
) {
  try {
    await navigator.clipboard.writeText(value);
    toastManager.add({ title: successMessage, type: "success" });
  } catch {
    toastManager.add({ title: errorMessage, type: "error" });
  }
}
