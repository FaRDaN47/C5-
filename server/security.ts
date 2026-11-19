export const MAX_REQUEST_BYTES = 64 * 1024;

export const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

// Per-instance protection; distributed enforcement belongs at the hosting edge.
export function createRateLimiter(maxEntries = 10_000) {
  const buckets = new Map<string, { count: number; resetsAt: number }>();
  return (key: string, limit: number, windowMs: number, now = Date.now()) => {
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      if (!bucket && buckets.size >= maxEntries) {
        for (const [id, entry] of buckets) {
          if (entry.resetsAt <= now) buckets.delete(id);
        }
        if (buckets.size >= maxEntries) {
          throw new ApiError(429, "Too many requests. Try again shortly.", {
            "Retry-After": "60",
          });
        }
      }
      bucket = { count: 0, resetsAt: now + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      throw new ApiError(429, "Too many requests. Try again shortly.", {
        "Retry-After": String(Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000))),
      });
    }
    bucket.count += 1;
  };
}

export const consumeRateLimit = createRateLimiter();

export function validateRequest(request: Request) {
  if (request.method !== "POST") {
    throw new ApiError(405, "Method not allowed.", { Allow: "POST" });
  }
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin !== null && origin !== new URL(request.url).origin)) {
    throw new ApiError(403, "Cross-origin requests are not allowed.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) {
    throw new ApiError(400, "Invalid content length.");
  }
  if (Number(length) > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "Request body is too large.");
  }
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw new ApiError(415, "Compressed request bodies are not supported.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "Send a JSON request body.");
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Request body must be valid JSON.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ApiError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Request body must be valid JSON.");
  } finally {
    reader.releaseLock();
  }
}

export function secureResponse(response: Response) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}
