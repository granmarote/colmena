import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/colmena/" : "/",
  server: { port: 5174 },
});
