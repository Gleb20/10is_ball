import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.TAB10_API_PROXY_TARGET ?? "http://localhost:3001";
const apiProxy = {
  "/api": apiProxyTarget,
  "/health": apiProxyTarget,
  "/ready": apiProxyTarget,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
