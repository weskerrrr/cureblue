// POST /api/tts — 中文语音合成（手机浏览器没有可用的系统朗读时使用）
// body: { text }  →  { ok, audio: "data:audio/wav;base64,..." }
import { json, error, preflight } from "../_lib/response.js";
import { arkSpeak } from "../_lib/ark.js";

const TTS_MODEL = "@cf/myshell-ai/melotts";
const MAX_LEN = 300;

export async function onRequestOptions() {
  return preflight();
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function synthesize(env, text) {
  const response = await env.AI.run(TTS_MODEL, { prompt: text, lang: "zh" })
    .catch(() => env.AI.run(TTS_MODEL, { prompt: text, lang: "zh" }));
  if (typeof response?.audio === "string") return response.audio;
  if (response instanceof ReadableStream) {
    return toBase64(new Uint8Array(await new Response(response).arrayBuffer()));
  }
  if (response instanceof ArrayBuffer || response instanceof Uint8Array) {
    return toBase64(response instanceof Uint8Array ? response : new Uint8Array(response));
  }
  throw new Error("empty-tts-audio");
}

export async function onRequestPost({ request, env }) {
  if (!env.ARK_API_KEY && !env.AI) return error("语音服务未配置", 503);
  const { text = "" } = await request.json().catch(() => ({}));
  const clean = String(text).trim().slice(0, MAX_LEN);
  if (!clean) return error("缺少 text 参数");

  const cache = caches.default;
  const cacheKeyFor = async (provider) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${provider}:${clean}`));
    const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return new Request(`https://tts.cache/${key}`);
  };
  const cached = async (cacheKey) => {
    const hit = await cache.match(cacheKey);
    if (!hit) return null;
    return json({ ok: true, audio: await hit.text(), cached: true });
  };

  try {
    let b64;
    let cacheKey = await cacheKeyFor("cf");
    if (env.ARK_API_KEY || env.ARK_TTS_API_KEY) {
      const arkKey = await cacheKeyFor("ark");
      const arkHit = await cached(arkKey);
      if (arkHit) return arkHit;
      try {
        b64 = await arkSpeak(env, clean);
        cacheKey = arkKey;
      } catch (err) {
        const message = String(err?.message || "");
        const rejected = /Invalid X-Api-Key|AuthenticationError|app key not found/.test(message);
        if (!rejected || !env.AI) throw err;
        const backup = await cached(cacheKey);
        if (backup) return backup;
        b64 = await synthesize(env, clean);
      }
    } else {
      const backup = await cached(cacheKey);
      if (backup) return backup;
      b64 = await synthesize(env, clean);
    }
    const mime = b64.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
    const audio = `data:${mime};base64,${b64}`;
    await cache.put(
      cacheKey,
      new Response(audio, { headers: { "Cache-Control": "public, max-age=2592000" } }),
    );
    return json({ ok: true, audio });
  } catch (err) {
    console.error("[tts]", err?.message || err);
    const message = String(err?.message || "");
    return json({ ok: false, error: message.startsWith("方舟") ? message : "语音合成暂时不可用。" }, 502);
  }
}
