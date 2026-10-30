import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-v04-study-assets",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const match =
            /^\/study-assets\/(v04-neighborhood-study-01|hearthside-hero-01)\/([a-z0-9.-]+\.(?:png|json))$/.exec(
              (req.url ?? "").split("?")[0]!,
            );
          if (!match) return next();
          const root = fileURLToPath(
            new URL(`../../assets/generated/${match[1]}/`, import.meta.url),
          );
          const file = path.join(root, match[2]!);
          if (!existsSync(file)) {
            res.statusCode = 404;
            res.end("Study asset not built");
            return;
          }
          res.setHeader(
            "Content-Type",
            file.endsWith(".png") ? "image/png" : "application/json",
          );
          res.setHeader("Cache-Control", "no-store");
          createReadStream(file).pipe(res);
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": process.env.CV_DEV_API_TARGET ?? "http://127.0.0.1:3000",
      "/auth": process.env.CV_DEV_API_TARGET ?? "http://127.0.0.1:3000",
      "/assets": process.env.CV_DEV_API_TARGET ?? "http://127.0.0.1:3000",
    },
  },
  build: {
    target: ["chrome111", "edge111", "firefox128", "safari16.4"],
    sourcemap: true,
  },
});
