import { SkeletonPage, SkeletonRows } from "@/components/backoffice/skeleton";

/**
 * Fallback de omissão para as rotas do backoffice que não têm um `loading.tsx`
 * próprio — o editor de campanhas, a identidade visual, as configurações.
 * Todas são Server Components assíncronos com queries: sem isto, a navegação
 * deixava o ecrã anterior congelado até os dados chegarem.
 */
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonRows rows={6} />
    </SkeletonPage>
  );
}
