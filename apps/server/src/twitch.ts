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
  /** Present only when Twitch granted at least one scope; scope-free identity omits it. */
  scopes?: string[];
};
export const FOLLOW_SCOPE = "user:read:follows";
export interface TwitchGateway {
  exchange(code: string): Promise<Tokens>;
  refresh(token: string): Promise<Tokens>;
  validate(token: string): Promise<TwitchIdentity>;
  /**
   * Broadcaster IDs followed by `userId` (bounded). Optional so scope-free gateways and
   * older fakes remain valid; callers treat absence as "unavailable".
   */
  followedBroadcasters?(access: string, userId: string): Promise<string[]>;
  /** Live check of one relationship (Get Followed Channels with broadcaster_id). */
  isFollowing?(
    access: string,
    userId: string,
    broadcasterId: string,
  ): Promise<boolean>;
}
const MAX_FOLLOW_PAGES = 20;
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
        ...(v.scopes?.length ? { scopes: v.scopes } : {}),
      };
    },
    async followedBroadcasters(access, userId) {
      const ids: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < MAX_FOLLOW_PAGES; page++) {
        const url = new URL("https://api.twitch.tv/helix/channels/followed");
        url.searchParams.set("user_id", userId);
        url.searchParams.set("first", "100");
        if (after) url.searchParams.set("after", after);
        const r = await fetch(url, {
          headers: {
            Authorization: "Bearer " + access,
            "Client-Id": config.clientId,
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new ProviderError(r.status);
        const body = (await r.json()) as {
          data?: { broadcaster_id?: string }[];
          pagination?: { cursor?: string };
        };
        if (!Array.isArray(body.data)) throw new ProviderError(502);
        for (const row of body.data)
          if (typeof row.broadcaster_id === "string")
            ids.push(row.broadcaster_id);
        after = body.pagination?.cursor;
        if (!after) return ids;
      }
      // More pages than the bound: return what was verified rather than looping on a provider.
      return ids;
    },
    async isFollowing(access, userId, broadcasterId) {
      const url = new URL("https://api.twitch.tv/helix/channels/followed");
      url.searchParams.set("user_id", userId);
      url.searchParams.set("broadcaster_id", broadcasterId);
      const r = await fetch(url, {
        headers: {
          Authorization: "Bearer " + access,
          "Client-Id": config.clientId,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new ProviderError(r.status);
      const body = (await r.json()) as {
        data?: { broadcaster_id?: string }[];
      };
      if (!Array.isArray(body.data)) throw new ProviderError(502);
      return body.data.some((row) => row.broadcaster_id === broadcasterId);
    },
  };
}
