import { cn } from "@web/lib/utils";
import type { ComponentProps } from "react";

import { Skeleton } from "./ui/skeleton";

type Props = ComponentProps<"div">;

export function DonationListSkeleton({ className, ...props }: Props) {
  return (
    <div className={cn("divide-y divide-[#e8e4ed] dark:divide-[#393442]", className)} {...props}>
      {[0, 1, 2].map((index) => (
        <div className="flex gap-3 px-4 py-4 sm:items-center sm:px-5" key={index}>
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex min-w-0 grow flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-20 rounded" />
            </div>
            <Skeleton className="h-3 w-3/4 max-w-sm" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function VideoListSkeleton({
  className,
  withActions = false,
  ...props
}: Props & { withActions?: boolean }) {
  return (
    <div className={cn("divide-y divide-[#e8e4ed] dark:divide-[#393442]", className)} {...props}>
      {[0, 1, 2].map((index) => (
        <article className="flex flex-col gap-3 px-4 py-4 sm:px-5" key={index}>
          <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
            <Skeleton className="aspect-video w-full rounded-lg sm:w-60 sm:shrink-0" />
            <div className="flex min-w-0 grow flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-3 w-10" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-full max-w-xl" />
                <Skeleton className="h-3 w-2/3 max-w-md" />
              </div>
              {withActions && (
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-24 rounded-md" />
                  <Skeleton className="h-8 w-24 rounded-md" />
                </div>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function VideoPrioritiesSkeleton({ className, ...props }: Props) {
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      {[0, 1].map((index) => (
        <div
          className="flex items-center gap-2 rounded-lg border border-[#e5e1ea] p-2 dark:border-[#393442]"
          key={index}
        >
          <Skeleton className="size-6 shrink-0 rounded-md" />
          <Skeleton className="h-3 min-w-0 grow" />
          <Skeleton className="h-3 w-16 shrink-0" />
          <Skeleton className="h-3 w-4 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton({ className, ...props }: Props) {
  return (
    <div className={cn("mt-7 flex flex-col gap-4", className)} {...props}>
      <section className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <article
            className="flex h-30 flex-col gap-3 rounded-xl border border-[#e5e1ea] bg-white p-5 dark:border-[#393442] dark:bg-[#24202d]"
            key={index}
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-2.5 w-32" />
          </article>
        ))}
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.03fr_.97fr]">
        <article className="overflow-hidden rounded-xl border border-[#e5e1ea] bg-white dark:border-[#393442] dark:bg-[#24202d]">
          <div className="flex items-start justify-between p-5">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
          <DonationListSkeleton />
        </article>
        <article className="flex min-h-[290px] flex-col gap-5 rounded-xl border border-[#e5e1ea] bg-white p-5 dark:border-[#393442] dark:bg-[#24202d]">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-7 w-20 rounded-md" />
          </div>
          <Skeleton className="h-40 w-full" />
          <div className="flex justify-between">
            <Skeleton className="h-2.5 w-8" />
            <Skeleton className="h-2.5 w-8" />
            <Skeleton className="h-2.5 w-8" />
            <Skeleton className="h-2.5 w-8" />
          </div>
        </article>
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-30 rounded-xl" />
        <Skeleton className="h-30 rounded-xl" />
      </section>
    </div>
  );
}
