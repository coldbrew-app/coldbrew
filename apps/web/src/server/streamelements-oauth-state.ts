import { createDonationOAuthState } from "./donation-oauth-state.js";

const oauthState = createDonationOAuthState("streambrew-streamelements-oauth");

export function createStreamElementsOAuthAttempt(userId: number) {
  return oauthState.create(userId);
}

export function clearStreamElementsOAuthAttempt() {
  return oauthState.clear();
}

export function verifyStreamElementsOAuthAttempt(request: Request, state: string, userId: number) {
  return oauthState.verify(request, state, userId);
}
