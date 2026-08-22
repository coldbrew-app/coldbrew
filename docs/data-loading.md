# Data loading

Coldbrew uses TanStack Router to coordinate navigation and TanStack Query to cache server data. Choose the loading strategy based on whether the data is required to render the application shell or can appear after the destination page is visible.

## Critical data

Use `useSuspenseQuery` only for data that must exist before its component tree can render, such as the authenticated viewer shell or an identifier shared by that shell. Every suspense query must be prefetched by an awaited parent route loader and covered by an intentional `Suspense` and error boundary.

Keep critical query keys active in a stable parent component. Mutations that change critical data must invalidate the same query key.

Do not add a suspense query to a page merely to avoid handling `undefined`. During client navigation React can keep showing the previous route while the query suspends, which makes the application feel unresponsive.

## Page data

Use regular `useQuery` for lists, dashboards, integration metadata, and other data that is not required to render the destination page frame.

- Show the destination heading and controls immediately.
- Use a layout-matching skeleton for the first load of predictable content such as lists and metrics.
- Use a disabled button with a compact progress indicator when only an action URL or other control dependency is loading.
- Keep cached data visible during background refetches instead of replacing it with a skeleton.
- Handle query errors locally and provide a retry action. Never render an error as an empty-data state.
- Put external positioning and sizing on the loading or error component through `className`.

## Route loaders and prefetching

Route loaders should start page queries early without blocking client navigation. Use `preloadRouteQuery` from `apps/web/src/lib/trpc.ts`: it awaits data during SSR so the first HTML is complete, but starts a non-blocking `prefetchQuery` during browser navigation. The page then reads the same query through `useQuery`.

Await `ensureQueryData` on client navigation only when the route cannot render meaningfully without the result. Public pages whose primary content is the requested resource may keep an awaited loader.

When several independent queries are needed by one page, start them together so they do not form a request waterfall.

## Router context

Do not make uncached server calls from a root `beforeLoad`: it runs before child loaders and can delay every navigation. Store reusable server-derived context such as the current viewer in TanStack Query, return cached data immediately, and revalidate stale data in the background. Resolve browser-local state such as locale synchronously on the client.

Route guards improve navigation UX but are not an authorization boundary. Every tRPC procedure, server function, and API endpoint that returns private data must still authorize its own request.

## Review checklist

- Cold navigation displays the destination route and an appropriate local loading state immediately.
- Warm navigation uses cached data without flashing a skeleton.
- A failed query shows an error and retry action instead of an empty state.
- Full-page SSR, hydration, signed-out behavior, mobile layout, and both themes still work.
