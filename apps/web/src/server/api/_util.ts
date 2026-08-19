import { AuthUserIdSchema, UserId } from "@coldbrew/packages/schemas.js";
import { slugFromEmail } from "@coldbrew/packages/slug.js";

import { auth } from "../lib/auth.js";
import { store } from "../sensors/db/index.js";

export async function getUserId(req: Request): Promise<UserId | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return null;

  const authUserId = AuthUserIdSchema.parse(session.user.id);
  const slug = slugFromEmail(session.user.email);

  return await store.getOrCreateUserId(authUserId, slug);
}
