# Portfolio presentation

**Saylo — multilingual voice interface**

A personal portfolio project for multilingual voice conversations, with live transcripts, browser-local conversation history, copyable recaps, and a browser speech demo.

## Resume bullets

- Extended an existing WebRTC voice interface with complete event-driven transcripts, handling partial recognition, streamed assistant responses, and interleaved speech without changing the backend pipeline.
- Implemented bounded browser-local session history with reopening, deletion, storage-error fallback, and copyable extractive conversation recaps; added a separate browser speech demo requiring no paid APIs or GPU.
- Added focused Node tests for transcript events, persistence limits, recognition errors, and speech-cancellation lifecycle, plus static frontend checks in CI.
