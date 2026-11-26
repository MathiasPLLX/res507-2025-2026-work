import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";

let app;

// Build one app instance for all tests, close it at the end
before(async () => {
  app = await buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("GET /health returns ok when the database is up", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, db: "up" });
});

test("GET /api/quotes returns a JSON array", async () => {
  const res = await app.inject({ method: "GET", url: "/api/quotes" });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.ok(Array.isArray(res.json()));
});

test("GET / renders the HTML page", async () => {
  const res = await app.inject({ method: "GET", url: "/" });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /QuoteBoard/);
});

test("POST /quotes with empty text redirects without saving", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/quotes",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ author: "Tester", text: "   " }).toString(),
  });

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "/");
});

test("POST /quotes saves the quote and it appears in /api/quotes", async () => {
  const text = `Test quote ${Date.now()}`;

  const post = await app.inject({
    method: "POST",
    url: "/quotes",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ author: "Tester", text }).toString(),
  });

  assert.equal(post.statusCode, 302);
  assert.equal(post.headers.location, "/");

  const list = await app.inject({ method: "GET", url: "/api/quotes" });
  const saved = list.json().find((q) => q.text === text);

  assert.ok(saved, "the new quote should be returned by /api/quotes");
  assert.equal(saved.author, "Tester");
});
