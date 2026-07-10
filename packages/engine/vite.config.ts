import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Vite replaces `process.env.NODE_ENV` in app builds but deliberately not in
  // library builds (consumers' bundlers usually handle it). Our lib bundle is
  // loaded by a native browser `import()` with no bundler in between, so the
  // bare `process` references in React's CJS entries would throw — pin it.
  define:
    mode === "lib"
      ? { "process.env.NODE_ENV": JSON.stringify("production") }
      : undefined,
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
