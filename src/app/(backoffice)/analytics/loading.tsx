import {
  SkeletonCard,
  SkeletonPage,
  SkeletonRows,
} from "@/components/backoffice/skeleton";

export default function Loading() {
  return (
    <SkeletonPage titleWidth="w-48">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <SkeletonRows rows={5} />
    </SkeletonPage>
  );
}
