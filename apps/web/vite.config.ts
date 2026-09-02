import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  const chatServiceOrigin = `http://127.0.0.1:${Number(process.env["CHAT_PORT"] ?? 3001)}`;

  return {
    envDir: "../..",
    plugins: [
      tanstackStart(),
      nitro({
        preset: "bun",
        ...(command === "serve"
          ? {
              routeRules: {
                "/api/chat/**": { proxy: `${chatServiceOrigin}/**` },
              },
            }
          : {}),
      }),
      react(),
      tailwindcss(),
    ],
    resolve: { tsconfigPaths: true },
    server: {
      port: Number(process.env["APP_PORT"] ?? 3000),
      strictPort: true,
    },
  };
});
