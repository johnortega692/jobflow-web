import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createExtractPaintMiddleware } from "./api/extractPaintDev";
import { createBrushoutsMiddleware } from "./api/brushoutsDev";
import { createGoogleSheetsMiddleware } from "./api/googleSheetsDev";
import { createSendVendorEmailMiddleware } from "./api/sendVendorEmailDev";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  if (env.RESEND_API_KEY) {
    process.env.RESEND_API_KEY = env.RESEND_API_KEY;
  }
  if (env.EMAIL_FROM) {
    process.env.EMAIL_FROM = env.EMAIL_FROM;
  }
  if (env.VITE_SUPABASE_URL) {
    process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL;
  }
  if (env.VITE_SUPABASE_ANON_KEY) {
    process.env.VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
  }

  return {
    plugins: [
      react(),
      {
        name: "extract-paint-api",
        configureServer(server) {
          server.middlewares.use(createExtractPaintMiddleware());
          server.middlewares.use(createBrushoutsMiddleware());
          server.middlewares.use(createGoogleSheetsMiddleware());
          server.middlewares.use(createSendVendorEmailMiddleware());
        },
      },
    ],
    server: {
      port: 5173,
    },
  };
});
