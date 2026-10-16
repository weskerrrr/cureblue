/**
 * 心绘生图：任意中文先译成英文，再交给 Cloudflare Flux / Pollinations。
 * 例句走本地词典；自定义描述走 Workers AI 翻译，避免中文原文进入生图模型。
 */

const POLLINATIONS = "https://image.pollinations.ai/prompt/";
const CF_IMAGE = "@cf/black-forest-labs/flux-1-schnell";
const CF_TRANSLATE = "@cf/meta/m2m100-1.2b";

const STYLE_EN = {
  auto: "clear illustration, natural colors, the main subject is large",
  watercolor: "watercolor painting, soft washes, gentle bleeding edges",
  cartoon: "cute cartoon illustration, bright clean lines",
  crayon: "children's crayon drawing, waxy texture",
  oil: "oil painting, rich visible brushstrokes",
  pixel: "pixel art, charming 16-bit style",
};

const PHRASE_EN = [
  ["一只在草地上奔跑的小狗，阳光很温暖", "a puppy running on the grass in warm sunlight"],
  ["一只在草地上奔跑的小猫，阳光很温暖", "a kitten running on the grass in warm sunlight"],
  ["夜空里有一弯月亮和很多星星", "a crescent moon and many stars in the night sky"],
  ["海边的灯塔，海浪轻轻拍打", "a lighthouse by the sea with gentle waves"],
  ["森林里的小木屋，烟囱冒着炊烟", "a small wooden cabin in the forest with smoke from the chimney"],
  ["一片宁静的蓝色海洋", "a calm blue ocean"],
  ["阳光很温暖", "warm sunlight"],
  ["在草地上奔跑", "running on the grass"],
  ["在草地上", "on the grass"],
  ["很多星星", "many stars"],
  ["一弯月亮", "a crescent moon"],
  ["一只小猫", "a little kitten"],
  ["一只小狗", "a little puppy"],
  ["小木屋", "a small wooden cabin"],
  ["海浪", "ocean waves"],
  ["灯塔", "a lighthouse"],
  ["森林", "a forest"],
  ["夜空", "the night sky"],
  ["星星", "stars"],
  ["月亮", "the moon"],
  ["大海", "the ocean"],
  ["海洋", "the ocean"],
  ["海边", "by the seaside"],
  ["草地", "a grassy field"],
  ["小猫", "a kitten"],
  ["小狗", "a puppy"],
  ["小猫咪", "a kitten"],
  ["奔跑", "running"],
  ["阳光", "sunlight"],
  ["温暖", "warm"],
  ["彩虹", "a rainbow"],
  ["花朵", "flowers"],
  ["气球", "balloons"],
  ["烟囱", "a chimney"],
  ["炊烟", "smoke from a chimney"],
  ["我自己", "a child that looks like me"],
  ["在森林里", "in a forest"],
  ["在天空中", "in the sky"],
  ["在花园里", "in a garden"],
  ["加上彩虹", "with a rainbow"],
  ["加上星星", "with stars"],
  ["加上花朵", "with flowers"],
  ["加上气球", "with balloons"],
  ["有点难过", "a little sad but gentle"],
  ["开心", "happy"],
  ["平静", "calm"],
  ["兴奋", "excited"],
].sort((a, b) => b[0].length - a[0].length);

const PROVIDER_LABEL = {
  cloudflare: "Cloudflare Flux",
  pollinations: "Pollinations",
};

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function stripChinese(text) {
  return String(text || "")
    .replace(/[\u4e00-\u9fff]/g, " ")
    .replace(/[，。、；：！？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localTranslate(text) {
  let remaining = text.trim();
  const kept = [];

  for (const [zh, en] of PHRASE_EN) {
    if (remaining.includes(zh)) {
      remaining = remaining.split(zh).join(" ");
      kept.push(en);
    }
  }

  const leftoverChinese = hasChinese(remaining);
  remaining = stripChinese(remaining);
  return {
    english: [...kept, remaining].filter(Boolean).join(", "),
    complete: !leftoverChinese,
  };
}

function isGoodEnglish(text) {
  const t = String(text || "").trim();
  if (t.length < 4 || hasChinese(t)) return false;
  if (/MYMEMORY WARNING/i.test(t)) return false;
  return /[a-zA-Z]{3,}/.test(t);
}

function pickTranslated(response) {
  if (!response) return "";
  if (typeof response === "string") return response.trim();
  if (typeof response.result === "string") return response.result.trim();
  return String(
    response.translated_text ||
      response.translatedText ||
      response.translation ||
      response.result?.translated_text ||
      response.response?.translated_text ||
      "",
  ).trim();
}

function focusSubject(text) {
  return String(text || "")
    .replace(/^(请|帮我|给我|我想|我要|可以)?(画|生成|来)(一个|一幅|一张|一下)?/, "")
    .trim();
}

async function viaCfTranslate(env, text) {
  if (!env?.AI) return "";
  const pairs = [
    { source_lang: "zh", target_lang: "en" },
    { source_lang: "chinese", target_lang: "english" },
  ];
  for (const langs of pairs) {
    try {
      const response = await env.AI.run(CF_TRANSLATE, {
        text: text.slice(0, 450),
        ...langs,
      });
      const translated = pickTranslated(response);
      if (isGoodEnglish(translated)) return translated;
    } catch (err) {
      console.error("[imageGen] translate", langs.source_lang, err?.message || err);
    }
  }
  return "";
}

async function viaMyMemory(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text.slice(0, 450),
    )}&langpair=zh|en`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    const translated = String(data?.responseData?.translatedText || "").trim();
    if (isGoodEnglish(translated) && translated.toLowerCase() !== text.toLowerCase()) {
      return translated;
    }
  } catch {
    /* ignore */
  } finally {
    clearTimeout(timer);
  }
  return "";
}

async function translateZhToEn(text, env) {
  if (!hasChinese(text)) return text;
  const local = localTranslate(text);
  if (local.complete && isGoodEnglish(local.english)) return local.english;

  const fromCf = await viaCfTranslate(env, text);
  if (fromCf && local.english) return `${fromCf}, ${local.english}`;
  if (fromCf) return fromCf;

  const fromMemory = await viaMyMemory(text);
  if (fromMemory && local.english) return `${fromMemory}, ${local.english}`;
  if (fromMemory) return fromMemory;

  if (isGoodEnglish(local.english)) return local.english;
  return text;
}

function buildEnglishPrompt(sceneEn, styleEn) {
  const scene = String(sceneEn || "").replace(/\s+/g, " ").trim();
  return `${scene}. The picture shows exactly this scene: ${scene}. ${styleEn}.`;
}

function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function asDataUrl(base64, mime = "image/jpeg") {
  const clean = String(base64 || "").replace(/^data:image\/\w+;base64,/i, "");
  return `data:${mime};base64,${clean}`;
}

async function viaCloudflare(env, englishPrompt) {
  if (!env?.AI) throw new Error("no-ai-binding");
  const response = await env.AI.run(CF_IMAGE, {
    prompt: englishPrompt.slice(0, 2048),
    steps: 8,
  });
  if (typeof response === "string" && response.length > 32) {
    return asDataUrl(response);
  }
  if (response?.image) return asDataUrl(response.image, "image/jpeg");
  if (response instanceof ArrayBuffer || response instanceof Uint8Array) {
    return asDataUrl(bytesToBase64(response), "image/jpeg");
  }
  const keys = response && typeof response === "object" ? Object.keys(response).join(",") : typeof response;
  throw new Error(`empty-cf-image:${keys}`);
}

async function viaPollinations(englishPrompt, seed) {
  const url =
    `${POLLINATIONS}${encodeURIComponent(englishPrompt)}` +
    `?width=768&height=768&seed=${seed}&model=flux&private=true`;
  const res = await fetch(url, { headers: { Accept: "image/*" } });
  if (!res.ok) throw new Error(`pollinations-${res.status}`);
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error("empty-pollinations-image");
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  return asDataUrl(bytesToBase64(buf), mime.startsWith("image/") ? mime : "image/jpeg");
}

function providerOrder(preferred) {
  if (preferred === "pollinations") return ["pollinations", "cloudflare"];
  return ["cloudflare", "pollinations"];
}

export async function buildImageResult(prompt, styleId = "auto", env, preferred = "cloudflare") {
  const clean = focusSubject(prompt) || (prompt || "").trim();
  const style = STYLE_EN[styleId] ? styleId : "auto";
  const sceneEn = await translateZhToEn(clean, env);
  const englishPrompt = buildEnglishPrompt(sceneEn, STYLE_EN[style]);

  const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const errors = [];

  for (const name of providerOrder(preferred)) {
    try {
      const url =
        name === "cloudflare"
          ? await viaCloudflare(env, englishPrompt)
          : await viaPollinations(englishPrompt, seed);
      return {
        kind: "image",
        url,
        prompt: clean,
        seed,
        style,
        englishPrompt,
        provider: name,
        providerLabel: PROVIDER_LABEL[name],
        altText: `这是一幅画，画的是${clean}。`,
      };
    } catch (err) {
      const message = err?.message || String(err);
      console.error("[imageGen]", name, message);
      errors.push(`${name}:${message}`);
    }
  }

  throw new Error(errors.join(" | ") || "image-failed");
}
