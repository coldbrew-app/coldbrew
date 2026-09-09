import { logError } from "@coldbrew/packages/server-logger.js";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { SuperJSON } from "superjson";

import { getViewer } from "../_util.js";

export const createContext = async (opt: FetchCreateContextFnOptions) => {
  const viewer = await getViewer(opt.req);
  return { request: opt.req, userId: viewer?.userId ?? null, viewer };
};

type Context = Omit<Awaited<ReturnType<typeof createContext>>, "viewer"> & {
  viewer?: Awaited<ReturnType<typeof createContext>>["viewer"];
};

const t = initTRPC.context<Context>().create({
  transformer: SuperJSON,
  errorFormatter({ shape, error }) {
    logError("tRPC request failed", error, { code: error.code });
    return shape;
  },
});

export const router = t.router;
export const procedure = t.procedure;

export const authenticatedProcedure = procedure.use(async ({ next, ctx }) => {
  const userId = ctx.userId;

  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({ ctx: { ...ctx, userId } });
});

export const adminProcedure = authenticatedProcedure.use(async ({ next, ctx }) => {
  if (!ctx.viewer?.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});
