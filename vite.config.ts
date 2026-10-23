import { defineConfig } from "vite";

export default defineConfig({
  // Relative URLs, so the build works from any path: a GitHub Pages project
  // site lives under /<repo>/, not at the root.
  base: "./",
  server: { host: "0.0.0.0", port: 5173 },
  build: { target: "es2022" },
});
