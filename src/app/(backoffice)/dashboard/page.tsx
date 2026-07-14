import { requireOrgContext } from "@/server/auth/session";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const context = await requireOrgContext();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-caetano-anthracite">
        Olá, {context.userName}
      </h1>
      <p className="mt-1 text-caetano-medium-gray">
        Painel em construção — chega em breve.
      </p>
      <form action="/api/logout" method="post" className="mt-6">
        <Button type="submit" variant="outline">
          Sair
        </Button>
      </form>
    </div>
  );
}
