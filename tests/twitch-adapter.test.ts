import { it, expect, vi } from "vitest";
import { twitchGateway } from "../apps/server/src/twitch.js";
import type { Config } from "../apps/server/src/config.js";
const config: Config = {
  databaseUrl: "not-used",
  clientId: "client-fixture",
  clientSecret: "secret-fixture",
  redirectUri: "http://localhost:3000/auth/twitch/callback",
  webOrigin: "http://localhost:5173",
  encryptionKey: "a".repeat(64),
  secureCookies: false,
};
it("B01: actual Twitch adapter uses confidential code exchange, validates client and subject, obtains only current profile fields", async () => {
  const requests: { url: string; body: string | null }[] = [];
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, body: init?.body?.toString() ?? null });
      if (url.endsWith("/token"))
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          expires_in: 7200,
        });
      if (url.endsWith("/validate"))
        return Response.json({
          client_id: config.clientId,
          user_id: "fixture-subject",
          scopes: [],
        });
      return Response.json({
        data: [
          {
            id: "fixture-subject",
            display_name: "Synthetic participant",
            login: "synthetic_participant",
          },
        ],
      });
    });
  try {
    const g = twitchGateway(config),
      t = await g.exchange("fixture-code");
    expect(await g.validate(t.access_token)).toEqual({
      subject: "fixture-subject",
      displayName: "Synthetic participant",
      login: "synthetic_participant",
    });
    const body = new URLSearchParams(requests[0]!.body!);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe(config.clientSecret);
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
    expect(body.has("code_verifier")).toBe(false);
    expect(requests.map((r) => r.url)).toEqual([
      "https://id.twitch.tv/oauth2/token",
      "https://id.twitch.tv/oauth2/validate",
      "https://api.twitch.tv/helix/users",
    ]);
  } finally {
    mock.mockRestore();
  }
});
it("B01/E09: wrong app or mismatched profile subject is a definitive authentication failure", async () => {
  let mismatch = false;
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input).endsWith("/validate")
        ? Response.json({
            client_id: mismatch ? config.clientId : "another-client",
            user_id: "subject",
            scopes: [],
          })
        : Response.json({
            data: [
              {
                id: "different-subject",
                display_name: "Not accepted",
                login: "other",
              },
            ],
          }),
    );
  try {
    await expect(
      twitchGateway(config).validate("fixture"),
    ).rejects.toMatchObject({ status: 401 });
    mismatch = true;
    await expect(
      twitchGateway(config).validate("fixture"),
    ).rejects.toMatchObject({ status: 401 });
  } finally {
    mock.mockRestore();
  }
});
