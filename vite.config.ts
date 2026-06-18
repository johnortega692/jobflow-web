import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createExtractPaintMiddleware } from "./api/extractPaintDev";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }

  return {
    plugins: [
      react(),
      {
        name: "extract-paint-api",
        configureServer(server) {
          server.middlewares.use(createExtractPaintMiddleware());
        },
      },
    ],
    server: {
      port: 5173,
    },
  };
});
