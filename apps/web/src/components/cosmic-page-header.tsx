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
        "relative flex min-h-36 flex-col justify-center gap-3 overflow-hidden rounded-3xl border border-primary/15 bg-secondary/70 p-5 sm:p-7",
        className,
      )}
    >
      <div className="relative z-10 flex max-w-2xl flex-col items-start gap-2">
        <span className="text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
          {eyebrow}
        </span>
        <h1 className="font-heading text-[clamp(28px,4vw,42px)] leading-none font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        {actions}
      </div>
      <CosmicArt
        className="pointer-events-none absolute -right-8 -bottom-8 w-52 text-primary/30 opacity-55 sm:right-2 sm:w-60"
        variant={variant}
      />
    </header>
  );
}
