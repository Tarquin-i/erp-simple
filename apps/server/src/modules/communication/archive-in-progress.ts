import { HTTPException } from "hono/http-exception";

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
