// Event projection and bounded local history. No audio or credentials are stored.
export const HISTORY_KEY = "saylo.conversations.v1"; // gitleaks:allow -- public localStorage namespace, not a credential.
export const MAX_SESSIONS = 20;
export const MAX_MESSAGES = 400;
const MAX_TEXT = 4000;
export const cleanText = (text) =>
  String(text)
    .replace(/\[(lang|voice):[^\]]*\]/gi, " ")
    .trim();
export function newConversation(mode, now = new Date()) {
  return {
    id: globalThis.crypto.randomUUID(),
    startedAt: now.toISOString(),
    mode,
    messages: [],
  };
}
export class Transcript {
  constructor() {
    this.messages = [];
    this.partial = null;
    this.agent = null;
  }
  event(event) {
    if (!event || typeof event !== "object") return;
    if (
      event.type === "transcript" &&
      typeof event.text === "string" &&
      event.text.trim()
    ) {
      if (!this.partial) {
        this.partial = { role: "user", text: "", final: false };
        this.messages.push(this.partial);
      }
      this.partial.text = event.text.slice(0, MAX_TEXT);
      this.partial.final = event.final === true;
      if (this.partial.final) this.partial = null;
    } else if (event.type === "response" && typeof event.text === "string") {
      if (!this.agent) {
        this.agent = { role: "assistant", text: "", final: false };
        this.messages.push(this.agent);
      }
      // Clean only when displaying, since tags may be split across chunks.
      this.agent.text = (this.agent.text + event.text).slice(0, MAX_TEXT);
    } else if (
      event.type === "state" &&
      ["thinking", "listening"].includes(event.state)
    ) {
      if (this.agent) this.agent.final = true;
      this.agent = null;
    }
    if (this.messages.length > MAX_MESSAGES)
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
  }
  snapshot() {
    return this.messages
      .filter((m) => m.role === "assistant" || m.final)
      .map((m) => ({ ...m, text: cleanText(m.text) }))
      .filter((m) => m.text);
  }
}
export function summarize(messages) {
  if (!messages.length) return "No completed turns were captured.";
  const users = messages.filter((m) => m.role === "user");
  const assistant = messages.filter((m) => m.role === "assistant").at(-1);
  const quote = (s) => (s.length > 220 ? s.slice(0, 217) + "…" : s);
  return [
    `${users.length} user ${users.length === 1 ? "turn" : "turns"} recorded.`,
    users[0] ? `You opened with: “${quote(users[0].text)}”` : "",
    users.length > 1 ? `Your last message: “${quote(users.at(-1).text)}”` : "",
    assistant ? `Last assistant response: “${quote(assistant.text)}”` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
function validSession(s) {
  return (
    s &&
    typeof s.id === "string" &&
    s.id.length <= 100 &&
    typeof s.startedAt === "string" &&
    Number.isFinite(Date.parse(s.startedAt)) &&
    ["browser", "server"].includes(s.mode) &&
    Array.isArray(s.messages) &&
    s.messages.length <= MAX_MESSAGES &&
    s.messages.every(
      (m) =>
        m &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.text === "string" &&
        m.text.length <= MAX_TEXT,
    )
  );
}
export function createHistory(storage, onError = () => {}) {
  let items = [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (raw && raw.length > 2_000_000) throw new Error("History is too large");
    const data = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) throw new Error("Invalid history");
    items = data.filter(validSession).slice(0, MAX_SESSIONS);
  } catch {
    onError();
  }
  function persist() {
    try {
      storage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch {
      onError();
    }
  }
  return {
    list: () => structuredClone(items),
    save(session) {
      if (!validSession(session) || !session.messages.length) return;
      items = [
        structuredClone(session),
        ...items.filter((s) => s.id !== session.id),
      ].slice(0, MAX_SESSIONS);
      while (items.length > 1 && JSON.stringify(items).length > 1_800_000)
        items.pop();
      persist();
    },
    remove(id) {
      items = items.filter((s) => s.id !== id);
      persist();
    },
    clear() {
      items = [];
      try {
        storage.removeItem(HISTORY_KEY);
      } catch {
        onError();
      }
    },
  };
}
