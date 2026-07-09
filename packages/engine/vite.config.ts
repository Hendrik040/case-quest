import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `vite build --mode lib` produces the self-contained embeddable bundle
  // (dist/case-quest.es.js) — nothing externalized, so the host page needs no
  // react/phaser of its own. Plain `vite build` keeps the standalone app.
  build:
    mode === "lib"
      ? {
          lib: {
            entry: "src/lib.ts",
            name: "CaseQuest",
            formats: ["es" as const],
            fileName: (format: string) => `case-quest.${format}.js`,
          },
        }
      : {},
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/canvas-mock.ts"],
  },
}));
