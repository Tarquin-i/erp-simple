import { HTTPException } from "hono/http-exception";

export function fail(
  status: 400 | 401 | 403 | 404 | 409 | 415,
  message: string
): never {
  throw new HTTPException(status, {
    res: Response.json({ message }, { status }),
  });
}
