import type { Config } from "./config.js";
export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
export type TwitchIdentity = {
  subject: string;
  displayName: string;
  login?: string;
};
export interface TwitchGateway {
  exchange(code: string): Promise<Tokens>;
  refresh(token: string): Promise<Tokens>;
  validate(token: string): Promise<TwitchIdentity>;
}
export class ProviderError extends Error {
  constructor(public readonly status: number) {
    super("Twitch authentication temporarily unavailable or invalid");
  }
}
export function twitchGateway(config: Config): TwitchGateway {
  async function token(body: Record<string, string>): Promise<Tokens> {
    const r = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...body,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new ProviderError(r.status);
    const t = (await r.json()) as Tokens;
    if (!t.access_token || !t.refresh_token || !Number.isFinite(t.expires_in))
      throw new ProviderError(502);
    return t;
  }
  return {
    exchange: (code) =>
      token({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
      }),
    refresh: (refresh_token) =>
      token({ grant_type: "refresh_token", refresh_token }),
    async validate(access) {
      const r = await fetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: "OAuth " + access },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new ProviderError(r.status);
      const v = (await r.json()) as {
        client_id: string;
        user_id: string;
        scopes: string[] | null;
      };
      if (v.client_id !== config.clientId || !v.user_id)
        throw new ProviderError(401);
      if (v.scopes !== null && !Array.isArray(v.scopes))
        throw new ProviderError(502);
      const user = await fetch("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: "Bearer " + access,
          "Client-Id": config.clientId,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!user.ok) throw new ProviderError(user.status);
      const result = (await user.json()) as {
        data: { id: string; display_name: string; login: string }[];
      };
      const profile = result.data[0];
      if (!profile || profile.id !== v.user_id) throw new ProviderError(401);
      return {
        subject: profile.id,
        displayName: profile.display_name,
        login: profile.login,
      };
    },
  };
}
