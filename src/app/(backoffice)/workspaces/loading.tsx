import {
  SkeletonPage,
  SkeletonRows,
} from "@/components/backoffice/skeleton";

export default function Loading() {
  return (
    <SkeletonPage titleWidth="w-56">
      <SkeletonRows rows={4} />
    </SkeletonPage>
  );
}
