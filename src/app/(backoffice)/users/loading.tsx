import {
  SkeletonPage,
  SkeletonRows,
} from "@/components/backoffice/skeleton";

export default function Loading() {
  return (
    <SkeletonPage titleWidth="w-40">
      <SkeletonRows rows={6} />
    </SkeletonPage>
  );
}
