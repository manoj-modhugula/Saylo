// Deliberately small local responses: this is an interface demo, not an LLM.
const replies = {
  en: [
    "Hello! I’m Saylo. Ask me about this demo, or tell me something you’d like to remember.",
    "This free demo offers voice input, live transcripts, local history, and extractive recaps. My replies use simple rules, not an AI model.",
    "I heard you. This demo saves your words in the transcript; it does not reason about them.",
  ],
  es: [
    "¡Hola! Soy Saylo. Pregúntame sobre esta demo.",
    "Esta demo tiene transcripciones, historial local y resúmenes extractivos. Mis respuestas usan reglas, no un modelo de IA.",
    "Te escuché. Esta demo guarda tus palabras en la transcripción; no razona sobre ellas.",
  ],
  fr: [
    "Bonjour ! Je suis Saylo. Posez-moi une question sur cette démo.",
    "Cette démo propose une transcription, un historique local et des extraits récapitulatifs. Mes réponses suivent des règles, sans modèle d’IA.",
    "Je vous ai entendu. Cette démo conserve vos mots dans la transcription, sans les analyser.",
  ],
  hi: [
    "नमस्ते! मैं Saylo हूँ। इस डेमो के बारे में पूछिए।",
    "इस डेमो में ट्रांसक्रिप्ट, स्थानीय इतिहास और बातचीत के चुनिंदा अंश हैं। मेरे जवाब नियमों पर आधारित हैं, AI मॉडल पर नहीं।",
    "आपकी बात ट्रांसक्रिप्ट में दर्ज है। यह डेमो आपकी बात पर तर्क नहीं करता।",
  ],
  ja: [
    "こんにちは！Sayloです。このデモについて聞いてください。",
    "このデモには文字起こし、ローカル履歴、会話の抜粋があります。返答はAIモデルではなくルールに基づいています。",
    "言葉を文字起こしに記録しました。このデモは内容を推論しません。",
  ],
  ta: [
    "வணக்கம்! நான் Saylo. இந்த டெமோ பற்றி கேளுங்கள்.",
    "இந்த டெமோவில் உரையாக்கம், உள்ளூர் வரலாறு மற்றும் உரையாடல் பகுதிகள் உள்ளன. பதில்கள் விதிகளின் அடிப்படையில் வருகின்றன; AI மாதிரி இல்லை.",
    "உங்கள் சொற்கள் உரையாடலில் பதிவாகியுள்ளன. இந்த டெமோ அவற்றைப் பற்றி சிந்திப்பதில்லை.",
  ],
};
export function demoReply(text, locale) {
  const choices = replies[locale.split("-")[0]] || replies.en;
  if (
    /^(hello|hi|hey|hola|bonjour|salut|नमस्ते|こんにちは|வணக்கம்)[\s!।。.]*$/iu.test(
      text.trim(),
    )
  )
    return choices[0];
  if (/saylo|demo|help|features|ayuda|aide|डेमो|デモ|டெமோ/iu.test(text))
    return choices[1];
  return choices[2];
}
export function createBrowserDemo({ emit, note, language, speak, listening }) {
  let recognition = null,
    active = false,
    playback = 0;
  const Recognition =
    globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  function stopListening() {
    const previous = recognition;
    recognition = null;
    if (previous) {
      previous.onresult = previous.onerror = previous.onend = null;
      previous.abort();
    }
    listening(false);
  }
  function send(text) {
    if (!active || !text.trim()) return;
    stopListening();
    const currentPlayback = ++playback;
    globalThis.speechSynthesis?.cancel();
    emit({ type: "transcript", text: text.trim(), final: true });
    emit({ type: "state", state: "thinking" });
    const reply = demoReply(text, language());
    emit({ type: "response", text: reply });
    emit({ type: "state", state: "speaking" });
    const done = () => {
      if (active && currentPlayback === playback)
        emit({ type: "state", state: "listening" });
    };
    if (
      speak() &&
      globalThis.speechSynthesis &&
      globalThis.SpeechSynthesisUtterance
    ) {
      const utterance = new SpeechSynthesisUtterance(reply);
      utterance.lang = language();
      const prefix = language().split("-")[0];
      const voice = speechSynthesis
        .getVoices()
        .find((v) => v.lang.split("-")[0] === prefix);
      if (voice) utterance.voice = voice;
      utterance.onend = done;
      utterance.onerror = () => {
        if (!active || currentPlayback !== playback) return;
        note("Speech playback was unavailable. You can still read the reply.");
        done();
      };
      speechSynthesis.speak(utterance);
    } else done();
  }
  return {
    supported: !!Recognition,
    start() {
      active = true;
      emit({ type: "state", state: "listening" });
    },
    send,
    listen() {
      if (!active || !Recognition) return;
      if (recognition) {
        stopListening();
        return;
      }
      playback++;
      globalThis.speechSynthesis?.cancel();
      emit({ type: "state", state: "listening" });
      recognition = new Recognition();
      recognition.lang = language();
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            send(text);
            return;
          }
          emit({ type: "transcript", text, final: false });
        }
      };
      recognition.onerror = (event) => {
        note(`Voice input: ${event.error}. You can type instead.`);
        stopListening();
      };
      recognition.onend = () => {
        recognition = null;
        listening(false);
      };
      try {
        recognition.start();
        listening(true);
      } catch {
        note("Could not start the microphone. You can type instead.");
        stopListening();
      }
    },
    stop() {
      active = false;
      playback++;
      stopListening();
      globalThis.speechSynthesis?.cancel();
    },
  };
}
