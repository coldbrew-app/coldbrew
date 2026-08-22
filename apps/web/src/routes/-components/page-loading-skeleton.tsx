import { Skeleton } from "@web/components/ui/skeleton";

export default function PageLoadingSkeleton() {
  return (
    <main aria-busy="true" className="flex min-h-dvh bg-background">
      <aside className="hidden w-[244px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 pt-8 pb-5 lg:flex">
        <div className="flex items-center gap-2.5 px-1">
          <Skeleton className="size-6 rounded-lg" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="mt-11 flex flex-col gap-1">
          <Skeleton className="h-11 rounded-lg" />
          <Skeleton className="h-11 rounded-lg" />
          <Skeleton className="h-11 rounded-lg" />
          <Skeleton className="h-11 rounded-lg" />
        </div>
        <div className="mt-auto flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-5">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="size-5 rounded" />
        </div>
      </aside>
      <div className="flex min-w-0 grow flex-col">
        <Skeleton className="h-14 w-full rounded-none lg:hidden" />
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="flex flex-col gap-4 px-3 py-2 sm:px-5 sm:py-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-40" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </div>
    </main>
  );
}
