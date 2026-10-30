// Azure Functions (modello v4): tutte le richieste a /api/* passano a handle() di worker.js.
import { app } from "@azure/functions";
import { handle } from "./worker.js";

app.http("quality", {
  methods: ["GET", "PUT", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*azione}",
  handler: async (req) => {
    const corpo = req.method === "GET" || req.method === "OPTIONS" ? undefined : await req.arrayBuffer();
    const res = await handle(new Request(req.url, { method: req.method, headers: req.headers, body: corpo }), process.env);
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: res.status === 204 ? undefined : Buffer.from(await res.arrayBuffer())
    };
  }
});
