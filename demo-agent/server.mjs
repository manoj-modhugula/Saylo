import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// Fictional facts for an English-only application integration example.
export function answerTurn(turn) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) return null;
  switch (turn.type) {
    case "listen":
      return {}; // No caller language is known in this stateless example.
    case "greeting":
      return { text: "[lang:en] Hello, this is the Saylo sample college enquiry desk. Ask about office hours, application documents, or location." };
    case "oneshot":
      return { text: "" };
    case "chat": {
      if (typeof turn.text !== "string" || !turn.text.trim() || turn.text.length > 4000) return null;
      const text = turn.text.toLowerCase();
      if (/\b(bye|goodbye)\b/.test(text)) return { text: "[lang:en] Thanks for calling the sample enquiry desk. Goodbye.", end_call: true };
      if (/\b(hours|open|opening|close|closing|time)\b/.test(text)) return { text: "[lang:en] In this fictional example, the admissions office is open Monday to Friday, from 9 AM to 5 PM." };
      if (/\b(documents?|application|apply|requirements?)\b/.test(text)) return { text: "[lang:en] For this fictional example, bring a photo ID, your academic transcript, and a completed application form." };
      if (/\b(where|location|address|directions?)\b/.test(text)) return { text: "[lang:en] In this fictional example, the admissions office is in the main building, room 101." };
      return { text: "[lang:en] This sample desk answers in English about office hours, application documents, and location. Which would you like?" };
    }
    default:
      return null;
  }
}

export function createAgentServer({ apiKey = "" } = {}) {
  return createServer(async (req, res) => {
    function send(status, value) {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    }
    if (req.url !== "/agent") return send(404, { error: "Not found" });
    if (req.method !== "POST") return send(405, { error: "Use POST" });
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: "Unauthorized" });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) return send(415, { error: "Use application/json" });
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 32768) return send(413, { error: "Request too large" });
        chunks.push(chunk);
      }
      const reply = answerTurn(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!reply) return send(400, { error: "Expected listen, greeting, chat with text, or oneshot" });
      send(200, reply);
    } catch {
      if (!res.headersSent) send(400, { error: "Invalid JSON request" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SAYLO_AGENT_PORT || 9102);
  const server = createAgentServer({ apiKey: process.env.STREAMCORE_AGENT_API_KEY || "" });
  server.requestTimeout = 10000;
  server.listen(port, "127.0.0.1", () => console.log(`Saylo sample agent: http://127.0.0.1:${port}/agent`));
}
