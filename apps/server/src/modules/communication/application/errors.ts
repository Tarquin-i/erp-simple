import { HTTPException } from "hono/http-exception";

import { ApplicationError } from "../../../errors";
import { fail } from "../../../errors";
import { LocalAttachmentSizeError } from "../storage/local-files";

const tagConflicts = {
  tag_name_exists: "标签名称已存在。",
  tag_color_conflict: "标签颜色已被更新，请查看当前颜色后再保存。",
} as const;

/** 保留改色与重名接口既有的 JSON 响应。 */
export function createTagConflict(
  code: keyof typeof tagConflicts,
  current?: unknown
) {
  return new ApplicationError(409, tagConflicts[code], { code, current });
}

const communicationConflicts = {
  idempotency_conflict: "该提交 ID 已用于不同的沟通内容。",
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
