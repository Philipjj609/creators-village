import { afterEach, describe, it, expect, vi } from "vitest";
import { encrypt, decrypt, equal } from "../apps/server/src/security.js";
import { twitchGateway } from "../apps/server/src/twitch.js";
import { revalidateSessions } from "../apps/server/src/session-startup.js";
const key = "a".repeat(64);
describe("identity boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("encrypts tokens with authenticated encryption and detects tampering", () => {
    const value = {
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 3600,
    };
    const encrypted = encrypt(value, key);
    expect(encrypted).not.toContain("test-access");
    expect(decrypt(encrypted, key)).toEqual(value);
    expect(() => decrypt(encrypted, "b".repeat(64))).toThrow();
    expect(equal("a", "longer")).toBe(false);
  });
  it("accepts actual Twitch null scopes for scope-free identity, still binds app and subject", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: "app",
            user_id: "subject",
            scopes: null,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "subject", display_name: "Test" }] }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const gateway = twitchGateway({
      clientId: "app",
      clientSecret: "unused",
      redirectUri: "http://localhost/callback",
      databaseUrl: "unused",
      webOrigin: "http://localhost",
      encryptionKey: key,
      secureCookies: false,
    });
    expect(await gateway.validate("test-token")).toEqual({
      subject: "subject",
      displayName: "Test",
    });
  });
  it("rejects wrong OAuth client before loading profile", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          client_id: "another-app",
          user_id: "subject",
          scopes: null,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const gateway = twitchGateway({
      clientId: "app",
      clientSecret: "unused",
      redirectUri: "http://localhost/callback",
      databaseUrl: "unused",
      webOrigin: "http://localhost",
      encryptionKey: key,
      secureCookies: false,
    });
    await expect(gateway.validate("test-token")).rejects.toMatchObject({
      status: 401,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
