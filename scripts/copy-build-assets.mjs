import { cp, mkdir } from "node:fs/promises";

const outputDirectory = new URL("../dist/server/server/", import.meta.url);

await mkdir(outputDirectory, { recursive: true });
await cp(
  new URL("../server/import-worker.mjs", import.meta.url),
  new URL("import-worker.mjs", outputDirectory),
);
await cp(
  new URL("../server/migrations/", import.meta.url),
  new URL("migrations/", outputDirectory),
  { recursive: true },
);
