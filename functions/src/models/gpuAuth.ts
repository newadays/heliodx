/**
 * Google ID tokens for the private model service. Cloud Run checks the token
 * (audience = the service URL) and only the Functions runtime service account
 * holds `roles/run.invoker` on it.
 */
import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth();

/** The service root: strips a trailing slash or `/v1` so the audience matches. */
export function gpuAudience(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

export async function gpuIdToken(url: string): Promise<string> {
  const audience = gpuAudience(url);
  const client = await auth.getIdTokenClient(audience);
  return client.idTokenProvider.fetchIdToken(audience);
}
