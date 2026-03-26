import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    "hono",
    "hono/*",
    "@hono/zod-openapi",
    "drizzle-orm",
    "drizzle-orm/*",
    "pg",
    "zod",
  ],
});
