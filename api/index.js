import { createRequestHandler, loadConfig } from "../server.js";

let handler;

export default async function vercelHandler(req, res) {
  if (!handler) {
    handler = createRequestHandler(await loadConfig());
  }

  return await handler(req, res);
}
