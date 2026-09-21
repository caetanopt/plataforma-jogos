import {
  SkeletonPage,
  SkeletonRows,
} from "@/components/backoffice/skeleton";

export default function Loading() {
  return (
    <SkeletonPage titleWidth="w-32">
      <SkeletonRows rows={10} />
    </SkeletonPage>
  );
}
