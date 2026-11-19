import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { handleGarageRequest } from "./garage-handler.js";
import {
  ApiError,
  consumeRateLimit,
  MAX_REQUEST_BYTES,
  secureResponse,
  validateRequest,
} from "../server/security.js";

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
  if (request.body !== undefined) {
    const body = typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body);
    if (body && Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
      throw new ApiError(413, "Request body is too large.");
    }
    return body;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) {
      request.resume();
      throw new ApiError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
}

export default async function handler(
  request: ApiRequest,
  response: ServerResponse,
) {
  let result: Response;
  try {
    const method = request.method || "GET";
    const headers = requestHeaders(request.headers);
    const host = request.headers.host;
    if (!host || /[\s/@\\?#]/.test(host)) {
      throw new ApiError(400, "Invalid request host.");
    }
    const url = `${process.env.VERCEL ? "https" : "http"}://${host}/api/garage`;
    validateRequest(new Request(url, { method, headers }));
    const forwarded = request.headers["x-vercel-forwarded-for"];
    const address = process.env.VERCEL
      ? (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "")
      : request.socket.remoteAddress || "";
    consumeRateLimit(`ip:${isIP(address) ? address : "unknown"}`, 120, 60_000);
    const body = await readBody(request);
    result = await handleGarageRequest(new Request(url, { method, headers, body }));
  } catch (error) {
    if (error instanceof ApiError) {
      result = Response.json({ error: error.message }, {
        status: error.status,
        headers: error.headers,
      });
    } else {
      console.error("GarageOS request adapter failed.");
      result = Response.json({ error: "The request could not be completed." }, { status: 500 });
    }
  }
  secureResponse(result);
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(await result.text());
}
