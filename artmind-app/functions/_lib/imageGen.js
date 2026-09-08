/**
 * 心绘生图：中文提示译成英文后，优先用 Cloudflare Workers AI（Flux Schnell），
 * 失败再回退 Pollinations。两种接口都在 Worker 内取回图片，前端只收 data URL。
 */

const POLLINATIONS = "https://image.pollinations.ai/prompt/";
const CF_MODEL = "@cf/black-forest-labs/flux-1-schnell";

const STYLE_EN = {
  auto: "warm healing children's illustration, soft colors, storybook",
  watercolor: "watercolor painting, soft washes, gentle bleeding edges",
  cartoon: "cute cartoon illustration, bright clean lines",
  crayon: "children's crayon drawing, waxy texture",
  oil: "oil painting, rich visible brushstrokes",
  pixel: "pixel art, charming 16-bit style",
};

const PHRASE_EN = [
  ["一只在草地上奔跑的小狗，阳光很温暖", "a puppy running on the grass in warm sunlight"],
  ["夜空里有一弯月亮和很多星星", "a crescent moon and many stars in the night sky"],
  ["海边的灯塔，海浪轻轻拍打", "a lighthouse by the sea with gentle waves"],
  ["森林里的小木屋，烟囱冒着炊烟", "a small wooden cabin in the forest with smoke from the chimney"],
  ["一片宁静的蓝色海洋", "a calm blue ocean"],
  ["一只小猫", "a little kitten"],
  ["一轮月亮", "a crescent moon"],
  ["大海", "the ocean"],
  ["我自己", "a child that looks like me"],
  ["在森林里", "in a forest"],
  ["在海边", "by the seaside"],
  ["在天空中", "in the sky"],
  ["在花园里", "in a garden"],
  ["加上彩虹", "with a rainbow"],
  ["加上星星", "with stars"],
  ["加上花朵", "with flowers"],
  ["加上气球", "with balloons"],
  ["开心", "happy"],
  ["平静", "calm"],
  ["有点难过", "a little sad but gentle"],
  ["兴奋", "excited"],
];

const PROVIDER_LABEL = {
  cloudflare: "Cloudflare Flux",
  pollinations: "Pollinations",
};

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
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

  remaining = remaining.replace(/[，。、；：！？,.;:!?]/g, " ").replace(/\s+/g, " ").trim();

  if (!remaining || !hasChinese(remaining)) {
    const extra = remaining && !hasChinese(remaining) ? remaining : "";
    return [...kept, extra].filter(Boolean).join(", ");
  }
  if (kept.length) return `${kept.join(", ")}, scene described as: ${text.trim()}`;
  return `illustration of this scene: ${text.trim()}`;
}

async function translateZhToEn(text) {
  if (!hasChinese(text)) return text;
  const local = localTranslate(text);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text.slice(0, 450),
    )}&langpair=zh|en`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    const translated = String(data?.responseData?.translatedText || "").trim();
    const bad =
      !translated ||
      /MYMEMORY WARNING/i.test(translated) ||
      hasChinese(translated) ||
      translated.toLowerCase() === text.toLowerCase();
    if (!bad) return translated;
  } catch {
    /* 翻译失败时用本地词典 */
  } finally {
    clearTimeout(timer);
  }
  return local;
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

async function viaCloudflare(env, englishPrompt, seed) {
  if (!env?.AI) throw new Error("no-ai-binding");
  const response = await env.AI.run(CF_MODEL, {
    prompt: englishPrompt.slice(0, 2048),
    steps: 4,
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
  const clean = (prompt || "").trim();
  const style = STYLE_EN[styleId] ? styleId : "auto";
  const sceneEn = await translateZhToEn(clean);
  const englishPrompt = [
    sceneEn,
    STYLE_EN[style],
    "children's storybook illustration",
    "wholesome, gentle atmosphere, clearly depicting the described scene",
    "not a photograph of food, not a random stock photo, not an unrelated object",
  ].join(", ");

  const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const errors = [];

  for (const name of providerOrder(preferred)) {
    try {
      const url =
        name === "cloudflare"
          ? await viaCloudflare(env, englishPrompt, seed)
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
