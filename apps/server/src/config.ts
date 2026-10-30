export type Config = {
  databaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webOrigin: string;
  encryptionKey: string;
  secureCookies: boolean;
  wf2WorldId?: string;
  production?: boolean;
  writesPaused?: boolean;
  trustProxy?: number;
};
export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  if (!databaseUrl || !/^[0-9a-f]{64}$/i.test(encryptionKey))
    throw new Error(
      "Local database/encryption configuration missing. Run local-setup and load ignored runtime.env.",
    );
  const production = process.env.NODE_ENV === "production";
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const redirectUri =
    process.env.TWITCH_REDIRECT_URI ??
    "http://localhost:3000/auth/twitch/callback";
  if (process.env.TRUST_PROXY_HOPS && process.env.TRUST_PROXY_HOPS !== "1")
    throw Error("Only an explicit single ingress hop is supported");
  if (production) {
    let origin: URL;
    try {
      origin = new URL(webOrigin);
    } catch {
      throw Error("Invalid production WEB_ORIGIN");
    }
    if (
      origin.protocol !== "https:" ||
      origin.origin !== webOrigin ||
      origin.username ||
      origin.password ||
      redirectUri !== `${webOrigin}/auth/twitch/callback`
    )
      throw Error(
        "Production requires one exact HTTPS origin and matching Twitch callback",
      );
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET)
      throw Error("Production Twitch credentials missing");
    if (
      (process.env.AUTH_MODE && process.env.AUTH_MODE !== "twitch") ||
      Object.keys(process.env).some((k) =>
        /^(CV_TEST_|CV_SYNTHETIC_|TEST_AUTH|SYNTHETIC_AUTH)/.test(k),
      )
    )
      throw Error("Test authentication configuration forbidden in production");
    if (
      process.env.WF2_APPROVED_WORLD_ID &&
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        process.env.WF2_APPROVED_WORLD_ID,
      )
    )
      throw Error("Invalid approved development world ID");
  }
  return {
    databaseUrl,
    encryptionKey,
    clientId: process.env.TWITCH_CLIENT_ID ?? "",
    clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
    redirectUri,
    webOrigin,
    secureCookies: production,
    production,
    writesPaused: production && process.env.GAMEPLAY_WRITES === "paused",
    trustProxy: process.env.TRUST_PROXY_HOPS === "1" ? 1 : 0,
    ...(process.env.WF2_APPROVED_WORLD_ID
      ? { wf2WorldId: process.env.WF2_APPROVED_WORLD_ID.toLowerCase() }
      : {}),
  };
}
