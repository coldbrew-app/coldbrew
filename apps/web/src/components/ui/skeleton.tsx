import { cn } from "@web/lib/utils";
import type { ComponentProps } from "react";

function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-secondary", className)} {...props} />;
}

export { Skeleton };
