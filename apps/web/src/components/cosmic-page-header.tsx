import { cn } from "@web/lib/utils";
import type { ReactNode } from "react";

import { CosmicArt } from "./cosmic-art";

type Props = {
  actions?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2;
  navigation?: ReactNode;
  title: string;
  variant?: "orbit" | "beans" | "signal";
};

export function CosmicPageHeader({
  actions,
  className,
  headingLevel = 1,
  navigation,
  title,
  variant = "orbit",
}: Props) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <header
      className={cn(
        "cosmic-page-scene relative flex shrink-0 flex-wrap items-center justify-between gap-3 overflow-hidden px-4 py-2.5 text-[#fff8ed] sm:px-5",
        className,
      )}
    >
      <div
        className={cn(
          "relative z-10 flex min-w-0 flex-1 items-center",
          navigation && "min-w-[min(100%,15rem)]",
        )}
      >
        <Heading
          className={
            navigation
              ? "sr-only"
              : "font-heading text-xl leading-tight font-semibold tracking-tight text-[#fff8ed]"
          }
        >
          {title}
        </Heading>
        {navigation}
      </div>
      {actions && <div className="relative z-10 flex shrink-0 items-center gap-2">{actions}</div>}
      <CosmicArt
        className={cn(
          "pointer-events-none absolute text-[#e4b88b]/40",
          variant === "signal"
            ? "top-1/2 -right-5 w-44 -translate-y-1/2 opacity-70 sm:right-2"
            : "-right-4 -bottom-12 w-36 opacity-25 sm:right-2 sm:opacity-40",
        )}
        variant={variant}
      />
    </header>
  );
}
