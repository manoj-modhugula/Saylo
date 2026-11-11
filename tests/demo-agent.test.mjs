import test from "node:test";
import assert from "node:assert/strict";
import { createAgentServer } from "../demo-agent/server.mjs";

async function withAgent(run, options) {
  const server = createAgentServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/agent`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}
const request = (url, body, headers = {}) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("sample application accepts all four runtime events over HTTP", async () => {
  await withAgent(async (url) => {
    for (const [body, expected] of [
      [{ type: "listen", session_id: "sample" }, {}],
      [{ type: "oneshot" }, { text: "" }],
    ]) {
      const res = await request(url, body);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), expected);
    }
    const greeting = await request(url, { type: "greeting" });
    assert.equal(greeting.status, 200);
    assert.match((await greeting.json()).text, /\[lang:en\].*sample college/);
    for (const [question, expected] of [
      ["What are your opening hours?", /9 AM to 5 PM/],
      ["Which documents do I need?", /photo ID/],
      ["Where is the office?", /room 101/],
      ["Tell me about scholarships", /sample desk answers in English/],
    ]) {
      const res = await request(url, { type: "chat", session_id: "sample", language: "en", text: question });
      assert.equal(res.status, 200);
      const reply = await res.json();
      assert.match(reply.text, expected);
      assert.equal(reply.end_call, undefined);
    }
    const goodbye = await request(url, { type: "chat", text: "Goodbye" });
    assert.equal((await goodbye.json()).end_call, true);
  });
});

test("sample endpoint rejects malformed, oversized, and unauthorized requests", async () => {
  await withAgent(async (url) => {
    assert.equal((await request(url, { type: "chat", text: "hours" })).status, 401);
    const headers = { Authorization: "Bearer test-key" };
    for (const body of [null, [], { type: "unknown" }, { type: "chat", text: 12 }, { type: "chat", text: " " }]) {
      assert.equal((await request(url, body, headers)).status, 400);
    }
    assert.equal((await request(url, { type: "chat", text: "x".repeat(33000) }, headers)).status, 413);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{" })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers, body: "hello" })).status, 415);
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url + "/missing")).status, 404);
    assert.equal((await request(url, { type: "chat", text: "hours" }, headers)).status, 200);
  }, { apiKey: "test-key" });
});
