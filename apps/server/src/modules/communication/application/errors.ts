import { HTTPException } from "hono/http-exception";

import { fail } from "../../../errors";
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

const communicationConflicts = {
  archive_cleanup_pending: "后台正在清理剩余附件，请稍后继续归档。",
} as const;

export function createCommunicationConflict(
  code: keyof typeof communicationConflicts
) {
  return new HTTPException(409, {
    res: Response.json(
      { code, message: communicationConflicts[code] },
      { status: 409 }
    ),
  });
}

export class CommunicationArchiveInProgress extends HTTPException {
  constructor() {
    super(409, {
      res: Response.json(
        {
          code: "archive_in_progress",
          message: "沟通记录正在归档，请在详情页继续处理。",
        },
        { status: 409 }
      ),
    });
  }
}

export function attachmentError(
  status: 409 | 503,
  code: string,
  message: string
): never {
  throw new HTTPException(status, {
    res: Response.json({ code, message }, { status }),
  });
}

export function duplicateAttachment(): never {
  return attachmentError(
    409,
    "attachment_duplicate",
    "这条沟通已包含相同内容的附件。"
  );
}

export function storageUnavailable(): never {
  return attachmentError(
    503,
    "attachment_storage_unavailable",
    "附件存储暂不可用，请稍后重试。"
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
    if (error instanceof HTTPException) throw error;
    if (error instanceof LocalAttachmentSizeError) {
      fail(400, "附件实际大小与声明不一致。");
    }
    return storageUnavailable();
  }
}
