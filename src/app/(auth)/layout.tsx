import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-caetano-deep-blue px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-2xl font-semibold text-white">caetano</p>
        <div className="rounded-2xl bg-white p-8 shadow-lg">{children}</div>
      </div>
    </div>
  );
}
