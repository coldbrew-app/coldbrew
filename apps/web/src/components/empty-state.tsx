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
    <div
      className={cn("grid min-h-72 place-items-center px-5 py-10 text-center", className)}
      {...props}
    >
      <div className="relative flex max-w-sm flex-col items-center gap-3">
        {art !== false && (
          <CosmicArt
            className="pointer-events-none absolute -top-12 -right-4 w-44 text-primary/30 opacity-35"
            variant={art}
          />
        )}
        <div className="relative grid size-14 place-items-center rounded-full border border-primary/15 bg-secondary text-secondary-foreground">
          <Icon aria-hidden="true" size={20} />
        </div>
        <Heading className="pt-2 font-heading text-xl font-medium text-card-foreground">
          {title}
        </Heading>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}
