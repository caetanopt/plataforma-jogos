import {
  SkeletonCard,
  SkeletonPage,
} from "@/components/backoffice/skeleton";

export default function Loading() {
  return (
    <SkeletonPage titleWidth="w-56">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </SkeletonPage>
  );
}
