/* ============================================================
   心绘 ArtMind — 声音引擎
   · 朗读：电脑优先系统朗读；手机优先服务端中文语音（/api/tts），
     系统朗读不出声时自动改用服务端语音。
   · 白噪音：在浏览器里实时合成海浪 / 雨声 / 森林 / 白噪音，无需音频素材。
   手机浏览器只允许在用户触摸后发声，且 iOS 静音键会让网页音频（Web Audio）
   和系统朗读一起静音，所以全部通过 <audio> 元素播放，并在第一次触摸时解锁。
   ============================================================ */
window.ArtMindAudio = (() => {
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android|Mobile|MicroMessenger|QQ\//i.test(ua);
  const hasNativeTTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  const SAMPLE_RATE = 22050;
  const MAX_TTS_LEN = 300;

  const voiceEl = createAudio();
  const noiseEl = createAudio();
  noiseEl.loop = true;
  const fxEl = createAudio();
  let fxUrl = "";

  let unlocked = false;
  let silentUrl = "";
  let zhVoice = null;
  let nativeBroken = false;
  let speakToken = 0;
  let noiseKind = null;
  let noiseVolume = 0.6;
  const ttsCache = new Map();
  const noiseCache = new Map();

  function createAudio() {
    const el = new Audio();
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    return el;
  }

  /* ---------------- WAV 编码 ---------------- */
  function encodeWav(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  }

  function getSilentUrl() {
    if (!silentUrl) silentUrl = encodeWav(new Float32Array(SAMPLE_RATE / 10));
    return silentUrl;
  }

  /* ---------------- 白噪音合成 ---------------- */
  // 循环长度取 12 秒（海浪周期 6 秒的整数倍），尾部 1 秒与开头交叉淡化，循环无接缝。
  function synthNoise(kind) {
    const seconds = 12;
    const n = SAMPLE_RATE * seconds;
    const fade = SAMPLE_RATE;
    const out = new Float32Array(n + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let brown = 0, soft = 0, drop = 0;

    const chirps = kind === "forest" ? [1.6, 4.3, 7.7, 9.9].map((t) => Math.floor(t * SAMPLE_RATE)) : [];

    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      brown = (brown + 0.02 * white) / 1.02;
      const t = i / SAMPLE_RATE;
      let v = 0;

      if (kind === "white") {
        soft += 0.55 * (white - soft);
        v = soft * 0.5;
      } else if (kind === "rain") {
        if (Math.random() < 0.0012) drop = 0.6 + Math.random() * 0.4;
        drop *= 0.992;
        v = pink * 0.55 + white * drop * 0.12;
      } else if (kind === "ocean") {
        const swell = Math.sin((Math.PI * t) / 6);
        const env = 0.18 + 0.82 * swell * swell;
        v = (brown * 3.2 + pink * 0.25) * env;
      } else if (kind === "forest") {
        const breeze = 0.75 + 0.25 * Math.sin((2 * Math.PI * t) / 3);
        v = pink * 0.22 * breeze + brown * 0.8;
        for (const start of chirps) {
          const d = i - start;
          if (d < 0 || d > SAMPLE_RATE * 0.5) continue;
          const note = d % Math.floor(SAMPLE_RATE * 0.12);
          const len = SAMPLE_RATE * 0.08;
          if (note > len) continue;
          const p = note / len;
          const freq = 2800 + 900 * p;
          v += Math.sin((2 * Math.PI * freq * note) / SAMPLE_RATE) * Math.sin(Math.PI * p) * 0.18;
        }
      }
      out[i] = v;
    }

    for (let j = 0; j < fade; j++) {
      const k = j / fade;
      out[j] = out[j] * k + out[n + j] * (1 - k);
    }
    const loop = out.subarray(0, n);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(loop[i]));
    const gain = peak > 0 ? 0.55 / peak : 1;
    for (let i = 0; i < n; i++) loop[i] *= gain;
    return encodeWav(loop);
  }

  function noiseUrl(kind) {
    if (!noiseCache.has(kind)) noiseCache.set(kind, synthNoise(kind));
    return noiseCache.get(kind);
  }

  function startNoise(kind) {
    if (!kind || kind === "none") return stopNoise();
    noiseKind = kind;
    noiseEl.src = noiseUrl(kind);
    noiseEl.volume = noiseVolume;
    return noiseEl.play().catch(() => {});
  }

  function pauseNoise() { noiseEl.pause(); }

  function resumeNoise() {
    if (noiseKind) noiseEl.play().catch(() => {});
  }

  function stopNoise() {
    noiseKind = null;
    noiseEl.pause();
    noiseEl.removeAttribute("src");
    noiseEl.load();
  }

  function setNoiseVolume(value) {
    noiseVolume = Math.max(0, Math.min(1, value));
    noiseEl.volume = noiseVolume;
  }

  function duck(on) {
    if (noiseKind) noiseEl.volume = on ? noiseVolume * 0.35 : noiseVolume;
  }

  /* ---------------- 旋律与提示音 ---------------- */
  // notes: [{ f: 频率 Hz, d: 时长秒 }]，合成带泛音和衰减的钢琴感音色
  function renderNotes(notes) {
    const release = 0.45;
    const total = notes.reduce((s, n) => s + n.d, 0) + release;
    const out = new Float32Array(Math.ceil(total * SAMPLE_RATE));
    let at = 0;
    for (const { f, d } of notes) {
      const start = Math.floor(at * SAMPLE_RATE);
      const len = Math.floor((d + release) * SAMPLE_RATE);
      for (let i = 0; i < len && start + i < out.length; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.015) * Math.exp(-t * (2.2 / Math.max(0.25, d)));
        const w = 2 * Math.PI * f * t;
        out[start + i] += (Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.1 * Math.sin(3 * w)) * env;
      }
      at += d;
    }
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    const gain = peak > 0 ? 0.6 / peak : 1;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
    return out;
  }

  function playNotes(notes) {
    stopFx();
    fxUrl = encodeWav(renderNotes(notes));
    fxEl.src = fxUrl;
    return fxEl.play().catch(() => {});
  }

  // beats: [{ t: 秒, dur: 震动毫秒 }]，合成柔和的"咚"声，力度随 dur 变化
  function playTaps(beats) {
    if (!beats.length) return stopFx();
    const total = beats[beats.length - 1].t + 0.3;
    const out = new Float32Array(Math.ceil(total * SAMPLE_RATE));
    const len = Math.floor(0.09 * SAMPLE_RATE);
    for (const { t, dur } of beats) {
      const start = Math.floor(t * SAMPLE_RATE);
      const amp = 0.35 + Math.min(0.65, dur / 60);
      for (let i = 0; i < len && start + i < out.length; i++) {
        const s = i / SAMPLE_RATE;
        out[start + i] += Math.sin(2 * Math.PI * 196 * s) * Math.exp(-s * 45) * amp;
      }
    }
    stopFx();
    fxUrl = encodeWav(out);
    fxEl.src = fxUrl;
    return fxEl.play().catch(() => {});
  }

  const CHIMES = {
    tick: [{ f: 880, d: 0.18 }],
    good: [{ f: 659.25, d: 0.14 }, { f: 987.77, d: 0.3 }],
    done: [{ f: 523.25, d: 0.14 }, { f: 659.25, d: 0.14 }, { f: 783.99, d: 0.14 }, { f: 1046.5, d: 0.5 }],
  };
  function chime(kind = "tick") {
    return playNotes(CHIMES[kind] || CHIMES.tick);
  }

  function stopFx() {
    fxEl.pause();
    if (fxUrl) URL.revokeObjectURL(fxUrl);
    fxUrl = "";
  }

  /* ---------------- 手机解锁 ---------------- */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const url = getSilentUrl();
    for (const el of [voiceEl, noiseEl, fxEl]) {
      if (el.getAttribute("src")) continue;
      el.src = url;
      el.play().then(() => { if (el.src === url) el.pause(); }).catch(() => {});
    }
    if (hasNativeTTS && isIOS) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }

  ["pointerdown", "touchend", "keydown"].forEach((type) =>
    document.addEventListener(type, unlock, { capture: true, passive: true }),
  );

  /* ---------------- 朗读 ---------------- */
  function pickVoice() {
    if (!hasNativeTTS) return;
    const voices = window.speechSynthesis.getVoices();
    zhVoice =
      voices.find((v) => /^zh[-_](CN|Hans)/i.test(v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang) || /Chinese|中文|普通话/i.test(v.name)) ||
      null;
    if (voices.length && !zhVoice) nativeBroken = true;
  }
  if (hasNativeTTS) {
    pickVoice();
    window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
  }

  function stopSpeech() {
    speakToken += 1;
    if (hasNativeTTS) window.speechSynthesis.cancel();
    voiceEl.pause();
    duck(false);
  }

  async function fetchTts(text, attempt = 0) {
    if (ttsCache.has(text)) return ttsCache.get(text);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok || !data.audio) throw new Error(data.error || "tts-failed");
      ttsCache.set(text, data.audio);
      return data.audio;
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((r) => setTimeout(r, 600));
      return fetchTts(text, attempt + 1);
    }
  }

  async function serverSpeak(text, token) {
    const audio = await fetchTts(text);
    if (token !== speakToken) return;
    voiceEl.src = audio;
    voiceEl.onended = () => { if (token === speakToken) duck(false); };
    duck(true);
    await voiceEl.play();
  }

  function nativeSpeak(text, token, { fallback = true } = {}) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1;
    if (zhVoice) u.voice = zhVoice;
    let started = false;
    u.onstart = () => { started = true; duck(true); };
    u.onend = () => { if (token === speakToken) duck(false); };
    u.onerror = (e) => {
      if (token !== speakToken || started || !fallback) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      nativeBroken = true;
      serverSpeak(text, token).catch(() => {});
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    if (fallback) {
      setTimeout(() => {
        if (started || token !== speakToken) return;
        nativeBroken = true;
        window.speechSynthesis.cancel();
        serverSpeak(text, token).catch(() => {});
      }, 2500);
    }
  }

  function speak(text) {
    const clean = String(text || "").trim().slice(0, MAX_TTS_LEN);
    if (!clean) return;
    stopSpeech();
    const token = speakToken;
    const nativeUsable = hasNativeTTS && !nativeBroken;

    if (!isMobile && nativeUsable) return nativeSpeak(clean, token);
    if (isMobile && !unlocked) {
      if (nativeUsable) nativeSpeak(clean, token, { fallback: false });
      return;
    }
    serverSpeak(clean, token).catch(() => {
      if (token === speakToken && hasNativeTTS) nativeSpeak(clean, token, { fallback: false });
    });
  }

  return {
    isIOS,
    isMobile,
    get unlocked() { return unlocked; },
    unlock,
    speak,
    stopSpeech,
    startNoise,
    pauseNoise,
    resumeNoise,
    stopNoise,
    setNoiseVolume,
    playNotes,
    playTaps,
    chime,
    stopFx,
  };
})();
