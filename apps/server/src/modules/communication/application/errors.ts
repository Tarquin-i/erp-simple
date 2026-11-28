import { ModuleError } from "../../shared/application-error";
import { LocalAttachmentSizeError } from "../storage/local-files";

const communicationErrorMessages = {
  writeTargetForbidden: "无权将业务数据写入该范围。",
  tagsNotAssignable: "所选沟通标签不存在或不属于该沟通记录所在部门。",
  assignedTagNotFound: "所选沟通标签不存在。",
  recordConcurrentUpdate: "沟通记录有并发更新，请重试。",
  recordNotFound: "沟通记录不存在。",
  recordVersionConflict: "资料已被更新，请查看最新资料后确认是否覆盖。",
  recordIdempotencyConflict: "该提交 ID 已用于不同的沟通内容。",
  recordOwnerRequired: "请选择业务员。",
  recordOwnerChangeForbidden: "只有部门主管或公司管理员可更换沟通业务员。",
  recordCustomerNotFound: "客户不存在。",
  tagNameConflict: "标签名称已存在。",
  tagColorConflict: "标签颜色已被更新，请查看当前颜色后再保存。",
  tagConflict: "标签已被更新，请查看最新资料后再试。",
  tagNotFound: "标签不存在。",
  tagDepartmentForbidden: "只能访问当前所属部门的标签。",
  tagDepartmentRequired: "请选择标签所属部门。",
  archiveInProgress: "沟通记录正在归档，请在详情页继续处理。",
  archiveCleanupPending: "后台正在清理剩余附件，请稍后继续归档。",
  attachmentCleanupPending: "附件仍在清理，请稍后重试。",
  attachmentStorageUnavailable: "附件存储暂不可用，请稍后重试。",
  attachmentLimitInvalid: "附件大小限制配置无效。",
  localAttachmentStorageDisabled: "本地附件存储未启用。",
  localAttachmentTooLarge: "本地存储的单个附件不能超过 128 MiB。",
  attachmentUploadConflict: "该上传 ID 已被使用，请重新选择文件。",
  attachmentUploadConflictClosed: "该上传已关闭，请重新选择文件。",
  attachmentDuplicate: "这条沟通已包含相同内容的附件。",
  attachmentUploadChanged: "上传会话已变化，请重试。",
  attachmentUploadClosed: "附件上传已关闭。",
  attachmentUploadNotFound: "附件上传不存在。",
  attachmentAlreadyReceived: "附件已收到，请完成校验。",
  attachmentUploadTypeMismatch: "附件类型与初始化时声明的类型不一致。",
  attachmentSizeMismatch: "附件实际大小与声明不一致。",
  attachmentUploadIncomplete: "尚未收到附件，请先完成上传。",
  attachmentNotFound: "附件不存在。",
  attachmentNotDownloadable: "附件不存在或不可下载。",
  attachmentFileNotFound: "附件文件不存在。",
  attachmentTextContainsNull: "附件文本包含不支持的空字符。",
  attachmentTextInvalidEncoding:
    "附件文本编码无效，请另存为 UTF-8 编码后重新上传。",
  attachmentContentLengthMismatch: "附件大小对不上，请重新上传。",
  attachmentContentTypeMismatch: "附件实际内容与文件类型不匹配。",
  attachmentChecksumMismatch: "附件内容与上传声明不一致，请重新选择文件。",
  attachmentImageFormatMismatch: "图片内容与格式不匹配。",
  attachmentThumbnailFailed: "无法生成该图片的缩略图。",
  attachmentPreviewUnsupported: "该附件类型不支持图片预览。",
  attachmentThumbnailSourceTooLarge:
    "该图片大小超出缩略图处理范围，请查看原图或下载。",
  attachmentThumbnailBusy: "缩略图生成繁忙，请稍后重试。",
  attachmentThumbnailTooLarge: "该图片的缩略图过大。",
} as const;

export type CommunicationErrorReason =
  | keyof typeof communicationErrorMessages
  | "tagInUse";

export function createCommunicationError(
  reason: keyof typeof communicationErrorMessages,
  current?: unknown
) {
  return new ModuleError(
    "communication",
    reason,
    communicationErrorMessages[reason],
    current
  );
}

export function createCommunicationTagInUseError(references: number) {
  return new ModuleError(
    "communication",
    "tagInUse",
    `此标签已被 ${references} 条记录引用，请先解除关联再删除。`,
    { references }
  );
}

export function isAttachmentCleanupRetryable(
  error: unknown
): error is ModuleError {
  return (
    error instanceof ModuleError &&
    error.module === "communication" &&
    (error.reason === "attachmentStorageUnavailable" ||
      error.reason === "attachmentCleanupPending")
  );
}

/**
 * 将存储及流读取失败转换成可重试错误，保留业务校验响应。
 * @param run 一次读取、签名或清理操作。
 * @returns 操作的结果。
 * @throws 业务错误原样返回，存储错误返回 503。
 */
export async function useStorage<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ModuleError) throw error;
    if (error instanceof LocalAttachmentSizeError) {
      throw createCommunicationError("attachmentSizeMismatch");
    }
    throw createCommunicationError("attachmentStorageUnavailable");
  }
}
