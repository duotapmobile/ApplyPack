export function hasDatabaseErrorCode(error: unknown, code: string) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? Reflect.get(error, "message")
      : null;
  return typeof message === "string" && message.includes(code);
}
