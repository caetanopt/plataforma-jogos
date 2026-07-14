import { headers } from "next/headers";

export async function getRequestIp(): Promise<string | null> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return store.get("x-real-ip");
}
