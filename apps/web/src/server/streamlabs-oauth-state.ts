import { createDonationOAuthState } from "./donation-oauth-state.js";

const oauthState = createDonationOAuthState("streambrew-streamlabs-oauth");

export function createStreamlabsOAuthAttempt(userId: number) {
  return oauthState.create(userId);
}

export function clearStreamlabsOAuthAttempt() {
  return oauthState.clear();
}

export function verifyStreamlabsOAuthAttempt(request: Request, state: string, userId: number) {
  return oauthState.verify(request, state, userId);
}
