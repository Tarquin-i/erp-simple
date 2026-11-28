export class BusinessError extends Error {
  constructor(
    readonly module: string,
    readonly reason: string,
    message: string,
    readonly current?: unknown
  ) {
    super(message);
    this.name = "BusinessError";
  }
}
