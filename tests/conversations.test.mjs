import test from "node:test";
import assert from "node:assert/strict";
import {
  Transcript,
  createHistory,
  newConversation,
  summarize,
  HISTORY_KEY,
} from "../site/conversations.js";
import { demoReply, createBrowserDemo } from "../site/browser-demo.js";
function memory() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
const session = (text = "Hello") => ({
  ...newConversation("browser"),
  messages: [{ role: "user", text, final: true }],
});
test("partial speech is replaced, final turns and chunked responses are retained", () => {
  const t = new Transcript();
  t.event({ type: "transcript", text: "Hel", final: false });
  assert.equal(t.snapshot().length, 0);
  t.event({ type: "transcript", text: "Hello", final: true });
  t.event({ type: "response", text: "[la" });
  t.event({ type: "response", text: "ng:en] Hi" });
  t.event({ type: "state", state: "listening" });
  t.event({ type: "transcript", text: "Another question", final: true });
  assert.deepEqual(
    t.snapshot().map((m) => m.text),
    ["Hello", "Hi", "Another question"],
  );
  assert.equal(t.snapshot()[1].final, true);
});
test("barge-in preserves interleaved caller and assistant turns", () => {
  const t = new Transcript();
  t.event({ type: "response", text: "A long reply" });
  t.event({ type: "transcript", text: "Wait", final: false });
  t.event({ type: "transcript", text: "Wait please", final: true });
  t.event({ type: "state", state: "thinking" });
  t.event({ type: "response", text: "Go ahead" });
  assert.deepEqual(
    t.snapshot().map((m) => m.text),
    ["A long reply", "Wait please", "Go ahead"],
  );
});
test("malformed events do not add turns; text and session size are bounded", () => {
  const t = new Transcript();
  [null, {}, "bad", { type: "transcript", text: 7 }].forEach((e) => t.event(e));
  assert.equal(t.snapshot().length, 0);
  for (let i = 0; i < 450; i++)
    t.event({ type: "transcript", text: "x".repeat(5000), final: true });
  assert.equal(t.snapshot().length, 400);
  assert.equal(t.snapshot()[0].text.length, 4000);
});
test("history survives reload, updates a session, caps at 20, deletes and clears", () => {
  const storage = memory();
  const h = createHistory(storage);
  const first = session();
  h.save(first);
  h.save(first);
  assert.equal(h.list().length, 1);
  for (let i = 0; i < 25; i++) h.save(session(String(i)));
  const reloaded = createHistory(storage);
  assert.equal(reloaded.list().length, 20);
  assert.equal(reloaded.list()[0].messages[0].text, "24");
  const list = reloaded.list();
  list[0].messages[0].text = "changed";
  assert.equal(reloaded.list()[0].messages[0].text, "24");
  reloaded.remove(list[0].id);
  assert.equal(reloaded.list().length, 19);
  reloaded.clear();
  assert.equal(storage.getItem(HISTORY_KEY), undefined);
});
test("corrupt and unavailable storage gracefully falls back to memory", () => {
  let errors = 0;
  const broken = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
    removeItem() {
      throw Error();
    },
  };
  const h = createHistory(broken, () => errors++);
  h.save(session());
  assert.equal(h.list().length, 1);
  h.clear();
  assert.equal(h.list().length, 0);
  assert.equal(errors, 3);
  const storage = memory();
  storage.setItem(HISTORY_KEY, "{oops");
  assert.deepEqual(createHistory(storage).list(), []);
  storage.setItem(HISTORY_KEY, JSON.stringify([{ id: "invalid" }]));
  assert.deepEqual(createHistory(storage).list(), []);
});
test("recaps quote actual completed text and local responses make no model claims", () => {
  assert.match(summarize(session("A project idea").messages), /A project idea/);
  assert.equal(summarize([]), "No completed turns were captured.");
  assert.match(demoReply("help", "en-US"), /not an AI model/);
  for (const lang of ["en-US", "es-ES", "fr-FR", "hi-IN", "ja-JP", "ta-IN"])
    assert.ok(demoReply("hello", lang));
});
test("browser demo ignores input outside active sessions and stops cleanly without speech APIs", () => {
  const events = [];
  const demo = createBrowserDemo({
    emit: (e) => events.push(e),
    note: () => {},
    language: () => "en-US",
    speak: () => false,
    listening: () => {},
  });
  demo.send("hi");
  assert.equal(events.length, 0);
  demo.start();
  demo.send("hi");
  assert.ok(events.some((e) => e.type === "transcript" && e.final));
  assert.ok(events.some((e) => e.type === "response"));
  demo.stop();
  const length = events.length;
  demo.send("hello");
  assert.equal(events.length, length);
});

test("large histories stay within the serialized storage budget", () => {
  const storage = memory(),
    h = createHistory(storage);
  for (let i = 0; i < 6; i++) {
    const item = session();
    item.messages = Array.from({ length: 100 }, () => ({
      role: "user",
      text: "x".repeat(4000),
      final: true,
    }));
    h.save(item);
  }
  assert.ok(storage.getItem(HISTORY_KEY).length <= 1_800_000);
  assert.ok(createHistory(storage).list().length > 0);
});
test("speech recognition handles interim, final, permission errors and stop", () => {
  const previous = globalThis.SpeechRecognition;
  let instance,
    aborted = 0;
  class Recognition {
    constructor() {
      instance = this;
    }
    start() {}
    abort() {
      aborted++;
    }
  }
  globalThis.SpeechRecognition = Recognition;
  try {
    const events = [],
      notes = [];
    const demo = createBrowserDemo({
      emit: (e) => events.push(e),
      note: (n) => notes.push(n),
      language: () => "en-US",
      speak: () => false,
      listening: () => {},
    });
    demo.start();
    demo.listen();
    const interim = [{ transcript: "hel" }];
    interim.isFinal = false;
    instance.onresult({ resultIndex: 0, results: [interim] });
    const final = [{ transcript: "hello" }];
    final.isFinal = true;
    instance.onresult({ resultIndex: 0, results: [final] });
    assert.ok(events.some((e) => e.text === "hel" && e.final === false));
    assert.ok(events.some((e) => e.text === "hello" && e.final === true));
    assert.ok(events.some((e) => e.type === "response"));
    demo.listen();
    instance.onerror({ error: "not-allowed" });
    assert.match(notes[0], /type instead/);
    demo.listen();
    demo.stop();
    assert.ok(aborted >= 3);
    assert.equal(instance.onresult, null);
  } finally {
    if (previous) globalThis.SpeechRecognition = previous;
    else delete globalThis.SpeechRecognition;
  }
});
test("cancelled speech callbacks cannot change a later session", () => {
  const original = {
    synth: globalThis.speechSynthesis,
    utterance: globalThis.SpeechSynthesisUtterance,
  };
  const spoken = [],
    events = [],
    notes = [];
  globalThis.speechSynthesis = {
    cancel() {},
    getVoices() {
      return [];
    },
    speak: (u) => spoken.push(u),
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  try {
    const demo = createBrowserDemo({
      emit: (e) => events.push(e),
      note: (n) => notes.push(n),
      language: () => "en-US",
      speak: () => true,
      listening: () => {},
    });
    demo.start();
    demo.send("hello");
    demo.send("help");
    const n = events.length;
    spoken[0].onend();
    spoken[0].onerror();
    assert.equal(events.length, n);
    assert.equal(notes.length, 0);
    demo.stop();
    spoken[1].onend();
    assert.equal(events.length, n);
  } finally {
    globalThis.speechSynthesis = original.synth;
    globalThis.SpeechSynthesisUtterance = original.utterance;
  }
});
