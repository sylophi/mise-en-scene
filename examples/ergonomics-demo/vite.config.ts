import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // `esnext` would pass TC39 decorators through un-lowered (Rollup and
  // browsers can't parse them yet); es2022 makes esbuild lower them.
  esbuild: { target: "es2022" },
});
