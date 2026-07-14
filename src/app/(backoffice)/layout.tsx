import type { ReactNode } from "react";
import { requireOrgContext } from "@/server/auth/session";

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  await requireOrgContext();
  return <div className="flex min-h-screen flex-1 flex-col bg-neutral-50">{children}</div>;
}
