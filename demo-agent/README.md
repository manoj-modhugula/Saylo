# Saylo sample application endpoint

An English-only, fictional college enquiry desk. It implements the existing
runtime's four-event HTTP contract without packages, model calls, credentials,
a database, or appointment-booking claims. Answers come from explicit local
rules and fictional facts. This is an application example, not an AI model.

## Run and exercise the application

```sh
node demo-agent/server.mjs
```

In another terminal:

```sh
curl http://127.0.0.1:9102/agent \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sample","type":"chat","language":"en","text":"What are your opening hours?"}'
npm test
```

The response contains an English language tag and the fictional office hours.
The HTTP tests cover all four events, FAQ answers, ending a conversation,
authentication, malformed input and request limits. They do not send audio.

## Connect the runtime

With the sample running, change the existing `[agent]` section in your local
runtime config to:

```toml
[agent]
url = "http://127.0.0.1:9102/agent"
```

If using `STREAMCORE_AGENT_API_KEY`, give the sample process and runtime the
same value. Do not put credentials in browser code. Port 9102 avoids conflict
with the original quickstart agent on 9101. The sample binds to loopback and is
intended for local use; containers need a network route to that host address.

Once the Go voice server, speech providers and voice router are running, use
the quickstart call page or Saylo's self-hosted runtime mode.

## Cost and hardware

Running this endpoint and its HTTP tests costs nothing. The speech pipeline
uses your speech-provider accounts. Its default Docker voice-router service
reserves an NVIDIA GPU for Kokoro text-to-speech. The router also supports
`--device cpu`.
