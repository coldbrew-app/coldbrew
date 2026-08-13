import { clsx, type ClassValue } from "clsx";
import type { ComponentType, FunctionComponent } from "react";

type PropsWithDefaults<Props, Defaults extends Partial<Props>> = Omit<Props, keyof Defaults> &
  Partial<Pick<Props, Extract<keyof Defaults, keyof Props>>>;

export function withProps<Props extends object, Defaults extends Partial<Props>>(
  Component: ComponentType<Props>,
  defaultProps: Defaults,
): FunctionComponent<PropsWithDefaults<Props, Defaults>> {
  return function WithProps(props) {
    const className = clsx(
      (defaultProps as { className?: ClassValue }).className,
      (props as { className?: ClassValue }).className,
    );

    return <Component {...({ ...defaultProps, ...props, className } as unknown as Props)} />;
  };
}
