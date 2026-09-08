import { cn } from "@web/lib/utils";
import type { ReactNode } from "react";

import { CosmicArt } from "./cosmic-art";

type Props = {
  actions?: ReactNode;
  className?: string;
  description?: string;
  eyebrow?: string;
  navigation?: ReactNode;
  title: string;
  variant?: "orbit" | "beans";
};

export function CosmicPageHeader({
  actions,
  className,
  description,
  eyebrow,
  navigation,
  title,
  variant = "orbit",
}: Props) {
  return (
    <header
      className={cn(
        "cosmic-page-scene relative flex shrink-0 flex-wrap items-center justify-between gap-3 overflow-hidden px-4 py-3 text-[#fff8ed] sm:px-5 sm:py-4",
        className,
      )}
    >
      <div
        className={cn(
          "relative z-10 flex min-w-0 flex-1 flex-col items-start gap-1",
          navigation && "min-w-[min(100%,15rem)]",
        )}
      >
        <span className="sr-only">{eyebrow}</span>
        <h1
          className={
            navigation
              ? "sr-only"
              : "font-heading text-xl leading-tight font-semibold tracking-tight text-[#fff8ed]"
          }
        >
          {title}
        </h1>
        {navigation}
        {description && (
          <p className="max-w-2xl text-xs leading-relaxed text-[#dec9bf]">{description}</p>
        )}
      </div>
      {actions && <div className="relative z-10 flex shrink-0 items-center gap-2">{actions}</div>}
      <CosmicArt
        className="pointer-events-none absolute -right-4 -bottom-12 w-36 text-[#e4b88b]/40 opacity-25 sm:right-2 sm:opacity-40"
        variant={variant}
      />
    </header>
  );
}
