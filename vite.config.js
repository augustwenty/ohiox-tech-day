import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // MediaPipe relies on dynamically loaded scripts and shared browser globals.
  // Preserve those names in the production bundle so Pages behaves like dev.
  build: {
    minify: false,
  },
});
