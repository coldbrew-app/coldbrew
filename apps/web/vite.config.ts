import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  plugins: [tanstackStart(), nitro({ preset: "bun" }), react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
});
