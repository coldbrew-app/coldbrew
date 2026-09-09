import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@web/lib/utils";
import type { ComponentProps } from "react";

type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "default" | "sm";
};

function Switch({ className, size = "default", ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input p-0.5 shadow-inner outline-none transition-colors duration-200 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary data-disabled:pointer-events-none data-disabled:cursor-default data-disabled:opacity-50 motion-reduce:transition-none",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none",
          size === "sm" ? "size-4 data-checked:translate-x-4" : "size-5 data-checked:translate-x-5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
