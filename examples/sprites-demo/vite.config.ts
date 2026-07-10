import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // @mise/* are consumed as TypeScript source from the workspace root.
      allow: ["../.."],
    },
  },
});
