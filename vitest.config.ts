import { defineConfig } from "vitest/config";
import path from "path";

// Config propia y mínima: las pruebas solo cubren funciones puras, así que no
// necesitan los plugins de React, Tailwind ni PWA del build.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
