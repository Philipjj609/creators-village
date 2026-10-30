import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { repositoryRoot } from "./database.js";

export type ReleaseFile = {
  source: string;
  sha256: string;
  type: string;
  immutable: boolean;
};
export async function registerProductionWeb(app: FastifyInstance) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(repositoryRoot, "release-manifest.json"),
      "utf8",
    ),
  ) as { files: Record<string, ReleaseFile> };
  const files = new Map<string, { bytes: Buffer; file: ReleaseFile }>();
  // Fail before serving if a deployed file is missing or changed. Never expose source directories.
  for (const [url, file] of Object.entries(manifest.files)) {
    if (
      !url.startsWith("/") ||
      file.source.includes("..") ||
      path.isAbsolute(file.source)
    )
      throw Error("Invalid release path");
    const bytes = await fs.readFile(path.join(repositoryRoot, file.source));
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw Error("Release asset fingerprint mismatch");
    files.set(url, { bytes, file });
  }
  for (const [url, { bytes, file }] of files)
    app.get(url, async (_req, reply) =>
      reply
        .header(
          "Cache-Control",
          file.immutable ? "public,max-age=31536000,immutable" : "no-cache",
        )
        .type(file.type)
        .send(bytes),
    );
  const html = files.get("/index.html");
  if (!html) throw Error("Release index missing");
  for (const route of [
    "/",
    "/communities",
    "/create",
    "/playtest",
    "/join",
    "/settings",
    "/villages/:id",
  ])
    app.get(route, async (_req, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .type("text/html; charset=utf-8")
        .send(html.bytes),
    );
  // Unknown API/auth/static paths intentionally remain 404, never SPA HTML.
}
