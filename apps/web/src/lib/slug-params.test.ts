import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { slugParams } from "./slug-params";

describe("public queue slug routing", () => {
  it("keeps @ in links while passing a bare slug to the loader", async () => {
    const rootRoute = createRootRoute();
    const queueRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/$slug/videos",
      params: slugParams,
      loader: ({ params }) => params.slug,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([queueRoute]),
      history: createMemoryHistory({ initialEntries: ["/@streamer/videos"] }),
      pathParamsAllowedCharacters: ["@"],
    });

    await router.load();

    const match = router.state.matches.at(-1);
    expect(match?.status).toBe("success");
    expect(match?.loaderData).toBe("streamer");
    expect(
      router.buildLocation({
        to: "/$slug/videos",
        params: slugParams.parse({ slug: "@streamer" }),
        search: { page: 2, status: "watched" },
      }).href,
    ).toBe("/@streamer/videos?page=2&status=watched");
  });

  it.each(["streamer", "@@streamer", "@ab", "@stream/er"])(
    "rejects an invalid URL slug: %s",
    (slug) => {
      expect(() => slugParams.parse({ slug })).toThrow();
    },
  );
});
