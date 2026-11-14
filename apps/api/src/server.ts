import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { app } from "./app";
app.get(
  "*",
  serveStatic({
    root: fileURLToPath(new URL("../../web/dist/", import.meta.url)),
  }),
);
const port = Number(process.env.PORT ?? 8787);
serve(
  { fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" },
  () => console.log(`Sketch to Play API: http://127.0.0.1:${port}`),
);
