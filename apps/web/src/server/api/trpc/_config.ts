import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { SuperJSON } from "superjson";

import { getUserId } from "../_util.js";

export const createContext = async (opt: FetchCreateContextFnOptions) => ({
  request: opt.req,
  userId: await getUserId(opt.req),
});

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: SuperJSON,
  errorFormatter({ shape, error }) {
    console.error(error.stack ?? error.message);
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
