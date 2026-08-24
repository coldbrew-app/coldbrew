import { cn } from "@web/lib/utils";
import type { ComponentProps, ReactNode } from "react";

import { CosmicArt } from "./cosmic-art";
import type { IconComponent } from "./icons";

type Props = ComponentProps<"div"> & {
  art?: "orbit" | "beans" | false;
  description: ReactNode;
  headingLevel?: 2 | 3;
  icon: IconComponent;
  title: ReactNode;
};

export function EmptyState({
  art = "orbit",
  children,
  className,
  description,
  headingLevel = 2,
  icon: Icon,
  title,
  ...props
}: Props) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className={cn("grid min-h-64 place-items-center px-5 text-center", className)} {...props}>
      <div className="relative flex max-w-xs flex-col items-center gap-2 overflow-hidden">
        {art && (
          <CosmicArt
            className="pointer-events-none absolute -top-12 -right-24 w-40 text-primary/20 opacity-25"
            variant={art}
          />
        )}
        <div className="grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <Icon aria-hidden="true" size={20} />
        </div>
        <Heading className="pt-2 text-sm font-semibold text-card-foreground">{title}</Heading>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}
