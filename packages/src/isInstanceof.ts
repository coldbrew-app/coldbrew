type Constructor<T> = (new (...args: any[]) => T) & Function;

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
  constructors: Constructor<any> | readonly Constructor<any>[],
): boolean {
  if (Array.isArray(constructors)) {
    return constructors.some((constructor) => value instanceof constructor);
  }
  return value instanceof (constructors as any);
}
