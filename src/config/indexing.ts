export function publicIndexingAllowed(environment = process.env): boolean {
  if (environment.APP_DEPLOYMENT_ENV !== "production") return false;
  try {
    const url = new URL(environment.NEXT_PUBLIC_APP_URL || "");
    return url.href === "https://applypack.work/";
  } catch {
    return false;
  }
}
