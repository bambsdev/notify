import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "pg/index": "src/pg/index.ts",
    "d1/index": "src/d1/index.ts",
    cli: "src/cli.ts",
  },
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
