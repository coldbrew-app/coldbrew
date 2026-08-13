import { AuthUserIdSchema, UserId } from "@omnistream/packages/schemas.js";
import { slugFromEmail } from "@omnistream/packages/slug.js";

import { auth } from "../lib/auth.js";
import { store } from "../sensors/db/index.js";

export async function getUserId(req: Request): Promise<UserId | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return null;

  const authUserId = AuthUserIdSchema.parse(session.user.id);
  const slug = slugFromEmail(session.user.email);

  return await store.getOrCreateUserId(authUserId, slug);
}
