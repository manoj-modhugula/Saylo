import { Transcript, cleanText, createHistory, newConversation, summarize } from "./conversations.js";
import { createBrowserDemo } from "./browser-demo.js";
// Browser demonstration or a live call to a configured Saylo server.
// over WHIP (WebRTC). The server is the public one in try-config.js, or one the
// visitor runs themselves. No credentials live here: keys stay on the server.
const cfg = window.SAYLO_TRY || {};
const $ = (id) => document.getElementById(id);

// --- nav border on scroll, copy buttons (as on the home page) ---------------
const nav = document.querySelector(".nav");
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 8), { passive: true });
for (const btn of document.querySelectorAll(".copy")) {
  btn.addEventListener("click", async () => {
    const code = btn.parentElement.querySelector("code").innerText.replace(/\s+#.*$/gm, "");
    try { await navigator.clipboard.writeText(code); btn.textContent = "Copied"; } catch { btn.textContent = "Select and copy"; }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  });
}

// --- which Saylo server ----------------------------------------------------
const publicServer = String(cfg.server || "").trim();
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
if (publicServer) {
  $("localSetup").hidden = true;
} else {
  $("server").value = store.get("saylo-try-server") || "";
}

// The voices the server is set up with, if it lets a call choose one
// (GET /voices, [tts] client_choice). No list, no picker: the page works as
// before against any server.
const voiceNames = {
  vibevoice: "Self-hosted voices (Kokoro, Piper, Sarvam)",
  cartesia: "Cartesia",
  elevenlabs: "ElevenLabs",
  deepgram: "Deepgram Aura",
  sarvam: "Sarvam",
};
async function loadVoices() {
  const field = $("voiceField"), select = $("voice");
  field.hidden = true;
  let base;
  try { base = serverBase(); } catch { return; }
  try {
    const res = await fetch(base + "/voices", { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return;
    const { voices, choosable } = await res.json();
    if (!choosable || !Array.isArray(voices) || voices.length < 2) return;
    select.replaceChildren(...voices.map((v, i) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = (voiceNames[v] || v) + (i === 0 ? " (default)" : "");
      return o;
    }));
    const saved = store.get("saylo-try-voice");
    if (saved && voices.includes(saved)) select.value = saved;
    field.hidden = false;
  } catch {}
}

function serverBase() {
  const raw = (publicServer || $("server").value.trim() || $("server").placeholder).replace(/\/+$/, "");
  let url;
  try { url = new URL(raw); } catch { throw new Error(`"${raw}" isn't a URL. Try http://localhost:8080`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The server address must start with http:// or https://");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (location.protocol === "https:" && url.protocol === "http:" && !local) {
    throw new Error("This page is HTTPS, so it can only reach your Saylo over HTTPS, or over http://localhost.");
  }
  if (!publicServer) store.set("saylo-try-server", $("server").value.trim());
  return url.origin;
}

// --- call ------------------------------------------------------------------
let pc = null, mic = null, sessionUrl = null, ended = true, meterStop = null, callGeneration = 0, connectAbort = null;
const log = $("log");

function setStatus(text, state = "") {
  $("statusText").textContent = text;
  $("status").className = "status" + (state ? " " + state : "");
}
function addTurn(who, text, cls) {
  const el = document.createElement("div");
  el.className = "turn " + cls;
  const b = document.createElement("b");
  b.textContent = who;
  const t = document.createElement("span");
  t.className = "text";
  t.textContent = text;
  el.append(b, t);
  log.appendChild(el);
  // The transcript scrolls inside its own panel, keeping page position stable.
  return el;
}
function addNote(text) {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = text;
  log.appendChild(el);
}
let transcript = new Transcript(), session = null, saveTimer = null;
const history = createHistory({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
}, () => { $("storageStatus").textContent = "Browser storage is unavailable or full. History changes will only last while this page is open."; });

function drawMessages(messages) {
  log.replaceChildren();
  for (const m of messages) {
    addTurn(m.role === "user" ? "You" : "Saylo", cleanText(m.text), (m.role === "user" ? "you" : "agent") + (!m.final ? " partial" : ""));
  }
  log.scrollTop = log.scrollHeight;
}
function drawHistory() {
  const items = history.list();
  $("clearHistory").disabled = !items.length || !ended;
  $("historyList").replaceChildren();
  if (!items.length) {
    const empty = document.createElement("li"); empty.className = "hint"; empty.textContent = "Your next hello starts here."; $("historyList").append(empty);
  }
  for (const item of items) {
    const li = document.createElement("li");
    const open = document.createElement("button"); open.type = "button"; open.className = "history-open"; open.disabled = !ended;
    const title = document.createElement("strong"); title.textContent = (item.messages.find(m => m.role === "user")?.text || "Conversation").slice(0, 64);
    const date = document.createElement("time"); date.dateTime = item.startedAt; date.textContent = new Date(item.startedAt).toLocaleString();
    open.append(title, date); open.addEventListener("click", () => { drawMessages(item.messages); showSummary(item.messages); $("sessionMode").textContent = item.mode === "browser" ? "Saved · browser demo" : "Saved · voice runtime"; });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "Delete"; remove.disabled = !ended; remove.setAttribute("aria-label", "Delete conversation: " + title.textContent);
    remove.addEventListener("click", () => { history.remove(item.id); drawHistory(); log.replaceChildren(); $("recap").hidden = true; }); li.append(open, remove); $("historyList").append(li);
  }
}
function showSummary(messages) {
  $("recap").hidden = !messages.length;
  $("summaryText").textContent = summarize(messages);
  $("copyStatus").textContent = "";
}
function saveProgress() {
  if (!session) return;
  session.messages = transcript.snapshot();
  history.save(session);
}
function beginSession() {
  clearTimeout(saveTimer);
  transcript = new Transcript(); session = newConversation($("mode").value);
  log.replaceChildren(); $("recap").hidden = true;
  $("mode").disabled = $("language").disabled = true;
  $("sessionMode").textContent = session.mode === "browser" ? "Browser demo · local replies" : "Self-hosted voice runtime";
  drawHistory();
}
function finishSession() {
  clearTimeout(saveTimer);
  saveProgress(); showSummary(transcript.snapshot()); session = null;
  $("mode").disabled = $("language").disabled = false;
  drawHistory();
}
function onEvent(raw) {
  let msg;
  try { msg = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
  if (!msg || !session) return;
  transcript.event(msg);
  if (msg.type === "transcript" || msg.type === "response") drawMessages(transcript.messages);
  if (msg.type === "state") {
    const labels = { listening: "Ready to listen", thinking: "Saylo is thinking", speaking: "Saylo is speaking" };
    if (labels[msg.state]) setStatus(labels[msg.state], msg.state);
    drawMessages(transcript.messages);
  }
  clearTimeout(saveTimer); saveTimer = setTimeout(saveProgress, 350);
}
const browserDemo = createBrowserDemo({
  emit: onEvent, note: addNote, language: () => $("language").value,
  speak: () => $("speak").checked,
  listening: (active) => { $("listen").textContent = active ? "Stop microphone" : "Use microphone"; },
});
function toggleMode() {
  const browser = $("mode").value === "browser";
  if (ended) $("sessionMode").textContent = browser ? "Browser demo" : "Self-hosted voice runtime";
  $("localSetup").hidden = browser;
  $("browserSetup").hidden = !browser;
  $("messageForm").hidden = !browser;
  $("runtimeHint").hidden = browser;
  if (!browser) loadVoices();
}
// Links may select an experience, but never start a call or request a microphone.
const requestedMode = new URLSearchParams(location.search).get("mode");
if (requestedMode === "server" || requestedMode === "browser") $("mode").value = requestedMode;
$("mode").addEventListener("change", toggleMode); toggleMode();
if (!browserDemo.supported) $("speechHint").textContent = "Voice input is not supported in this browser. Type below to try the demo; spoken replies depend on installed voices. Transcripts stay in this browser.";
$("messageForm").addEventListener("submit", (event) => { event.preventDefault(); browserDemo.send($("message").value); $("message").value = ""; });
$("listen").addEventListener("click", () => browserDemo.listen());
$("speak").addEventListener("change", () => { if (!$("speak").checked) globalThis.speechSynthesis?.cancel(); });
$("clearHistory").addEventListener("click", () => { history.clear(); drawHistory(); log.replaceChildren(); $("recap").hidden = true; });
$("copySummary").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("summaryText").textContent); $("copyStatus").textContent = "Recap copied."; }
  catch { $("copyStatus").textContent = "Clipboard unavailable. Select the recap text to copy it."; }
});
drawHistory();

function startMeter(stream) {
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  let raf;
  (function tick() {
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    $("meterBar").style.width = Math.min(100, peak * 1.6) + "%";
    raf = requestAnimationFrame(tick);
  })();
  meterStop = () => { cancelAnimationFrame(raf); ctx.close(); $("meterBar").style.width = "0"; meterStop = null; };
}

async function waitForIce(conn) {
  if (conn.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    conn.addEventListener("icegatheringstatechange", () => conn.iceGatheringState === "complete" && resolve());
    setTimeout(resolve, 2000);
  });
}

async function call() {
  $("call").disabled = true;
  ended = false;
  beginSession();
  const generation = ++callGeneration;
  $("hang").disabled = false;
  if ($("mode").value === "browser") {
    $("hang").disabled = false;
    $("message").disabled = $("send").disabled = false;
    $("listen").disabled = !browserDemo.supported;
    browserDemo.start(); $("message").focus(); return;
  }
  try {
    const base = serverBase();
    setStatus("Asking for your microphone…");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (ended || generation !== callGeneration) { stream.getTracks().forEach(t => t.stop()); return; }
    mic = stream;
    startMeter(mic);

    setStatus("Connecting…");
    const conn = pc = new RTCPeerConnection();
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    pc.ontrack = (e) => { $("remote").srcObject = e.streams[0] || new MediaStream([e.track]); };
    const dc = pc.createDataChannel("events"); // before the offer, or no transcripts arrive
    dc.onmessage = (e) => onEvent(e.data);
    pc.onconnectionstatechange = () => {
      if (ended || pc !== conn) return;
      const s = conn.connectionState;
      if (s === "connected") setStatus("Connected. Say hello, or wait for Saylo.", "live");
      if ((s === "disconnected" || s === "failed" || s === "closed") && !ended) {
        addNote(s === "failed" ? "The audio connection failed." : "Call ended.");
        cleanup();
      }
    };
    const offer = await conn.createOffer();
    if (ended || generation !== callGeneration) return;
    await conn.setLocalDescription(offer);
    await waitForIce(conn);
    if (ended || generation !== callGeneration) return;
    connectAbort = new AbortController();

    let resp;
    try {
      const voice = $("voiceField").hidden ? "" : $("voice").value;
      if (voice) store.set("saylo-try-voice", voice);
      resp = await fetch(base + "/whip" + (voice ? "?voice=" + encodeURIComponent(voice) : ""), { method: "POST", headers: { "Content-Type": "application/sdp" }, body: conn.localDescription.sdp, signal: AbortSignal.any([connectAbort.signal, AbortSignal.timeout(15000)]) });
    } catch {
      const port = new URL(base).port;
      if (port === "8400" || port === "8410" || port === "9101") {
        throw new Error(`${base} is the quickstart's call page or demo agent, not the Saylo server. Use the server's address: http://localhost:8080 by default.`);
      }
      throw new Error(`Couldn't reach a Saylo server at ${base}. Is it running (port 8080 by default), and did you allow this page to reach it?`);
    }
    if (ended || generation !== callGeneration) return;
    if (resp.status === 429) throw new Error("Too many calls right now. Try again in a minute.");
    if (resp.status === 503) throw new Error("Saylo is busy with other calls. Try again shortly.");
    if (resp.status !== 201) throw new Error(`The Saylo server answered ${resp.status}.`);
    const loc = resp.headers.get("Location");
    sessionUrl = loc ? new URL(loc, base).href : null;
    const answer = await resp.text();
    if (ended || generation !== callGeneration) return;
    await conn.setRemoteDescription({ type: "answer", sdp: answer });
    if (ended || generation !== callGeneration) return;
    $("hang").disabled = false;
  } catch (err) {
    if (generation !== callGeneration) return;
    addNote(String(err.message || err));
    cleanup();
  }
}

function cleanup(keepalive = false) {
  ended = true;
  callGeneration++;
  connectAbort?.abort(); connectAbort = null;
  const resource = sessionUrl; sessionUrl = null;
  if (resource) fetch(resource, { method: "DELETE", keepalive }).catch(() => {});
  browserDemo.stop();
  $("message").disabled = $("send").disabled = $("listen").disabled = true;
  finishSession();
  if (pc) { pc.close(); pc = null; }
  if (mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }
  if (meterStop) meterStop();
  $("call").disabled = false;
  $("hang").disabled = true;
  setStatus($("mode").value === "browser" ? "Conversation ended" : "Not connected");
}

function hangUp() {
  addNote("Conversation ended.");
  cleanup();
}

$("call").addEventListener("click", call);
$("server").addEventListener("change", loadVoices);
if (publicServer) loadVoices();
$("hang").addEventListener("click", hangUp);
// Leaving the page ends the call on the server too.
addEventListener("pagehide", () => { if (session) cleanup(true); });
