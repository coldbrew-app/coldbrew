import { AuthUserIdSchema, type UserId } from "@coldbrew/packages/schemas.js";
import { slugFromEmail } from "@coldbrew/packages/slug.js";

import { auth } from "../lib/auth.js";
import { store } from "../sensors/db/index.js";

export type Viewer = {
  userId: UserId;
  user: {
    email: string;
    image: string | null;
    name: string;
  };
};

export async function getViewer(req: Request): Promise<Viewer | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return null;
  }

  const authUserId = AuthUserIdSchema.parse(session.user.id);
  const slug = slugFromEmail(session.user.email);

  const userId = await store.getOrCreateUserId(authUserId, slug);

  return {
    userId,
    user: {
      email: session.user.email,
      image: session.user.image ?? null,
      name: session.user.name,
    },
  };
}

export async function getUserId(req: Request): Promise<UserId | null> {
  return (await getViewer(req))?.userId ?? null;
}
