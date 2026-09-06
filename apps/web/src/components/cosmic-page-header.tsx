import { cn } from "@web/lib/utils";
import type { ReactNode } from "react";

import { CosmicArt } from "./cosmic-art";

type Props = {
  actions?: ReactNode;
  className?: string;
  description: string;
  eyebrow: string;
  title: string;
  variant?: "orbit" | "beans";
};

export function CosmicPageHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
  variant = "orbit",
}: Props) {
  return (
    <header
      className={cn(
        "cosmic-page-scene relative flex min-h-40 flex-col justify-center gap-3 overflow-hidden rounded-2xl p-5 sm:p-7",
        className,
      )}
    >
      <div className="relative z-10 flex max-w-2xl flex-col items-start gap-3 sm:pr-24">
        <span className="sr-only">{eyebrow}</span>
        <h1 className="font-heading text-[clamp(28px,4vw,42px)] leading-none font-semibold tracking-tight text-[#fff8ed]">
          {title}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-[#dec9bf]">{description}</p>
        {actions}
      </div>
      <CosmicArt
        className="pointer-events-none absolute -right-12 -bottom-10 w-40 text-[#e4b88b]/40 opacity-25 sm:right-2 sm:w-60 sm:opacity-60"
        variant={variant}
      />
    </header>
  );
}
