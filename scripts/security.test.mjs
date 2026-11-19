import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import { createServer } from "vite";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";

const vite = await createServer({
  configFile: false,
  appType: "custom",
  cacheDir: "node_modules/.cache/security-tests",
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
});
const security = await vite.ssrLoadModule("/server/security.ts");
const { csvCell } = await vite.ssrLoadModule("/src/lib/csv.ts");
const assistant = await vite.ssrLoadModule("/src/lib/assistant.ts");
const { handleGarageRequest } = await vite.ssrLoadModule("/api/garage-handler.ts");
const { default: adapter } = await vite.ssrLoadModule("/api/garage.ts");

const { privateKey, publicKey } = await generateKeyPair("EdDSA");
const publicJwk = { ...await exportJWK(publicKey), kid: "security-test", alg: "EdDSA" };
const jwksServer = createHttpServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ keys: [publicJwk] }));
});
jwksServer.listen(0, "127.0.0.1");
await once(jwksServer, "listening");
const authOrigin = `http://127.0.0.1:${jwksServer.address().port}`;
process.env.NEON_AUTH_BASE_URL = authOrigin;
process.env.NEON_AUTH_JWKS_URL = `${authOrigin}/jwks`;
process.env.DATABASE_URL = "postgresql://security_test@127.0.0.1:1/security_test";
delete process.env.VERCEL;

const userId = "00000000-0000-4000-8000-000000000001";
const workshopId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const customerId = "00000000-0000-4000-8000-000000000004";
let role = "owner";
let profileExists = true;
let jobExists = true;
let duplicateInvoice = false;
let statements = [];
let released = false;
const originalConnect = pg.Pool.prototype.connect;
pg.Pool.prototype.connect = async () => ({
  query: async (sql, params = []) => {
    statements.push({ sql, params });
    const result = (rows) => ({ rows, rowCount: rows.length });
    if (sql.includes("FROM public.profiles") && sql.includes("WHERE id = $1")) {
      return result(profileExists ? [{ id: userId, workshop_id: workshopId, full_name: "Security Test", email: "test@example.invalid", role }] : []);
    }
    if (sql.includes("SELECT customer_id FROM public.job_cards")) {
      return result(jobExists ? [{ customer_id: customerId }] : []);
    }
    if (sql.includes("SELECT 1 FROM public.invoices")) return result(duplicateInvoice ? [{}] : []);
    if (sql.includes("INSERT INTO public.invoices") || sql.includes("INSERT INTO public.customers")) return result([{ id: customerId }]);
    if (sql.includes("UPDATE public.workshops")) return result([{ id: workshopId }]);
    return result([]);
  },
  release: () => { released = true; },
});

after(async () => {
  pg.Pool.prototype.connect = originalConnect;
  jwksServer.close();
  await vite.close();
  delete globalThis.window;
});

async function token(overrides = {}, { expires = true } = {}) {
  let jwt = new SignJWT({
    sub: userId, email: "test@example.invalid", emailVerified: true,
    iss: authOrigin, aud: authOrigin, ...overrides,
  }).setProtectedHeader({ alg: "EdDSA", kid: "security-test" });
  if (expires) jwt = jwt.setExpirationTime("5m");
  return jwt.sign(privateKey);
}

function request(body = { action: "data" }, headers = {}) {
  return new Request("http://localhost/api/garage", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function authorized(body, claims = {}) {
  statements = [];
  released = false;
  return handleGarageRequest(request(body, { Authorization: `Bearer ${await token(claims)}` }));
}

async function adapted(body, { parsedBody, headers = {}, method = "POST" } = {}) {
  const input = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  input.method = method;
  input.headers = { host: "localhost", "content-type": "application/json", ...headers };
  input.socket = { remoteAddress: "127.0.0.1" };
  if (parsedBody !== undefined) input.body = parsedBody;
  const output = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(text) { this.body = JSON.parse(text); } };
  await adapter(input, output);
  return output;
}

test("HTTP methods, JSON media type, malformed JSON and schema are rejected safely", async () => {
  const get = await handleGarageRequest(new Request("http://localhost/api/garage"));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  for (const [body, headers, status] of [
    [{ action: "data" }, { "Content-Type": "text/plain" }, 415],
    [{ action: "data" }, { "Content-Type": "application/json-malicious" }, 415],
    ["{", {}, 400], [{ action: "admin" }, {}, 400],
    [{ action: "saveWorkshop", name: "" }, {}, 400],
    [{ action: "data" }, { "Content-Encoding": "gzip" }, 415],
  ]) {
    assert.equal((await handleGarageRequest(request(body, headers))).status, status);
  }
});

test("all rejected requests are non-cacheable and include browser protections", async () => {
  for (const r of [new Request("http://localhost/api/garage"), request(), request("{")]) {
    const response = await handleGarageRequest(r);
    for (const [key, value] of Object.entries(security.securityHeaders)) assert.equal(response.headers.get(key), value);
    assert.equal(response.headers.has("access-control-allow-origin"), false);
  }
});

test("cross-origin, null-origin and forged fetch-metadata requests are blocked", async () => {
  for (const headers of [{ Origin: "https://attacker.invalid" }, { Origin: "null" }, { Origin: "http://localhost", "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await handleGarageRequest(request({ action: "data" }, headers))).status, 403);
  }
  assert.equal((await handleGarageRequest(request({ action: "data" }, { Origin: "http://localhost" }))).status, 401);
});

test("body byte limits cover missing lengths, UTF-8 and pre-parsed adapter bodies", async () => {
  const body = JSON.stringify({ action: "data", padding: "é".repeat(33_000) });
  assert.equal((await handleGarageRequest(request(body))).status, 413);
  assert.equal((await handleGarageRequest(request({}, { "Content-Length": "65537" }))).status, 413);
  for (const options of [{}, { parsedBody: body }, { parsedBody: JSON.parse(body) }]) {
    const response = await adapted(body, options);
    assert.equal(response.statusCode, 413);
    assert.equal(response.headers["cache-control"], "no-store");
  }
});

test("adapter rejects wrong methods and origins before consuming a body", async () => {
  assert.equal((await adapted(undefined, { method: "GET" })).statusCode, 405);
  assert.equal((await adapted(undefined, { headers: { origin: "https://attacker.invalid" } })).statusCode, 403);
  assert.equal((await adapted('{"action":"data"}')).statusCode, 401);
});

test("bounded rate limiter returns Retry-After, recovers, and does not evict active limits", () => {
  const consume = security.createRateLimiter(2);
  consume("a", 2, 1000, 100);
  consume("a", 2, 1000, 101);
  assert.throws(() => consume("a", 2, 1000, 102), (error) => error.status === 429 && error.headers["Retry-After"] === "1");
  consume("b", 2, 1000, 102);
  assert.throws(() => consume("c", 2, 1000, 103), (error) => error.status === 429);
  consume("c", 2, 1000, 1103);
});

test("invalid, expired, missing-expiry, wrong-audience and wrong-issuer tokens fail closed", async () => {
  const signed = await token();
  const invalid = ["garbage", `${signed.slice(0, -8)}AAAAAAAA`, await token({}, { expires: false }),
    await token({ aud: "wrong" }), await token({ iss: "wrong" }),
    await new SignJWT({ sub: userId, email: "test@example.invalid", iss: authOrigin, aud: authOrigin }).setProtectedHeader({ alg: "EdDSA", kid: "security-test" }).setExpirationTime(1).sign(privateKey)];
  for (const jwt of invalid) {
    assert.equal((await handleGarageRequest(request({ action: "data" }, { Authorization: `Bearer ${jwt}` }))).status, 401);
  }
});

test("money, integer overflow and impossible dates fail validation before database access", async () => {
  for (const body of [
    { action: "saveInvoice", jobId, amountTotal: 0.001, dueDate: null },
    { action: "saveInvoice", jobId, amountTotal: 1e20, dueDate: null },
    { action: "saveInvoice", jobId, amountTotal: 10, dueDate: "2026-02-30" },
    { action: "recordPartUsage", jobId, partId: customerId, quantity: 2147483648 },
  ]) assert.equal((await handleGarageRequest(request(body))).status, 400);
});

test("signed lower-privilege sessions cannot rename workshops or create invoices", async () => {
  role = "mechanic";
  for (const body of [{ action: "saveWorkshop", name: "Unauthorized" }, { action: "saveInvoice", jobId, amountTotal: 12.5, dueDate: null }]) {
    assert.equal((await authorized(body)).status, 403);
    assert.equal(statements.some(({ sql }) => /INSERT INTO public.invoices|UPDATE public.workshops/.test(sql)), false);
    assert.ok(statements.some(({ sql }) => sql === "ROLLBACK"));
    assert.equal(released, true);
  }
  role = "owner";
});

test("unverified new accounts cannot provision a workshop", async () => {
  profileExists = false;
  try {
    assert.equal((await authorized({ action: "workspace" }, { emailVerified: false })).status, 403);
    assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO public.workshops")), false);
  } finally { profileExists = true; }
});

test("duplicate invoices are rejected under a tenant-scoped transaction lock", async () => {
  duplicateInvoice = true;
  try {
    assert.equal((await authorized({ action: "saveInvoice", jobId, amountTotal: 12.5, dueDate: null })).status, 409);
    const lockIndex = statements.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"));
    const checkIndex = statements.findIndex(({ sql }) => sql.includes("SELECT 1 FROM public.invoices"));
    assert.ok(lockIndex >= 0 && checkIndex > lockIndex);
    assert.deepEqual(statements[lockIndex].params, [`invoice:${workshopId}:${jobId}`]);
    assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO public.invoices")), false);
  } finally { duplicateInvoice = false; }
});

test("accountants can invoice without acquiring an unauthorized job UPDATE lock", async () => {
  role = "accountant";
  try {
    const response = await authorized({ action: "saveInvoice", jobId, amountTotal: 12.5, dueDate: null, workshopId: customerId });
    assert.equal(response.status, 200);
    const insert = statements.find(({ sql }) => sql.includes("INSERT INTO public.invoices"));
    assert.equal(insert.params[0], workshopId);
    assert.equal(statements.some(({ sql }) => sql.includes("FROM public.job_cards") && sql.includes("FOR UPDATE")), false);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(statements.some(({ sql }) => sql === "SET LOCAL ROLE garageos_app"));
    assert.ok(statements.some(({ sql }) => sql === "COMMIT"));
  } finally { role = "owner"; }
});

test("foreign or invisible job identifiers cannot create an invoice", async () => {
  jobExists = false;
  try {
    assert.equal((await authorized({ action: "saveInvoice", jobId, amountTotal: 10, dueDate: null })).status, 404);
    assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO public.invoices")), false);
  } finally { jobExists = true; }
});

test("SQL-like user content stays in parameters, not executable query text", async () => {
  const payload = "O'Brien'); DROP TABLE customers;--";
  assert.equal((await authorized({ action: "saveCustomer", fullName: payload, phone: "+254700000000", email: null, notes: null })).status, 200);
  assert.equal(statements.some(({ sql }) => sql.includes(payload)), false);
  assert.ok(statements.some(({ params }) => params.includes(payload)));
});

test("CSV export neutralizes formulas, whitespace and cell breakout payloads", () => {
  for (const value of ["=1+1", "+123", "-1+2", "@SUM(A1)", "  =cmd", "\t=1", "\r=1", "\n=1", "＝1+1", "\u0000=1"]) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("123.45"), '"123.45"');
});

function memoryStorage() {
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: (key) => storage[key] ?? null },
    setItem: { value: (key, value) => { storage[key] = String(value); } },
    removeItem: { value: (key) => { delete storage[key]; } },
  });
  return storage;
}

test("assistant storage is tab-local, user/role-scoped, validated and cleared on logout", () => {
  globalThis.window = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
  const event = { id: "event", at: new Date().toISOString(), actor: "Staff", label: "Payment", kind: "payment" };
  const owner = `${workshopId}:${userId}:owner`;
  const mechanic = `${workshopId}:${userId}:mechanic`;
  assistant.saveActivity(owner, [event]);
  assert.deepEqual(assistant.loadActivity(owner), [event]);
  assert.deepEqual(assistant.loadActivity(mechanic), []);
  assert.equal(Object.keys(window.localStorage).length, 0);
  window.sessionStorage.setItem(`garageos-activity-${mechanic}`, '{"broken":true}');
  window.sessionStorage.setItem(`garageos-snoozes-${mechanic}`, "null");
  assert.deepEqual(assistant.loadActivity(mechanic), []);
  assert.deepEqual(assistant.loadSnoozes(mechanic), {});
  window.localStorage.setItem("garageos-activity-old", "legacy personal data");
  window.localStorage.setItem("garageos-theme", "dark");
  assistant.clearAssistantStorage();
  assert.deepEqual(assistant.loadActivity(owner), []);
  assert.equal(window.localStorage.getItem("garageos-activity-old"), null);
  assert.equal(window.localStorage.getItem("garageos-theme"), "dark");
});
