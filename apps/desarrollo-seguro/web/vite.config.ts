import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createDevelopmentSecurityApiProxy } from "./src/api-proxy.js";

const DEVELOPMENT_SECURITY_API_PROXY_TARGET =
  process.env.DEVELOPMENT_SECURITY_API_PROXY_TARGET ?? "http://127.0.0.1:3001";

export default defineConfig({
  base: "/app/",
  plugins: [react()],
  server: {
    headers: {
      "Permissions-Policy": "microphone=(), on-device-speech-recognition=()",
    },
    proxy: createDevelopmentSecurityApiProxy(
      DEVELOPMENT_SECURITY_API_PROXY_TARGET,
    ),
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
