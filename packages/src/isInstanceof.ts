type Constructor<T> = abstract new (...args: never[]) => T;

export function isInstanceof<TSource, TTarget extends TSource>(
  value: TSource,
  constructor: Constructor<TTarget>,
): value is TTarget;
export function isInstanceof<TSource, TTarget extends TSource>(
  value: TSource,
  constructors: readonly Constructor<TTarget>[],
): value is TTarget;
export function isInstanceof<TSource, TConstructors extends readonly Constructor<TSource>[]>(
  value: TSource,
  constructors: TConstructors,
): value is InstanceType<TConstructors[number]>;
export function isInstanceof(
  value: unknown,
  constructors: Constructor<unknown> | readonly Constructor<unknown>[],
): boolean {
  if (typeof constructors === "function") {
    return value instanceof constructors;
  }
  return constructors.some((constructor) => value instanceof constructor);
}
