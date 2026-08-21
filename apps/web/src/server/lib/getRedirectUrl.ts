import { rurl } from "@lebedevna/readonly-url";

import { env } from "../env";

export function getRedirectUri() {
  return rurl("/api/integration/donationalerts/callback", env.APP_DOMAIN).href;
}
