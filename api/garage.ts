import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGarageRequest } from "./garage-handler.js";

type ApiRequest = IncomingMessage & { body?: unknown };

function requestHeaders(source: IncomingMessage["headers"]) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return headers;
}

async function readBody(request: ApiRequest): Promise<string | undefined> {
  if (typeof request.body === "string") return request.body;
  if (request.body !== undefined) return JSON.stringify(request.body);

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
}

export default async function handler(
  request: ApiRequest,
  response: ServerResponse,
) {
  try {
    const method = request.method || "GET";
    const body = await readBody(request);
    const apiRequest = new Request(
      new URL(request.url || "/api/garage", "http://garageos.internal"),
      {
        method,
        headers: requestHeaders(request.headers),
        body: method === "GET" || method === "HEAD" ? undefined : body,
      },
    );
    const result = await handleGarageRequest(apiRequest);
    response.statusCode = result.status;
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(await result.text());
  } catch (error) {
    console.error("GarageOS Vercel function adapter failed.", error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "The request could not be completed." }));
  }
}
