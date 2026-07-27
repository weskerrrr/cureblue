/* ============================================================
   心绘 ArtMind — 前端逻辑
   职责：视图渲染 / 无障碍三通道反馈（语音+字幕+触觉）/ 语音操控壳 /
        Freemium 功能墙 / 字号与高对比 / 角色切换
   后端：优先调用 Cloudflare Pages Functions（/api/*，见 api.js）——
        额度、审核、订阅、社区动态均由服务端 + D1 权威处理；
        后端不可用时（纯静态/file://）自动回退到内置演示逻辑，功能不中断。
   ============================================================ */

const D = window.ARTMIND_DATA;
const API = window.ArtMindAPI;
const ART_STYLES = [
  { id: "auto", label: "自动", hint: "温暖治愈风格" },
  { id: "watercolor", label: "水彩", hint: "水彩画风格，柔和晕染" },
  { id: "cartoon", label: "卡通", hint: "可爱卡通风格，明快线条" },
  { id: "crayon", label: "蜡笔", hint: "儿童蜡笔画风格" },
  { id: "oil", label: "油画", hint: "油画风格，厚重笔触" },
  { id: "pixel", label: "像素", hint: "像素艺术风格" },
];
const ART_EXAMPLES = [
  "一只在草地上奔跑的小狗，阳光很温暖",
  "夜空里有一弯月亮和很多星星",
  "海边的灯塔，海浪轻轻拍打",
  "森林里的小木屋，烟囱冒着炊烟",
];
const GALLERY_KEY = "artmind_gallery";

function loadGallery() {
  try {
    const items = JSON.parse(localStorage.getItem(GALLERY_KEY) || "[]");
    return Array.isArray(items) ? items.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

const state = {
  role: "blind", // blind | deaf | therapist | parent
  plan: "free", // free | monthly | yearly
  view: "studio",
  captions: true,
  voice: false,
  aiQuotaLeft: 3, // 免费版每日额度（后端可用时以服务端为准）
  tasks: structuredClone(D.tasks),
  posts: structuredClone(D.posts), // 社区动态（后端可用时用服务端数据）
  apiReady: false,
  artStyle: "auto",
  artPrompt: "",
  currentArtwork: null,
  gallery: loadGallery(),
  generating: false,
};

/* ---------------- 无障碍三通道反馈 ---------------- */
// 语音播报 + 字幕同步 + 触觉反馈，三者尽量同时触发
function announce(text, { assertive = false, vibrate = true } = {}) {
  const region = document.getElementById(assertive ? "live-assertive" : "live-polite");
  region.textContent = "";
  // 微延迟以确保读屏软件重新读取
  requestAnimationFrame(() => (region.textContent = text));

  if (state.captions) setCaption(text);

  // 语音合成（听障用户可关闭，视障用户核心依赖）
  if (state.role !== "deaf" && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  // 触觉反馈
  if (vibrate && "vibrate" in navigator) navigator.vibrate(assertive ? [80, 40, 80] : 30);
}

function setCaption(text) {
  document.getElementById("caption-text").textContent = text;
}

/* ---------------- Freemium 功能墙 ---------------- */
function isPro() {
  return state.plan === "monthly" || state.plan === "yearly";
}

// 统一拦截入口：返回 true 表示有权限，false 表示已弹出 Paywall
function requirePro(featureDesc) {
  if (isPro()) return true;
  openPaywall(featureDesc);
  return false;
}

function openPaywall(desc) {
  const modal = document.getElementById("paywall");
  document.getElementById("paywall-desc").textContent =
    desc || "升级订阅可解锁无限 AI 创作、全套疗愈课程与 1v1 疗愈师预约。";
  modal.hidden = false;
  document.getElementById("paywall-go").focus();
  announce("该功能为订阅会员专享。" + (desc || ""), { assertive: true });
}

function closePaywall() {
  document.getElementById("paywall").hidden = true;
}

/* ---------------- 视图切换 ---------------- */
function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  document.querySelectorAll(".navbtn").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  const panel = document.getElementById("view-" + view);
  panel.hidden = false;
  renderView(view);
  document.getElementById("main").focus();
  const labels = { studio: "创作工坊", tasks: "疗愈任务", gallery: "欣赏与冥想", community: "安全社区", subscribe: "订阅会员" };
  announce("已打开" + labels[view]);
}

function renderView(view) {
  const map = { studio: renderStudio, tasks: renderTasks, gallery: renderGallery, community: renderCommunity, subscribe: renderSubscribe };
  map[view]?.();
}

/* ---------------- 模块一：创作工坊 ---------------- */
function renderStudio() {
  const el = document.getElementById("view-studio");
  const blind = state.role === "blind";
  const deaf = state.role === "deaf";
  const artwork = state.currentArtwork;
  const styleLabel = ART_STYLES.find((item) => item.id === state.artStyle)?.label || "自动";

  el.innerHTML = `
    <div class="view-head">
      <h1>AI 多模态艺术创作工坊 <span class="real-ai-badge">真实生图</span></h1>
      <p>说出或写下你想画的内容，选择喜欢的画风，AI 会生成一幅可以保存的真实画作。${blind ? "生成后将自动朗读画面描述。" : deaf ? "所有状态均以文字同步呈现。" : ""}</p>
    </div>
    <div class="canvas-wrap">
      <div class="studio-result-column">
        <div class="canvas artwork-canvas ${artwork ? "has-artwork" : ""}" id="canvas"
          role="region" aria-label="${artwork ? `已生成画作：${escapeHTML(artwork.prompt)}` : "创作画布，当前为空"}" aria-live="polite">
          ${artwork ? `
            <figure class="generated-artwork">
              <img src="${artwork.url}" alt="${escapeHTML(artwork.altText)}" />
              <figcaption>
                <span class="tag tag-deaf">${escapeHTML(artwork.styleLabel || styleLabel)}风格</span>
                <strong>${escapeHTML(artwork.prompt)}</strong>
              </figcaption>
            </figure>
          ` : `
            <div class="canvas-empty">
              <span class="canvas-empty-mark" aria-hidden="true">✦</span>
              <p>你的画会出现在这里</p>
              <small>写好描述后，选择“开始作画”</small>
            </div>
          `}
        </div>
        ${artwork ? `
          <div class="artwork-actions" role="group" aria-label="画作操作">
            <button class="btn btn-primary" id="save-artwork">保存到作品集</button>
            <button class="btn btn-ghost" id="read-artwork">🔊 朗读描述</button>
            <button class="btn btn-ghost" id="redraw-artwork">重画一张</button>
            <button class="btn btn-ghost" id="download-artwork">下载图片</button>
          </div>
        ` : ""}
      </div>
      <div class="card compose-card">
        <div class="field">
          <label for="prompt">描述你的画面</label>
          <textarea id="prompt" rows="4" maxlength="300"
            placeholder="例如：一只在草地上奔跑的小狗，阳光很温暖"
            ${state.generating ? "disabled" : ""}>${escapeHTML(state.artPrompt)}</textarea>
          <div class="field-foot"><span id="prompt-count">${state.artPrompt.length} / 300</span></div>
        </div>

        <div class="field">
          <span class="field-label" id="example-label">快速试试</span>
          <div class="prompt-examples" role="group" aria-labelledby="example-label">
            ${ART_EXAMPLES.map((example) => `
              <button class="example-chip" type="button" data-example="${escapeHTML(example)}"
                ${state.generating ? "disabled" : ""}>${escapeHTML(example)}</button>
            `).join("")}
          </div>
        </div>

        <div class="field">
          <span class="field-label" id="style-label">画面风格</span>
          <div class="art-style-picker" role="group" aria-labelledby="style-label">
            ${ART_STYLES.map((item) => `
              <button type="button" class="style-choice ${state.artStyle === item.id ? "selected" : ""}"
                data-style="${item.id}" aria-pressed="${state.artStyle === item.id}"
                ${state.generating ? "disabled" : ""}>${item.label}</button>
            `).join("")}
          </div>
        </div>

        <div class="compose-actions">
          <button class="btn btn-ghost" id="voice-prompt" ${state.generating ? "disabled" : ""}>🎙️ 语音输入</button>
          <button class="btn btn-primary" data-ai="image" ${state.generating ? "disabled" : ""}>
            ${state.generating ? "AI 正在作画…" : "🎨 开始作画"}
          </button>
        </div>
        <div class="quota" aria-live="polite">
          ${isPro()
            ? `<span class="tag tag-pro">PRO</span> 无限次 AI 创作`
            : `本日剩余免费生成次数：<strong id="quota-num">${state.aiQuotaLeft}</strong> / 3`}
        </div>
        <p class="service-note">画作由 Pollinations AI 生成，通常需要 5–30 秒。</p>
      </div>
    </div>

    ${state.gallery.length ? `
      <section class="gallery-section" aria-labelledby="my-gallery-title">
        <div class="gallery-heading">
          <h2 id="my-gallery-title">我的作品集</h2>
          <span>${state.gallery.length} 幅</span>
        </div>
        <div class="art-gallery">
          ${state.gallery.map((item, index) => `
            <article class="gallery-art-card">
              <img src="${item.url}" alt="${escapeHTML(item.altText)}" loading="lazy" />
              <div><strong>${escapeHTML(item.prompt)}</strong>
                <button type="button" class="gallery-remove" data-remove-art="${index}" aria-label="从作品集移除：${escapeHTML(item.prompt)}">移除</button>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}
  `;

  const promptInput = el.querySelector("#prompt");
  promptInput?.addEventListener("input", () => {
    state.artPrompt = promptInput.value;
    el.querySelector("#prompt-count").textContent = `${promptInput.value.length} / 300`;
  });
  el.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => {
    promptInput.value = button.dataset.example;
    state.artPrompt = button.dataset.example;
    el.querySelector("#prompt-count").textContent = `${promptInput.value.length} / 300`;
    announce(`已填入示例：${button.dataset.example}`);
  }));
  el.querySelectorAll("[data-style]").forEach((button) => button.addEventListener("click", () => {
    state.artStyle = button.dataset.style;
    renderStudio();
    announce(`已选择${button.textContent}风格`);
  }));
  el.querySelectorAll("[data-ai]").forEach((btn) =>
    btn.addEventListener("click", () => runAI(btn.dataset.ai))
  );
  el.querySelector("#voice-prompt")?.addEventListener("click", captureArtworkPrompt);
  el.querySelector("#save-artwork")?.addEventListener("click", saveCurrentArtwork);
  el.querySelector("#read-artwork")?.addEventListener("click", () => announce(state.currentArtwork.altText));
  el.querySelector("#redraw-artwork")?.addEventListener("click", () => runAI("image"));
  el.querySelector("#download-artwork")?.addEventListener("click", downloadCurrentArtwork);
  el.querySelectorAll("[data-remove-art]").forEach((button) => button.addEventListener("click", () => {
    state.gallery.splice(Number(button.dataset.removeArt), 1);
    localStorage.setItem(GALLERY_KEY, JSON.stringify(state.gallery));
    renderStudio();
    announce("已从作品集移除一幅画。");
  }));
}

function captureArtworkPrompt() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    announce("当前浏览器不支持语音输入，请使用 Chrome、Edge，或直接输入文字。", { assertive: true });
    return;
  }
  const button = document.getElementById("voice-prompt");
  const input = document.getElementById("prompt");
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  button.disabled = true;
  button.textContent = "正在聆听…";
  announce("请开始说话，我在听。");
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript?.trim() || "";
    if (text) {
      input.value = input.value ? `${input.value} ${text}` : text;
      state.artPrompt = input.value;
      input.dispatchEvent(new Event("input"));
      announce(`我听到了：${text}`);
    }
  };
  recognition.onerror = (event) => {
    announce(event.error === "not-allowed"
      ? "需要麦克风权限，请在浏览器中允许使用麦克风。"
      : "语音输入没有成功，请再试一次或直接打字。", { assertive: true });
  };
  recognition.onend = () => {
    button.disabled = false;
    button.textContent = "🎙️ 语音输入";
  };
  recognition.start();
}

function saveCurrentArtwork() {
  if (!state.currentArtwork) return;
  if (state.gallery.some((item) => item.url === state.currentArtwork.url)) {
    announce("这幅画已经在作品集里了。");
    return;
  }
  state.gallery.unshift(state.currentArtwork);
  state.gallery = state.gallery.slice(0, 12);
  localStorage.setItem(GALLERY_KEY, JSON.stringify(state.gallery));
  renderStudio();
  announce("已保存到你的作品集。");
}

async function downloadCurrentArtwork() {
  if (!state.currentArtwork) return;
  announce("正在准备下载。");
  try {
    const response = await fetch(state.currentArtwork.url);
    if (!response.ok) throw new Error("download-failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `心绘画作-${Date.now()}.jpg`;
    link.click();
    URL.revokeObjectURL(objectUrl);
    announce("已开始下载你的画作。");
  } catch {
    window.open(state.currentArtwork.url, "_blank", "noopener");
    announce("画作已在新标签打开，可以长按或右键保存。");
  }
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error("timeout")), 60000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error("load-failed")); };
    image.src = url;
  });
}

// 前端能力名 → 后端 capability 名
const AI_CAPABILITY = { image: "speech2image", music: "desc2music", visualize: "visualize", lipread: "lipread" };

// 调用 AI：后端可用时走 /api/ai（服务端权威额度），否则本地演示逻辑
async function runAI(kind) {
  const prompt = (document.getElementById("prompt")?.value || state.artPrompt || "").trim();
  state.artPrompt = prompt;
  if (!prompt) {
    announce("请先说出或写下你想画的内容。", { assertive: true });
    document.getElementById("prompt")?.focus();
    return;
  }
  if (kind === "image") {
    state.generating = true;
    renderStudio();
    const canvas = document.getElementById("canvas");
    canvas.innerHTML = `<div class="art-loading"><span class="art-spinner" aria-hidden="true"></span><strong>AI 正在为你作画…</strong><small>请稍候，通常需要 5–30 秒</small></div>`;
    announce("正在为你作画，请稍候。");
  }

  try {
    if (state.apiReady) {
      const capability = AI_CAPABILITY[kind] || "speech2image";
      const resp = await API.ai(capability, prompt, { style: state.artStyle });
      if (!resp || resp.ok === false) {
        state.generating = false;
        if (resp && resp.code === "PRO_REQUIRED") return openPaywall("该能力为会员专享功能。");
        if (resp && resp.code === "FREE_QUOTA_EXCEEDED") return openPaywall("今日免费 AI 生成次数已用完，升级订阅可无限创作。");
        renderStudio();
        announce("生成失败，请稍后再试。", { assertive: true });
        return;
      }
      if (typeof resp.aiQuotaLeft === "number") {
        state.aiQuotaLeft = resp.aiQuotaLeft < 0 ? Infinity : resp.aiQuotaLeft;
      }
      if (kind === "image" && resp.result?.url) await preloadImage(resp.result.url);
      state.generating = false;
      renderAIResult(kind, prompt, resp.result);
      return;
    }

    // ---- 降级：没有 Cloudflare Functions 时仍直接使用真实公共生图服务 ----
    if (kind === "lipread" && !requirePro("唇语识别辅助创作为会员专享功能。")) return;
    if (!isPro()) {
      if (state.aiQuotaLeft <= 0) {
        state.generating = false;
        return openPaywall("今日免费 AI 生成次数已用完，升级订阅可无限创作。");
      }
      state.aiQuotaLeft -= 1;
    }
    let fallbackResult = null;
    if (kind === "image") {
      const style = ART_STYLES.find((item) => item.id === state.artStyle) || ART_STYLES[0];
      const seed = Math.floor(Math.random() * 1_000_000);
      const styled = `${prompt}, ${style.hint}, 柔和色彩, 适合青少年, 安全友善, no text`;
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=768&height=768&seed=${seed}&nologo=true&safe=true`;
      fallbackResult = { url, prompt, seed, style: style.id, altText: `这是一幅${style.label}风格的画，画的是${prompt}。` };
      await preloadImage(url);
    }
    state.generating = false;
    renderAIResult(kind, prompt, fallbackResult);
  } catch {
    state.generating = false;
    renderStudio();
    announce("作画没有成功，可能是网络问题，请稍后重新尝试。", { assertive: true });
  }
}

// 渲染 AI 结果到画布（服务端结果与本地演示共用；result 为空时用本地文案）
function renderAIResult(kind, prompt, result) {
  const canvas = document.getElementById("canvas");

  if (kind === "visualize") {
    const heights = result && result.frames ? result.frames : Array.from({ length: 16 }, () => 20 + Math.random() * 140);
    canvas.setAttribute("aria-label", "声音可视化动态频谱");
    canvas.innerHTML = `<div class="viz-bars">${
      heights.map((h) => `<span style="height:${h}px"></span>`).join("")
    }</div>`;
    announce((result && result.caption) || "已将声音转换为动态频谱画面，字幕同步显示节奏强弱。");
    return;
  }

  if (kind === "music") {
    canvas.setAttribute("aria-label", "已生成音乐片段");
    canvas.innerHTML = `<div><p style="font-size:1.1rem;color:var(--text)">🎵 音乐片段已生成（约 24 秒）</p><p>情绪：宁静 · 调式：大调 · 节奏：舒缓</p></div>`;
    announce((result && result.caption) || `已根据"${prompt}"生成一段舒缓的大调旋律，约 24 秒。`);
    return;
  }

  // image：展示真实生成图片，并提供保存/下载/朗读
  const style = ART_STYLES.find((item) => item.id === (result?.style || state.artStyle)) || ART_STYLES[0];
  const desc = result?.altText || `这是一幅${style.label}风格的画，画的是${prompt}。`;
  state.currentArtwork = {
    ...result,
    prompt,
    style: style.id,
    styleLabel: style.label,
    altText: desc,
    createdAt: new Date().toISOString(),
  };
  renderStudio();
  announce(desc);
}

/* ---------------- 模块二：疗愈任务 ---------------- */
function renderTasks() {
  const el = document.getElementById("view-tasks");
  const p = D.progress;
  const isTherapist = state.role === "therapist";

  el.innerHTML = `
    <div class="view-head">
      <h1>个性化 AI 疗愈任务</h1>
      <p>${isTherapist ? "你可以调整 AI 为学员推荐的任务方案。" : "AI 根据你的创作行为与情绪反馈，为你定制今日打卡。"}</p>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>今日任务</h3>
        <div id="task-list"></div>
      </div>
      <div class="card">
        <h3>疗愈进度报告</h3>
        <p>连续打卡 <strong>${p.streakDays}</strong> 天 · 完成率 <strong>${Math.round(p.completionRate * 100)}%</strong></p>
        <label class="sr-only" for="prog">总完成率</label>
        <div class="progress" role="progressbar" aria-valuenow="${Math.round(p.completionRate * 100)}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${p.completionRate * 100}%"></span>
        </div>
        <h3 style="margin-top:16px">近 7 日情绪曲线（已脱敏）</h3>
        <div class="viz-bars" role="img" aria-label="近七日情绪等级曲线：${p.moodTrend.join("，")}，整体上行">
          ${p.moodTrend.map((v) => `<span style="height:${v * 28}px"></span>`).join("")}
        </div>
        <p style="margin-top:12px">${p.note}</p>
        <button class="btn btn-ghost btn-block" id="read-report" style="margin-top:8px">🔊 朗读完整报告</button>
      </div>
    </div>
  `;

  const list = el.querySelector("#task-list");
  list.innerHTML = state.tasks
    .map(
      (t) => `
    <div class="task card ${t.pro && !isPro() ? "locked" : ""}" style="margin-bottom:10px">
      <input type="checkbox" id="${t.id}" ${t.done ? "checked" : ""} ${t.pro && !isPro() ? "disabled" : ""}
        aria-label="${t.title}，${t.level}，预计 ${t.minutes} 分钟" />
      <label for="${t.id}" style="flex:1;margin:0">
        <strong>${t.title}</strong><br />
        <span class="tag ${t.level === "入门" ? "tag-deaf" : "tag-blind"}">${t.level}</span>
        <span style="color:var(--text-dim)"> · ${t.minutes} 分钟</span>
        ${t.pro && !isPro() ? '<span class="lock-pill">PRO</span>' : ""}
      </label>
      ${isTherapist ? `<button class="btn btn-ghost" data-adjust="${t.id}" style="min-height:40px">调整</button>` : ""}
    </div>`
    )
    .join("");

  list.querySelectorAll('input[type="checkbox"]').forEach((cb) =>
    cb.addEventListener("change", () => {
      const t = state.tasks.find((x) => x.id === cb.id);
      if (t.pro && !isPro()) return;
      t.done = cb.checked;
      if (cb.checked) announce(`已完成任务：${t.title}。真棒，继续保持！`, { vibrate: true });
    })
  );

  list.querySelectorAll("[data-adjust]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = state.tasks.find((x) => x.id === b.dataset.adjust);
      t.minutes = Math.max(3, t.minutes - 2);
      announce(`已为学员调整任务"${t.title}"时长为 ${t.minutes} 分钟。`);
      renderTasks();
    })
  );

  el.querySelector("#read-report").addEventListener("click", () =>
    announce(`疗愈进度报告：连续打卡 ${p.streakDays} 天，完成率 ${Math.round(p.completionRate * 100)}%。${p.note}`)
  );
}

/* ---------------- 模块三：欣赏与冥想 ---------------- */
function renderGallery() {
  const el = document.getElementById("view-gallery");
  const blind = state.role === "blind";

  const meds = D.meditations.filter((m) => (blind ? m.forRole === "blind" : state.role === "deaf" ? m.forRole === "deaf" : true));

  el.innerHTML = `
    <div class="view-head">
      <h1>无障碍艺术欣赏 + AI 冥想引导</h1>
      <p>AI 为每幅作品提供情感、色彩、构图的深度解读；冥想课程按人群适配。</p>
    </div>

    <h2 style="font-size:1.2rem">AI 智能艺术导览</h2>
    <div class="grid grid-2">
      ${D.artworks
        .map(
          (a) => `
        <article class="card ${a.pro && !isPro() ? "locked" : ""}">
          ${a.pro && !isPro() ? '<span class="lock-pill">PRO 深度</span>' : ""}
          <div style="height:120px;border-radius:12px;background:linear-gradient(135deg,#7c5cff,#2ee6c5)"></div>
          <h3 style="margin-top:12px">${a.title}</h3>
          <p>作者：${a.author}</p>
          <button class="btn btn-primary" data-art="${a.id}">🔊 AI 语音解读</button>
        </article>`
        )
        .join("")}
    </div>

    <h2 style="font-size:1.2rem;margin-top:22px">分人群冥想引导</h2>
    <div class="grid grid-3">
      ${meds
        .map(
          (m) => `
        <article class="card ${m.pro && !isPro() ? "locked" : ""}">
          ${m.pro && !isPro() ? '<span class="lock-pill">PRO</span>' : ""}
          <h3>${m.title}</h3>
          <p>${m.forRole === "blind" ? "纯语音沉浸" : "动态视觉旋律"} · ${m.minutes} 分钟</p>
          <button class="btn btn-ghost btn-block" data-med="${m.id}">▶ 开始冥想</button>
        </article>`
        )
        .join("")}
    </div>
  `;

  el.querySelectorAll("[data-art]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = D.artworks.find((x) => x.id === b.dataset.art);
      if (a.pro && !requirePro("深度艺术导览为会员专享。")) return;
      announce(`${a.title}。色彩以${a.palette.join("、")}为主。构图：${a.composition}。整体情感：${a.emotion}。`);
    })
  );

  el.querySelectorAll("[data-med]").forEach((b) =>
    b.addEventListener("click", () => {
      const m = D.meditations.find((x) => x.id === b.dataset.med);
      if (m.pro && !requirePro("该冥想课程为会员专享。")) return;
      announce(`开始冥想：${m.title}。请找到一个舒适的姿势，跟随引导，慢慢地深呼吸……`, { vibrate: true });
    })
  );
}

/* ---------------- 模块四：安全社区 ---------------- */
function renderCommunity() {
  const el = document.getElementById("view-community");
  const isParent = state.role === "parent";

  el.innerHTML = `
    <div class="view-head">
      <h1>未成年人安全社区</h1>
      <p>${isParent ? "家长后台：你可以查看孩子的社区动态、作品与互动记录。" : "封闭社区，全内容 AI 实时审核。发布前会先经过安全检查。"}</p>
    </div>

    ${!isParent ? `
      <div class="card">
        <div class="field">
          <label for="post-input">发布一条动态（发布即经 AI 审核）</label>
          <textarea id="post-input" rows="2" placeholder="分享你的作品或心情……"></textarea>
        </div>
        <button class="btn btn-primary" id="post-btn">发布</button>
        <div id="post-result" class="mod-note" aria-live="polite"></div>
      </div>
    ` : `
      <div class="card"><strong>监护提示：</strong>本周孩子发布 2 条动态，参与互动 5 次，未触发任何安全告警。私信功能当前为「仅疗愈师」。</div>
    `}

    <h2 style="font-size:1.2rem;margin-top:18px">社区动态</h2>
    <div id="post-feed"></div>
  `;

  function renderFeed() {
    const feed = el.querySelector("#post-feed");
    const visible = state.posts.filter((p) => p.status !== "blocked" || isParent); // 家长可见被拦截记录
    feed.innerHTML = visible
      .map((p) => {
        const flagged = p.status !== "approved";
        let note = "";
        if (p.status === "blocked") note = `<div class="mod-note">⛔ ${p.reason}（仅家长可见）</div>`;
        if (p.status === "crisis") note = `<div class="mod-note">💛 已触发危机干预：已为该用户推送心理援助热线，并通知其疗愈师与家长。</div>`;
        const text = p.status === "blocked" ? "［内容已被安全系统拦截］" : p.text;
        return `
          <article class="card post ${flagged ? "flagged" : ""}" style="margin-bottom:10px">
            <div class="post-meta"><strong>${p.author}</strong> ${p.hasImage ? "· 含图片（已通过图像审核）" : ""}</div>
            <p style="margin:8px 0;color:var(--text)">${text}</p>
            ${note}
          </article>`;
      })
      .join("");
  }
  renderFeed();

  const postBtn = el.querySelector("#post-btn");
  if (postBtn) {
    postBtn.addEventListener("click", async () => {
      const input = el.querySelector("#post-input");
      const result = el.querySelector("#post-result");
      const text = input.value.trim();
      if (!text) return;

      // 优先服务端权威审核（/api/moderate + D1 持久化），否则本地演示审核
      let verdict;
      if (state.apiReady) {
        const resp = await API.moderate(text);
        verdict = resp && resp.ok ? resp : { action: "block", reason: "审核服务异常。" };
      } else {
        verdict = mockModerate(text);
      }

      if (verdict.action === "block") {
        result.textContent = `⛔ 发布失败：${verdict.reason || "内容未通过安全审核。"}`;
        announce("发布失败，内容未通过安全审核。" + (verdict.reason || ""), { assertive: true });
      } else if (verdict.action === "crisis") {
        result.textContent = verdict.message || "💛 我们注意到你可能正经历困难。已为你准备帮助资源，你并不孤单。";
        announce((verdict.message || "我们很关心你。") + (verdict.hotline ? "（" + verdict.hotline + "）" : ""), { assertive: true });
      } else {
        // 通过：服务端已持久化，重新拉取动态；否则本地插入
        if (state.apiReady) {
          state.posts = await API.feed();
        } else {
          state.posts.unshift({ id: "p" + Date.now(), author: "我", text, status: "approved" });
        }
        result.textContent = "✅ 已通过审核并发布。";
        announce("动态已通过安全审核并发布。");
        input.value = "";
        renderFeed();
      }
    });
  }
}

// 前端轻量审核（仅演示，权威审核在后端 moderation.js）
function mockModerate(text) {
  const crisis = ["撑不下去", "不想活", "自杀", "结束自己", "活不下去"];
  const abuse = ["垃圾", "去死", "傻", "丑", "废物"];
  if (crisis.some((w) => text.includes(w))) return { action: "crisis" };
  if (abuse.some((w) => text.includes(w))) return { action: "block", reason: "检测到攻击性/欺凌言论。" };
  return { action: "approve" };
}

/* ---------------- 订阅会员 ---------------- */
function renderSubscribe() {
  const el = document.getElementById("view-subscribe");
  el.innerHTML = `
    <div class="view-head">
      <h1>订阅会员</h1>
      <p>升级解锁无限创作与全套疗愈课程。未成年人订阅需家长账号确认。</p>
    </div>
    <div class="plans">
      ${D.plans
        .map(
          (pl) => `
        <div class="plan ${pl.featured ? "featured" : ""}">
          ${pl.featured ? '<span class="tag tag-pro">最受欢迎</span>' : ""}
          <h3>${pl.name}</h3>
          <div class="price">${pl.price}<span style="font-size:1rem;color:var(--text-dim)">${pl.period}</span></div>
          <ul>${pl.features.map((f) => `<li>✓ ${f}</li>`).join("")}</ul>
          <button class="btn ${pl.featured ? "btn-primary" : "btn-ghost"} btn-block"
            data-plan="${pl.id}" ${pl.id === "free" ? "disabled" : ""}>
            ${state.plan === pl.id ? "当前方案" : pl.cta}
          </button>
        </div>`
        )
        .join("")}
    </div>
  `;

  el.querySelectorAll("[data-plan]").forEach((b) =>
    b.addEventListener("click", () => subscribe(b.dataset.plan))
  );
}

// 订阅：后端可用时走 /api/subscribe（D1 持久化权益 + 未成年人家长确认），否则本地演示
async function subscribe(planId) {
  if (planId === "free") return;
  const isMinor = state.role === "blind" || state.role === "deaf";

  if (state.apiReady) {
    if (isMinor) {
      announce("正在向已绑定的家长账号发起付费确认……", { assertive: true });
      const pending = await API.subscribe(planId, false); // 先发起，进入 pending_guardian
      if (!pending || pending.ok === false) return announce("发起失败，请稍后再试。", { assertive: true });
      // 演示：模拟家长在其后台点击确认
      await new Promise((r) => setTimeout(r, 1000));
      const active = await API.subscribe(planId, true);
      if (active && active.ok) activatePlan(planId);
    } else {
      const active = await API.subscribe(planId, true);
      if (active && active.ok) activatePlan(planId);
      else announce("订阅失败，请稍后再试。", { assertive: true });
    }
    return;
  }

  // ---- 降级：本地演示 ----
  if (isMinor) {
    announce("正在向已绑定的家长账号发起付费确认……", { assertive: true });
    setTimeout(() => activatePlan(planId), 1200);
  } else {
    activatePlan(planId);
  }
}

function activatePlan(planId) {
  state.plan = planId;
  state.aiQuotaLeft = Infinity;
  const badge = document.getElementById("plan-badge");
  badge.textContent = planId === "yearly" ? "年度会员" : "月度会员";
  badge.classList.remove("plan-free");
  badge.classList.add("plan-pro");
  closePaywall();
  announce("订阅成功！所有高级功能已为你解锁。", { assertive: true });
  renderView(state.view);
}

/* ---------------- 无障碍工具：字号 / 对比 / 字幕 ---------------- */
function setFontScale(delta) {
  const next = Math.min(1.6, Math.max(0.9, state.fontscale ? state.fontscale + delta : 1 + delta));
  state.fontscale = next;
  document.documentElement.style.setProperty("--fontscale", next);
  announce(`字号已调整为 ${Math.round(next * 100)}%。`, { vibrate: false });
}

function toggleContrast() {
  const high = document.body.dataset.contrast !== "high";
  document.body.dataset.contrast = high ? "high" : "normal";
  const btn = document.getElementById("btn-contrast");
  btn.setAttribute("aria-pressed", String(high));
  btn.setAttribute("aria-label", "高对比模式：" + (high ? "开启" : "关闭"));
  announce("高对比模式已" + (high ? "开启" : "关闭") + "。", { vibrate: false });
}

function toggleCaptions() {
  state.captions = !state.captions;
  const btn = document.getElementById("btn-captions");
  btn.setAttribute("aria-pressed", String(state.captions));
  btn.setAttribute("aria-label", "字幕：" + (state.captions ? "开启" : "关闭"));
  document.getElementById("caption-bar").hidden = !state.captions;
}

/* ---------------- 语音操控壳（Web Speech API） ---------------- */
let recognition = null;
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById("btn-voice");

  if (state.voice) {
    recognition?.stop();
    state.voice = false;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "语音操控：关闭");
    document.getElementById("voice-hint").hidden = true;
    announce("语音操控已关闭。");
    return;
  }

  if (!SR) {
    announce("当前浏览器不支持语音识别，请使用按钮操作。所有功能均有按钮替代。", { assertive: true });
    return;
  }

  recognition = new SR();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    const phrase = e.results[e.results.length - 1][0].transcript.trim();
    setCaption("识别到：" + phrase);
    handleVoiceCommand(phrase);
  };
  recognition.onerror = () => announce("语音识别出错，请重试或使用按钮。");
  recognition.start();

  state.voice = true;
  btn.setAttribute("aria-pressed", "true");
  btn.setAttribute("aria-label", "语音操控：开启");
  document.getElementById("voice-hint").hidden = false;
  announce("语音操控已开启。你可以说：打开创作工坊、生成一片蓝色海洋、今天的疗愈任务。");
}

// 极简意图解析（演示）；真实可接 NLU 服务
function handleVoiceCommand(text) {
  const nav = [
    { kw: ["创作", "画"], view: "studio" },
    { kw: ["任务", "打卡"], view: "tasks" },
    { kw: ["欣赏", "冥想"], view: "gallery" },
    { kw: ["社区"], view: "community" },
    { kw: ["订阅", "会员"], view: "subscribe" },
  ];
  for (const n of nav) {
    if (n.kw.some((k) => text.includes(k)) && text.length < 8) {
      switchView(n.view);
      return;
    }
  }
  if (text.includes("生成") || text.includes("画")) {
    switchView("studio");
    const ta = document.getElementById("prompt");
    if (ta) ta.value = text.replace(/^(生成|画)/, "");
    setTimeout(() => runAI(state.role === "deaf" ? "visualize" : "image"), 300);
    return;
  }
  if (text.includes("朗读") || text.includes("解读")) {
    const first = document.querySelector("[data-art]");
    first?.click();
    return;
  }
  announce("没有听清指令，可以说：打开创作工坊、生成画作、今天的任务。");
}

/* ---------------- 角色切换 ---------------- */
async function changeRole(role) {
  state.role = role;
  const labels = { blind: "视障青少年", deaf: "听障青少年", therapist: "疗愈师", parent: "家长" };
  announce(`已切换到${labels[role]}视角，界面与交互已自动适配。`);
  if (state.apiReady) {
    API.setRole(role);
    // 家长视角可见被拦截记录，刷新一次社区动态
    try { state.posts = await API.feed(); } catch {}
  }
  renderView(state.view);
}

/* ---------------- 后端接入引导 ---------------- */
async function bootstrapBackend() {
  if (!API) return;
  try {
    const me = await API.init(state.role); // 探测 /api/me
    state.apiReady = API.ready;
    if (state.apiReady && me) {
      // 同步服务端权威的权益 / 额度
      state.plan = me.isPro ? "monthly" : "free";
      state.aiQuotaLeft = me.aiQuotaLeft < 0 ? Infinity : me.aiQuotaLeft;
      if (me.isPro) {
        const badge = document.getElementById("plan-badge");
        badge.textContent = "会员";
        badge.classList.remove("plan-free");
        badge.classList.add("plan-pro");
      }
      try { state.posts = await API.feed(); } catch {}
    }
  } catch {
    state.apiReady = false;
  }
}

/* ---------------- 初始化与事件绑定 ---------------- */
async function init() {
  document.querySelectorAll(".navbtn").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );
  document.getElementById("btn-font-inc").addEventListener("click", () => setFontScale(0.1));
  document.getElementById("btn-font-dec").addEventListener("click", () => setFontScale(-0.1));
  document.getElementById("btn-contrast").addEventListener("click", toggleContrast);
  document.getElementById("btn-captions").addEventListener("click", toggleCaptions);
  document.getElementById("btn-voice").addEventListener("click", toggleVoice);
  document.getElementById("role-select").addEventListener("change", (e) => changeRole(e.target.value));

  document.getElementById("paywall-go").addEventListener("click", () => {
    closePaywall();
    switchView("subscribe");
  });
  document.getElementById("paywall-close").addEventListener("click", closePaywall);
  // ESC 关闭弹窗
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("paywall").hidden) closePaywall();
  });

  await bootstrapBackend();
  renderStudio();
}

document.addEventListener("DOMContentLoaded", init);
