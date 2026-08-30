# Coldbrew React Guide

Follow this guide whenever creating, editing, or reviewing React hooks or their consumers in `apps/web`.

## Required hook values

- When the absence of a hook value is a valid state, expose that nullable contract as `useXSafe()`.
- When most consumers require the value, expose `useX()` as the default required-value hook. It must call `useXSafe()`, check the absent value, throw a specific error, and return the narrowed non-null type.
- Keep the absence check in the hook. Do not repeat checks such as `const x = useXSafe(); if (x === null) throw new Error(...)` in components.
- Use `useXSafe()` only where the component intentionally handles absence, such as rendering a sign-in state or optional UI. Use `useX()` everywhere absence is an invariant violation.
- Do not retain `useXUnsafe()` in the final API. During a migration, the final names are `useXSafe()` for the nullable hook and `useX()` for the required hook.

```ts
export function useUserInfoSafe() {
  const { trpc } = useApi();
  return useSuspenseQuery(trpc.userInfo.queryOptions()).data;
}

export function useUserInfo() {
  const userInfo = useUserInfoSafe();

  if (userInfo === null) throw new Error("Authenticated user info is required.");
  return userInfo;
}
```

When refactoring an existing nullable hook, update every old consumer explicitly: required consumers use the default hook, while consumers that already handle absence use the `Safe` variant so their behavior does not change.
