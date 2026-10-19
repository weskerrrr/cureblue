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
  imageProvider: "cloudflare",
  artPrompt: "",
  currentArtwork: null,
  gallery: loadGallery(),
  generating: false,
  meditation: null, // { id, sound, remaining, paused }
  meditationVolume: 60,
  artBatch: 0,
  medBatch: 0,
  taskIndex: 0,
  activeTask: null, // { id, ...每个互动任务自己的进度 }
};

/* ---------------- 无障碍三通道反馈 ---------------- */
// 语音播报 + 字幕同步 + 触觉反馈，三者尽量同时触发
function announce(text, { assertive = false, vibrate = true } = {}) {
  const region = document.getElementById(assertive ? "live-assertive" : "live-polite");
  region.textContent = "";
  // 微延迟以确保读屏软件重新读取
  requestAnimationFrame(() => (region.textContent = text));

  if (state.captions) setCaption(text);

  // 语音合成（听障用户可关闭，视障用户核心依赖）；手机兼容见 audio.js
  if (state.role !== "deaf") window.ArtMindAudio?.speak(text);

  // 触觉反馈
  if (vibrate && window.ArtMindHaptics?.enabled !== false && "vibrate" in navigator) {
    navigator.vibrate(assertive ? [80, 40, 80] : 30);
  }

  document.body.classList.add("is-speaking");
  clearTimeout(speakGlow);
  speakGlow = setTimeout(() => document.body.classList.remove("is-speaking"), Math.min(9000, 800 + String(text).length * 160));
}

const PLACES = {
  studio: { n: 1, name: "创作", next: "疗愈", say: "创作。按住屏幕中间的麦克风，说出你想画的画面，松开手指就开始画。向左滑，去疗愈。向右滑，去社区。" },
  tasks: { n: 2, name: "疗愈", next: "欣赏", say: "疗愈。上下滑动换一个练习，点中间开始。向左滑，去欣赏。" },
  gallery: { n: 3, name: "欣赏", next: "社区", say: "欣赏。上下滑动画面，会换一幅画，并念出解说。向左滑，去社区。" },
  community: { n: 4, name: "社区", next: "创作", say: "社区。点一下，听一条动态。按住中间，说出你想分享的话，松开就发布。向左滑，回到创作。" },
};
let speakGlow = null;

function orient(view, { speak = true } = {}) {
  const place = PLACES[view] || PLACES.studio;
  const kicker = document.getElementById("now-kicker");
  const line = document.getElementById("now-line");
  if (kicker) kicker.textContent = place.name;
  if (line) line.textContent = place.say;
  document.body.dataset.place = view;
  if (!speak) return;
  window.ArtMindAudio?.stopSpeech();
  announce(`${place.name}模块`);
}

function setCaption(text) {
  document.getElementById("caption-text").textContent = text;
}

/* ---------------- Freemium 功能墙 ---------------- */
function isPro() {
  return true;
}

// 统一拦截入口：返回 true 表示有权限，false 表示已弹出 Paywall
function requirePro() {
  return true;
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
const ROOMS = ["studio", "tasks", "gallery", "community"];
const TRACK = ["community", "studio", "tasks", "gallery", "community", "studio"];

function spokenDestination(text) {
  if (/社区/.test(text)) return "community";
  if (/冥想|欣赏/.test(text)) return "gallery";
  if (/任务|练习|疗愈/.test(text)) return "tasks";
  if (/去创作|打开创作|创作工坊/.test(text)) return "studio";
  return "";
}

function updateRoomChrome() {
  const i = Math.max(0, ROOMS.indexOf(state.view));
  const dots = document.getElementById("room-dots");
  if (dots) {
    dots.innerHTML = ROOMS.map((id, index) => `<span class="${index === i ? "on" : ""}"></span>`).join("");
  }
  const prev = PLACES[ROOMS[(i + ROOMS.length - 1) % ROOMS.length]];
  const next = PLACES[ROOMS[(i + 1) % ROOMS.length]];
  const left = document.getElementById("peek-left");
  const right = document.getElementById("peek-right");
  if (left) left.textContent = prev.name;
  if (right) right.textContent = next.name;
  const place = PLACES[state.view];
  const kicker = document.getElementById("now-kicker");
  const line = document.getElementById("now-line");
  if (kicker && place) kicker.textContent = place.name;
  if (line && place) line.textContent = place.say;
}

function trackIndex(view) {
  if (view === "community") return 4;
  if (view === "studio") return 1;
  return Math.max(0, TRACK.indexOf(view));
}

function scrollToRoom(view, behavior = "smooth") {
  const deck = document.getElementById("main");
  const index = trackIndex(view);
  if (!deck || index < 0) return;
  deck.scrollTo({ left: index * deck.clientWidth, behavior });
}

function switchDesktopView(view) {
  const labels = {
    studio: "创作工坊",
    tasks: "疗愈任务",
    gallery: "欣赏与冥想",
    community: "安全社区",
    subscribe: "订阅会员",
  };
  if (!labels[view]) return;
  if (view !== "gallery" && state.meditation) stopMeditation({ silent: true });
  if (view !== "tasks") {
    runTaskCleanup();
    window.ArtMindAudio?.stopFx();
  }
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = true;
  });
  document.querySelectorAll(".navbtn").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  const panel = document.getElementById("view-" + view);
  if (panel) panel.hidden = false;
  renderView(view);
  document.getElementById("main")?.focus();
  announce("已打开" + labels[view]);
}

function switchView(view, { scroll = true } = {}) {
  if (!isMobileShell()) {
    switchDesktopView(view);
    return;
  }
  if (!ROOMS.includes(view)) return;
  if (view === state.view && document.getElementById("view-" + view)?.childElementCount) return;
  if (view !== "gallery" && state.meditation) stopMeditation({ silent: true });
  if (view !== "studio") cancelPromptRecording();
  if (view !== "tasks") {
    runTaskCleanup();
    window.ArtMindAudio?.stopFx();
    if (state.activeTask) {
      state.activeTask = null;
      renderTaskLobby();
    }
  }
  state.view = view;
  window.ArtMindVoid?.setRoom(view);
  renderView(view);
  updateRoomChrome();
  if (scroll) scrollToRoom(view);
  orient(view);
  syncClones();
}

function syncClones() {
  const studio = document.getElementById("view-studio");
  const community = document.getElementById("view-community");
  const before = document.getElementById("clone-before");
  const after = document.getElementById("clone-after");
  const mirror = (from, to) => {
    if (!from || !to) return;
    to.innerHTML = from.innerHTML;
    to.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  };
  mirror(community, before);
  mirror(studio, after);
}

function bindDeck() {
  const deck = document.getElementById("main");
  if (!deck) return;
  let jumping = false;
  const width = () => Math.max(1, deck.clientWidth || window.innerWidth);
  const indexNow = () => Math.round(deck.scrollLeft / width());
  const placeAt = (index) => {
    jumping = true;
    deck.style.scrollBehavior = "auto";
    deck.scrollLeft = index * width();
    requestAnimationFrame(() => { jumping = false; });
  };

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let axis = "";
  const onHold = (target) => target?.closest?.(".hold-mic, .paint-canvas, input, textarea, select");
  deck.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || onHold(event.target)) {
      tracking = false;
      return;
    }
    tracking = true;
    axis = "";
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });
  deck.addEventListener("touchmove", (event) => {
    if (!tracking || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (!axis && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axis === "x" && event.cancelable) event.preventDefault();
  }, { passive: false });
  deck.addEventListener("touchend", (event) => {
    if (!tracking) return;
    tracking = false;
    const point = event.changedTouches?.[0];
    if (!point || axis !== "x") return;
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy)) return;
    const dest = Math.max(0, Math.min(TRACK.length - 1, indexNow() + (dx < 0 ? 1 : -1)));
    const looping = dest === 0 || dest === TRACK.length - 1;
    const view = looping ? (dest === 0 ? "community" : "studio") : TRACK[dest];
    placeAt(looping ? trackIndex(view) : dest);
    if (view && view !== state.view) switchView(view, { scroll: false });
  });
  deck.addEventListener("touchcancel", () => { tracking = false; });
}

let lastVerticalSwipeAt = 0;

function recentVerticalSwipe() {
  return Date.now() - lastVerticalSwipeAt < 500;
}

function bindVerticalCycle(el, onDelta) {
  if (!el) return;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  el.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".paint-canvas, input, textarea, select")) {
      tracking = false;
      return;
    }
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
  });
  el.addEventListener("pointerup", (event) => {
    if (!tracking) return;
    tracking = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dy) < 42 || Math.abs(dy) < Math.abs(dx) * 1.15) return;
    lastVerticalSwipeAt = Date.now();
    const button = event.target.closest("button");
    if (button) {
      const stop = (click) => {
        click.preventDefault();
        click.stopPropagation();
      };
      button.addEventListener("click", stop, { capture: true, once: true });
    }
    onDelta(dy < 0 ? 1 : -1);
  });
  el.addEventListener("pointercancel", () => { tracking = false; });
}

function isMobileShell() {
  return document.documentElement.dataset.shell !== "desktop";
}

function renderView(view) {
  const map = {
    studio: renderStudio,
    tasks: renderTasks,
    gallery: renderGallery,
    community: renderCommunity,
    subscribe: renderSubscribe,
  };
  map[view]?.();
}

/* ---------------- 手机房间 ---------------- */
function releaseHoldRecording() {
  return new Promise((resolve) => {
    const session = promptRec;
    if (!session || session.pending || !session.recorder) {
      if (session?.pending) {
        promptRec = null;
        announce("麦克风还在准备，请按住稍等，听到提示后再说。", { assertive: true });
      }
      resolve("");
      return;
    }
    session.busy = true;
    clearTimeout(session.timer);
    const recorder = session.recorder;
    recorder.onstop = async () => {
      session.stream.getTracks().forEach((track) => track.stop());
      promptRec = null;
      const blob = new Blob(session.chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size < 800) {
        announce("按住的时间太短，请再说长一点。", { assertive: true });
        resolve("");
        return;
      }
      try {
        resolve(await transcribeRecording(blob));
      } catch {
        announce("没有识别出来，请再按住说一次。", { assertive: true });
        resolve("");
      }
    };
    try { recorder.stop(); } catch {
      promptRec = null;
      resolve("");
    }
  });
}

function clearTextSelection() {
  const selection = window.getSelection?.();
  if (!selection || !selection.rangeCount) return;
  const node = selection.anchorNode;
  const field = node && (node.nodeType === 1 ? node : node.parentElement)?.closest?.("input, textarea");
  if (field) return;
  selection.removeAllRanges();
}

function blockMobileSelection() {
  const inField = (event) => event.target.closest?.("input, textarea");
  document.addEventListener("selectstart", (event) => {
    if (inField(event)) return;
    event.preventDefault();
  });
  document.addEventListener("contextmenu", (event) => {
    if (inField(event)) return;
    event.preventDefault();
  });
  document.addEventListener("selectionchange", () => {
    if (document.activeElement?.closest?.("input, textarea")) return;
    clearTextSelection();
  });
}

function bindHoldMic(button, onText) {
  let holding = false;
  const start = async (event) => {
    if (event?.cancelable) event.preventDefault();
    if (holding || button.disabled) return;
    if (event?.pointerType === "touch") return;
    holding = true;
    clearTextSelection();
    button.classList.add("holding");
    window.ArtMindVoid?.setHolding(true);
    const deck = document.getElementById("main");
    if (deck) deck.style.overflowX = "hidden";
    window.ArtMindAudio?.stopSpeech();
    setCaption("正在听。说完松开。");
    buzz(18);
    await startMicPrompt({ hold: true });
  };
  const beginTouch = (event) => {
    if (event.cancelable) event.preventDefault();
    clearTextSelection();
    start({ pointerType: "mouse" });
  };
  const end = async (event) => {
    if (event?.cancelable) event.preventDefault();
    if (!holding) return;
    holding = false;
    button.classList.remove("holding");
    window.ArtMindVoid?.setHolding(false);
    const deck = document.getElementById("main");
    if (deck) deck.style.overflowX = "";
    const text = (await releaseHoldRecording()).trim();
    if (text) onText(text);
  };
  button.addEventListener("touchstart", beginTouch, { passive: false });
  button.addEventListener("touchend", end, { passive: false });
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") return;
    end(event);
  });
}

function renderStudioRoom() {
  const el = document.getElementById("view-studio");
  const art = state.currentArtwork;
  el.innerHTML = `
    <div class="room-stage">
      <p class="room-kicker">创作</p>
      <h1>${state.generating ? "正在作画" : "按住说，松开就画"}</h1>
      <div class="room-visual" id="canvas" role="region" aria-label="${art ? escapeHTML(art.prompt) : "还没有画"}">
        ${state.generating
          ? `<div class="art-loading"><span class="art-spinner" aria-hidden="true"></span><strong>正在画</strong></div>`
          : art
            ? `<img src="${art.url}" alt="${escapeHTML(art.altText || art.prompt)}" />`
            : `<p class="room-empty">松开之后，画会出现在这里</p>`}
      </div>
      <textarea id="prompt" class="sr-only">${escapeHTML(state.artPrompt)}</textarea>
      <button type="button" class="hold-mic" id="hold-mic" ${state.generating ? "disabled" : ""}>
        <strong>${state.generating ? "请稍候" : "麦克风"}</strong>
        <small>${state.generating ? "正在画" : "按住说话"}</small>
      </button>
      <p class="room-hint">左右滑动，换模块</p>
    </div>`;
  const mic = el.querySelector("#hold-mic");
  window.ArtMindVoid?.setBusy(state.generating);
  window.ArtMindVoid?.setHolding(false);
  if (!mic || state.generating) return;
  bindHoldMic(mic, (text) => {
    const dest = spokenDestination(text);
    if (dest && dest !== "studio") {
      switchView(dest);
      return;
    }
    for (const style of ART_STYLES) {
      if (style.id !== "auto" && text.includes(style.label)) state.artStyle = style.id;
    }
    state.artPrompt = text;
    const input = document.getElementById("prompt");
    if (input) input.value = text;
    announce(`我听到了：${text}`);
    runAI("image");
  });
}

function currentTask() {
  const list = state.tasks;
  state.taskIndex = ((state.taskIndex || 0) % list.length + list.length) % list.length;
  return list[state.taskIndex];
}

function stepTask(delta) {
  runTaskCleanup();
  state.activeTask = null;
  state.taskIndex += delta;
  const task = currentTask();
  renderTaskLobby();
  const total = state.tasks.length;
  const index = state.taskIndex + 1;
  announce(`第 ${index} 个练习，${task.title}。在中间上下滑动可以换练习。`);
  return { task, index, total };
}

function exerciseSwitcher(index, total) {
  return `
    <div class="exercise-swipe" aria-label="上下滑动换练习">
      <button type="button" class="exercise-step" data-task-step="-1">上一个练习</button>
      <p>在这里上下滑动</p>
      <strong>${index} / ${total}</strong>
      <button type="button" class="exercise-step" data-task-step="1">下一个练习</button>
    </div>`;
}

function renderTaskLobby() {
  const el = document.getElementById("view-tasks");
  if (!el) return;
  const next = currentTask();
  const total = state.tasks.length;
  const index = state.taskIndex + 1;
  el.innerHTML = `
    <div class="room-stage">
      <p class="room-kicker">疗愈 · ${index} / ${total}</p>
      <h1>${escapeHTML(next.title)}</h1>
      <p class="room-lead">${escapeHTML(next.desc)}</p>
      ${exerciseSwitcher(index, total)}
      <button type="button" class="hold-mic act" id="task-go">
        <strong>开始</strong>
        <small>${next.minutes} 分钟</small>
      </button>
      <p class="room-hint">左右滑动换模块</p>
    </div>`;
  el.querySelector("#task-go").addEventListener("click", () => {
    if (recentVerticalSwipe()) return;
    startTask(next);
  });
  el.querySelectorAll("[data-task-step]").forEach((button) => {
    button.addEventListener("click", () => stepTask(Number(button.dataset.taskStep)));
  });
}

function narrateArtwork(art) {
  announce(`${art.title}。作者${art.author}。画面：${art.alt}色彩以${art.palette.join("、")}为主。构图：${art.composition}。情感：${art.emotion}。`, { vibrate: false });
}

function stepArt(delta) {
  if (state.meditation) stopMeditation({ silent: true });
  const arts = D.artworks;
  state.artIndex = ((state.artIndex || 0) + delta + arts.length) % arts.length;
  renderGalleryRoom();
  narrateArtwork(arts[state.artIndex]);
}

function renderGalleryRoom() {
  const el = document.getElementById("view-gallery");
  const arts = D.artworks;
  state.artIndex = ((state.artIndex || 0) % arts.length + arts.length) % arts.length;
  const art = arts[state.artIndex];
  el.innerHTML = `
    <div class="room-stage">
      <p class="room-kicker">欣赏 · ${state.artIndex + 1} / ${arts.length}</p>
      <h1>${escapeHTML(art.title)}</h1>
      <button type="button" class="room-visual art-hit" id="art-stage" aria-label="点一下，听${escapeHTML(art.title)}的解说">
        <img src="${art.image}" alt="${escapeHTML(art.alt)}" />
      </button>
      <button type="button" class="listen-hit" id="art-listen">听解说</button>
      <p class="room-hint">点画面听解说 · 上下滑动换一幅 · 左右滑动换模块</p>
    </div>`;
  const tell = () => {
    if (recentVerticalSwipe()) return;
    narrateArtwork(art);
  };
  el.querySelector("#art-stage").addEventListener("click", tell);
  el.querySelector("#art-listen").addEventListener("click", tell);
}

function renderGalleryFocus() {
  const el = document.getElementById("view-gallery");
  el.innerHTML = `<div class="room-stage med-live">${renderMeditationPlayer()}<p class="room-hint">结束之后回到这幅画</p></div>`;
  el.querySelectorAll("[data-sound]").forEach((button) => button.addEventListener("click", () => {
    if (!state.meditation) return;
    state.meditation.sound = button.dataset.sound;
    if (!state.meditation.paused) window.ArtMindAudio?.startNoise(button.dataset.sound);
    renderGalleryFocus();
  }));
  el.querySelector("#med-volume")?.addEventListener("input", (event) => {
    state.meditationVolume = Number(event.target.value);
    window.ArtMindAudio?.setNoiseVolume(state.meditationVolume / 100);
  });
  el.querySelector("#med-pause")?.addEventListener("click", toggleMeditationPause);
  el.querySelector("#med-stop")?.addEventListener("click", () => stopMeditation());
}

async function publishSpokenPost(text) {
  const clean = text.trim();
  if (!clean) return;
  let verdict;
  if (state.apiReady) {
    const resp = await API.moderate(clean);
    verdict = resp && resp.ok ? resp : { action: "block", reason: "审核服务异常。" };
  } else {
    verdict = mockModerate(clean);
  }
  if (verdict.action === "block") {
    announce("这句话没有通过安全审核。" + (verdict.reason || ""), { assertive: true });
    return;
  }
  if (verdict.action === "crisis") {
    announce(verdict.message || "我们很关心你。如果这种感觉持续，请告诉信任的大人。", { assertive: true });
    return;
  }
  if (state.apiReady) {
    try { state.posts = await API.feed(); } catch {}
  } else {
    state.posts.unshift({ id: "p" + Date.now(), author: "我", text: clean, status: "approved" });
  }
  state.postIndex = 0;
  announce("已发布。点一下可以听这条。");
  renderCommunityRoom();
}

function renderCommunityRoom() {
  const el = document.getElementById("view-community");
  const visible = state.posts.filter((post) => post.status === "approved" || state.role === "parent");
  const post = visible[state.postIndex % Math.max(1, visible.length)];
  el.innerHTML = `
    <div class="room-stage">
      <p class="room-kicker">社区</p>
      <h1>${post ? escapeHTML(post.author) : "还没有动态"}</h1>
      <p class="room-lead">${post ? escapeHTML(post.status === "blocked" ? "这条内容已被拦住。" : post.text) : "按住中间，说出你想分享的话。"}</p>
      <button type="button" class="hold-mic" id="community-go">
        <strong>${state.role === "parent" ? "听一条" : "听 / 说"}</strong>
        <small>${state.role === "parent" ? "下一条" : "点一下听，按住说"}</small>
      </button>
      <p class="room-hint">左右滑动，换模块</p>
    </div>`;
  const button = el.querySelector("#community-go");
  let timer = null;
  let holding = false;
  button.addEventListener("touchstart", (event) => {
    if (event.cancelable) event.preventDefault();
    clearTextSelection();
  }, { passive: false });
  button.addEventListener("pointerdown", (event) => {
    if (state.role === "parent") return;
    event.preventDefault();
    clearTextSelection();
    holding = false;
    timer = setTimeout(async () => {
      holding = true;
      button.classList.add("holding");
      window.ArtMindVoid?.setHolding(true);
      window.ArtMindAudio?.stopSpeech();
      setCaption("正在听。说完松开。");
      await startMicPrompt();
    }, 380);
  });
  button.addEventListener("pointerup", async () => {
    clearTimeout(timer);
    if (holding) {
      holding = false;
      button.classList.remove("holding");
      window.ArtMindVoid?.setHolding(false);
      const text = (await releaseHoldRecording()).trim();
      if (text) publishSpokenPost(text);
      return;
    }
    if (!visible.length) {
      announce("还没有可以听的动态。");
      return;
    }
    const current = visible[state.postIndex % visible.length];
    state.postIndex += 1;
    const spoken = current.status === "blocked" ? `内容已被拦住。${current.reason || ""}` : current.text;
    announce(`${current.author}说：${spoken}`);
    renderCommunityRoom();
  });
  button.addEventListener("pointercancel", () => clearTimeout(timer));
}

function renderSubscribeRoom() {
  const el = document.getElementById("view-subscribe");
  const pro = isPro();
  el.innerHTML = `
    <div class="room-stage">
      <p class="room-kicker">会员</p>
      <h1>${pro ? "你已经是会员" : "免费，或会员"}</h1>
      <p class="room-lead">${pro ? "无限作画，全部练习都已打开。" : "免费每天可以画三次。会员可以无限作画，并打开全部练习。"}</p>
      <button type="button" class="hold-mic act" id="plan-go" ${pro ? "disabled" : ""}>
        <strong>${pro ? "已开通" : "听方案"}</strong>
        <small>${pro ? "月度会员" : "再点一次开通"}</small>
      </button>
      <p class="room-hint">向右滑，回到社区</p>
    </div>`;
  const button = el.querySelector("#plan-go");
  let armed = false;
  button?.addEventListener("click", () => {
    if (pro) return;
    if (!armed) {
      armed = true;
      button.querySelector("strong").textContent = "开通会员";
      announce("免费版每天可以画三次，能做基础练习。月度会员三十九元，可以无限作画，并打开全部练习。再点一次，开通月度会员。");
      return;
    }
    subscribe("monthly");
  });
}

/* ---------------- 模块一：创作工坊 ---------------- */
function renderStudio() {
  if (isMobileShell()) {
    renderStudioRoom();
    return;
  }
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

/* 语音输入：先停掉朗读（否则会占住麦克风），再录音交给服务器识别。
   系统 SpeechRecognition 在手机、微信、非 HTTPS 下经常不可用，只作为备用。 */
let promptRec = null;

function voiceButton() {
  return document.getElementById("voice-prompt");
}

function setVoiceButton(label, { listening = false, busy = false } = {}) {
  const button = voiceButton();
  if (!button) return;
  button.textContent = label;
  button.disabled = busy;
  button.classList.toggle("listening", listening);
  button.setAttribute("aria-pressed", String(listening));
}

function applyHeardPrompt(text) {
  const input = document.getElementById("prompt");
  if (!input || !text) return;
  input.value = input.value.trim() ? `${input.value.trim()} ${text}` : text;
  state.artPrompt = input.value;
  input.dispatchEvent(new Event("input"));
  announce(`我听到了：${text}`);
}

function pickRecorderMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function pcmToWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function recordingToWav(blob) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const rate = 16000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return pcmToWav(rendered.getChannelData(0), rate);
  } finally {
    ctx.close?.();
  }
}

async function transcribeRecording(blob) {
  let payload = blob;
  try {
    payload = await recordingToWav(blob);
  } catch {}
  const audio = await blobToDataUrl(payload);
  const res = await fetch("/api/stt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok || !data.text) throw new Error(data.error || "stt-failed");
  return data.text;
}

function cancelPromptRecording() {
  const session = promptRec;
  promptRec = null;
  if (!session) return;
  clearTimeout(session.timer);
  try { session.recognition?.abort(); } catch {}
  if (session.recorder && session.recorder.state !== "inactive") {
    try { session.recorder.stop(); } catch {}
  }
  session.stream?.getTracks().forEach((track) => track.stop());
  setVoiceButton("🎙️ 语音输入");
}

function captureArtworkPrompt() {
  if (promptRec?.busy) return;
  if (promptRec) {
    finishPromptRecording();
    return;
  }
  window.ArtMindAudio?.stopSpeech();
  if (!window.isSecureContext) {
    announce("语音输入需要在安全连接下使用。请打开 https://cure.mrkings.net ，或直接打字描述画面。", { assertive: true });
    return;
  }
  startPromptRecording();
}

function nativeSpeechAvailable() {
  const ua = navigator.userAgent;
  if (/iP(hone|ad|od)|MicroMessenger|QQ\//i.test(ua)) return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function startPromptRecording() {
  // 国内访问时浏览器自带识别常因连不上 Google 而失败，优先用本机录音 + Cloudflare 识别。
  if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
    startMicPrompt();
    return;
  }
  if (nativeSpeechAvailable()) {
    startNativePrompt();
    return;
  }
  announce("当前浏览器不支持录音，请直接打字描述画面。", { assertive: true });
}

function startNativePrompt() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let finalText = "";
  promptRec = { recognition, timer: null, busy: false };
  setVoiceButton("🔴 正在听… 再点结束", { listening: true });
  setCaption("请说出你想画的内容，说完再点一下结束。");

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += piece;
      else interim += piece;
    }
    const live = (finalText || interim).trim();
    if (live) setCaption(`听到：${live}`);
  };
  recognition.onerror = (event) => {
    const err = event.error;
    if (err === "aborted") return;
    promptRec = null;
    setVoiceButton("🎙️ 语音输入");
    if (err === "not-allowed") {
      announce("需要麦克风权限，请在浏览器里允许使用麦克风。", { assertive: true });
      return;
    }
    if (err === "no-speech") {
      announce("没有听到声音，请靠近麦克风再说一次，或直接打字。", { assertive: true });
      return;
    }
    startMicPrompt();
  };
  recognition.onend = () => {
    if (!promptRec || promptRec.recognition !== recognition) return;
    promptRec = null;
    setVoiceButton("🎙️ 语音输入");
    const text = finalText.trim();
    if (text) applyHeardPrompt(text);
    else announce("没有听清，请再试一次或直接打字。", { assertive: true });
  };
  try {
    recognition.start();
    promptRec.timer = setTimeout(() => recognition.stop(), 12000);
  } catch {
    promptRec = null;
    startMicPrompt();
  }
}

async function startMicPrompt(options = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    announce("当前浏览器不支持录音，请直接打字描述画面。", { assertive: true });
    return;
  }
  promptRec = { pending: true, busy: false };
  setVoiceButton("正在打开麦克风…", { listening: true });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    promptRec = null;
    setVoiceButton("🎙️ 语音输入");
    const name = err?.name || "";
    announce(name === "NotAllowedError" || name === "SecurityError"
      ? "需要麦克风权限。请允许使用麦克风，或在系统设置里打开麦克风。"
      : "没有找到麦克风，请直接打字描述画面。", { assertive: true });
    return;
  }
  if (!promptRec) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  const mime = pickRecorderMime();
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  promptRec = { stream, recorder, chunks, timer: null, busy: false };
  recorder.start(250);
  if (options.hold) return;
  setVoiceButton("🔴 正在说… 再点结束", { listening: true });
  setCaption("请说出你想画的内容，说完再点一下结束。");
  promptRec.timer = setTimeout(() => finishPromptRecording(), 12000);
}

function finishPromptRecording() {
  const session = promptRec;
  if (!session || session.busy || session.pending) return;
  if (session.recognition) {
    try { session.recognition.stop(); } catch {}
    return;
  }
  session.busy = true;
  clearTimeout(session.timer);
  setVoiceButton("正在识别…", { busy: true });
  const recorder = session.recorder;
  recorder.onstop = async () => {
    session.stream.getTracks().forEach((track) => track.stop());
    promptRec = null;
    const blob = new Blob(session.chunks, { type: recorder.mimeType || "audio/webm" });
    if (blob.size < 800) {
      setVoiceButton("🎙️ 语音输入");
      announce("录音太短，请再说一次，或直接打字。", { assertive: true });
      return;
    }
    try {
      applyHeardPrompt(await transcribeRecording(blob));
    } catch {
      announce("语音识别没有成功，请再试一次或直接打字。", { assertive: true });
    } finally {
      setVoiceButton("🎙️ 语音输入");
    }
  };
  try { recorder.stop(); } catch {
    session.stream.getTracks().forEach((track) => track.stop());
    promptRec = null;
    setVoiceButton("🎙️ 语音输入");
  }
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
  if (!url || url.startsWith("data:")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const load = () => {
      const image = new Image();
      const timer = setTimeout(() => {
        image.src = "";
        retry(new Error("timeout"));
      }, 45000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); retry(new Error("load-failed")); };
      image.src = url;
    };
    const retry = (err) => {
      attempt += 1;
      if (attempt >= 3) reject(err);
      else setTimeout(load, 600 * attempt);
    };
    load();
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
      const resp = await API.ai(capability, prompt, { style: state.artStyle, provider: state.imageProvider });
      if (!resp || resp.ok === false) {
        state.generating = false;
        if (resp && resp.code === "PRO_REQUIRED") return openPaywall("该能力为会员专享功能。");
        if (resp && resp.code === "FREE_QUOTA_EXCEEDED") return openPaywall("今日免费 AI 生成次数已用完，升级订阅可无限创作。");
        renderStudio();
        announce(resp?.error || "生成失败，请稍后再试。", { assertive: true });
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
      const built = await window.ArtMindImage.build({ prompt, style: style.id });
      fallbackResult = {
        ...built,
        provider: "pollinations",
        providerLabel: "Pollinations",
        altText: `这是一幅${style.label}风格的画，画的是${prompt}。`,
      };
      await preloadImage(built.url);
    }
    state.generating = false;
    renderAIResult(kind, prompt, fallbackResult);
  } catch {
    state.generating = false;
    renderStudio();
    announce("作画没有成功，可能是网络问题。请稍后重试。", { assertive: true });
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
  if (isMobileShell()) {
    runTaskCleanup();
    if (!state.activeTask) {
      renderTaskLobby();
      return;
    }
    const stageHost = document.getElementById("view-tasks");
    const index = state.taskIndex + 1;
    const total = state.tasks.length;
    stageHost.innerHTML = `
      <section class="room-stage task-live">
        ${exerciseSwitcher(index, total)}
        <div id="task-stage" aria-live="polite"></div>
      </section>`;
    stageHost.querySelectorAll("[data-task-step]").forEach((button) => {
      button.addEventListener("click", () => stepTask(Number(button.dataset.taskStep)));
    });
    renderTaskStage(stageHost.querySelector("#task-stage"));
    return;
  }
  const el = document.getElementById("view-tasks");
  const p = D.progress;
  const isTherapist = state.role === "therapist";
  const doneCount = state.tasks.filter((t) => t.done).length;

  el.innerHTML = `
    <div class="view-head">
      <h1>个性化 AI 疗愈任务</h1>
      <p>${isTherapist ? "你可以调整 AI 为学员推荐的任务方案。" : "AI 根据你的创作行为与情绪反馈，为你定制今日打卡。"}</p>
    </div>

    ${state.activeTask ? `<section class="card task-stage" id="task-stage" aria-live="polite"></section>` : ""}

    <div class="grid grid-2">
      <div class="card">
        <div class="section-head">
          <h3 style="margin:0">今日任务</h3>
          <span class="batch-count" aria-label="今日已完成 ${doneCount} 个，共 ${state.tasks.length} 个">已完成 ${doneCount}/${state.tasks.length}</span>
        </div>
        <div class="progress" style="margin:8px 0 14px"><span style="width:${(doneCount / state.tasks.length) * 100}%"></span></div>
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
    .map((t) => {
      const locked = t.pro && !isPro();
      const active = state.activeTask?.id === t.id;
      return `
    <div class="task card task-item ${locked ? "locked" : ""} ${t.done ? "done" : ""} ${active ? "active" : ""}">
      <span class="task-icon" aria-hidden="true">${t.done ? "✅" : t.icon}</span>
      <div class="task-body">
        <strong>${t.title}</strong>
        <p class="task-desc">${t.desc}</p>
        <span class="tag ${t.level === "入门" ? "tag-deaf" : "tag-blind"}">${t.level}</span>
        <span style="color:var(--text-dim)"> · ${t.minutes} 分钟</span>
        ${locked ? '<span class="lock-pill">PRO</span>' : ""}
      </div>
      <div class="task-actions">
        <button class="btn ${t.done ? "btn-ghost" : "btn-primary"}" data-start="${t.id}"
          aria-label="${t.done ? "再玩一次" : "开始"}：${t.title}">${active ? "进行中" : t.done ? "再玩一次" : "开始"}</button>
        ${isTherapist ? `<button class="btn btn-ghost" data-adjust="${t.id}">调整</button>` : ""}
      </div>
    </div>`;
    })
    .join("");

  list.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = state.tasks.find((x) => x.id === b.dataset.start);
      if (t.pro && !requirePro(`"${t.title}"为会员专享的进阶任务。`)) return;
      startTask(t);
    })
  );

  if (state.activeTask) renderTaskStage(el.querySelector("#task-stage"));

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

/* ---------------- 互动疗愈任务 ---------------- */
// buzz：选中时的"情绪震动签名"（毫秒：震、停、震…）
const MOODS = [
  { id: "yellow", color: "#FFD45C", name: "暖黄", mood: "开心", buzz: [20, 40, 20, 40, 20, 40, 40], reply: "开心的能量值得被记住，想一想今天是什么让你这么开心？" },
  { id: "sky", color: "#7CC6FF", name: "天蓝", mood: "平静", buzz: [90], reply: "平静是很珍贵的状态，带着它去做接下来的事吧。" },
  { id: "green", color: "#6FD39A", name: "嫩绿", mood: "放松", buzz: [40, 90, 40], reply: "身体放松下来了，记住这种舒服的感觉。" },
  { id: "pink", color: "#FF9EC4", name: "粉色", mood: "温暖", buzz: [30, 60, 60], reply: "被温暖包围的时候，也可以把这份温暖传给别人。" },
  { id: "purple", color: "#A88BFF", name: "淡紫", mood: "紧张", buzz: [10, 25, 10, 25, 10, 25, 10, 25, 10], reply: "有点紧张很正常，先做三次深呼吸，再把担心的事写下来。" },
  { id: "grey", color: "#9AA3B5", name: "灰色", mood: "疲惫", buzz: [160], reply: "累了就休息一下，今天已经很努力了。" },
  { id: "navy", color: "#3D5A9E", name: "深蓝", mood: "难过", buzz: [80, 160, 80], reply: "难过的时候不用一个人扛，可以和信任的人或疗愈师聊聊。" },
  { id: "red", color: "#FF6B6B", name: "红色", mood: "生气", buzz: [60, 30, 60, 30, 60, 30, 90], reply: "生气说明有些事情对你很重要，先让身体动一动，把力气释放出来。" },
];
const WEATHERS = [
  { id: "sunny", icon: "☀️", label: "晴天", mood: "心情很好", tip: "把这份好心情分享给一个朋友吧。" },
  { id: "cloudy", icon: "⛅", label: "多云", mood: "有点平淡", tip: "做一件小小的、让你期待的事。" },
  { id: "fog", icon: "🌫️", label: "有雾", mood: "迷茫、说不清", tip: "说不清也没关系，试着画下来或写一个词。" },
  { id: "rain", icon: "🌧️", label: "小雨", mood: "有点难过", tip: "允许自己难过一会儿，也可以找信任的人聊聊。", care: true },
  { id: "storm", icon: "⛈️", label: "雷雨", mood: "烦躁或生气", tip: "先离开让你烦躁的地方，喝口水，做五次深呼吸。", care: true },
  { id: "rainbow", icon: "🌈", label: "雨后彩虹", mood: "刚刚变好", tip: "记住是什么让你好起来的，下次还可以再用。" },
];
const WEATHER_CAUSES = ["学习", "朋友", "家人", "身体", "兴趣爱好", "说不清"];
const MELODIES = [
  { id: "light", label: "🎈 轻快", dur: 0.26, color: "#FFB347", notes: [0, 4, 7, 12, 7, 4, 0, 4, 7, 12], reply: "轻快的旋律常常让人联想到跳动、向上的线条。" },
  { id: "long", label: "🌙 悠长", dur: 0.7, color: "#7CC6FF", notes: [12, 11, 7, 9, 4, 5, 2, 0], reply: "悠长的旋律像慢慢流动的水，很适合用平缓的曲线表达。" },
  { id: "jump", label: "🐸 跳跃", dur: 0.2, color: "#FF6B9E", notes: [0, 12, 2, 14, 4, 16, 7, 19, 12, 0], reply: "跳跃的旋律高低起伏，很多人会画出尖尖的折线。" },
];
const MELODY_SHAPES = ["〰️ 波浪", "⛰️ 山峰", "⭕ 圆圈", "📶 阶梯", "🌀 螺旋", "⚡ 闪电"];
const SHAPE_BUZZ = {
  "〰️ 波浪": [30, 40, 60, 40, 30, 40, 60],
  "⛰️ 山峰": [10, 30, 25, 30, 45, 30, 70, 60, 20],
  "⭕ 圆圈": [30, 30, 30, 30, 30, 30, 30, 30],
  "📶 阶梯": [20, 70, 35, 70, 50, 70, 70],
  "🌀 螺旋": [60, 120, 50, 90, 40, 60, 30, 40, 20, 25, 10],
  "⚡ 闪电": [90, 20, 15, 20, 15, 20, 90],
};
const AUTO_PAINT_BUZZ = [15, 25, 25, 25, 35, 25, 50, 25, 70];
const TRIPTYCH = [
  {
    label: "清晨", bg: "#FCE9DD", tip: "清晨的光是柔和的，试试浅粉、淡黄，再贴一个太阳或小鸟。",
    colors: [{ c: "#FFB4A2", n: "浅珊瑚" }, { c: "#FFE08A", n: "淡黄" }, { c: "#9AD0FF", n: "晨空蓝" }, { c: "#FFFFFF", n: "白色" }],
  },
  {
    label: "正午", bg: "#BFE6FF", tip: "正午阳光最强烈，用明亮饱和的颜色画出热闹的感觉。",
    colors: [{ c: "#FFD23F", n: "明黄" }, { c: "#FF8C42", n: "橙色" }, { c: "#2E86DE", n: "湛蓝" }, { c: "#4CAF50", n: "草绿" }],
  },
  {
    label: "夜晚", bg: "#1B1F45", tip: "夜晚安静下来了，用深蓝和紫色，再贴上月亮和星星。",
    colors: [{ c: "#3D3B8E", n: "靛蓝" }, { c: "#8E7CC3", n: "淡紫" }, { c: "#E0E6FF", n: "银白" }, { c: "#FFD86B", n: "月光黄" }],
  },
];
const STAMPS = [
  { icon: "☀️", name: "太阳", buzz: [40, 30, 40, 30, 80] },
  { icon: "🌙", name: "月亮", buzz: [120] },
  { icon: "⭐", name: "星星", buzz: [8, 30, 8, 30, 8] },
  { icon: "☁️", name: "云朵", buzz: [50, 80, 50] },
  { icon: "🌳", name: "大树", buzz: [100, 40, 40] },
  { icon: "🏠", name: "小房子", buzz: [35, 70, 35] },
  { icon: "🐦", name: "小鸟", buzz: [10, 15, 10, 15, 10, 15, 10] },
  { icon: "🌊", name: "海浪", buzz: [60, 40, 20, 40, 60] },
];

const TASK_INIT = {
  breath: () => ({ rounds: 0, goal: 5 }),
  mood: () => ({ mood: null, intensity: 3, word: "", strokes: 0 }),
  weather: () => ({ step: 0, weather: null }),
  melody: () => ({ melody: "light", listened: false, shape: null, strokes: 0 }),
  triptych: () => ({ panel: 0, color: TRIPTYCH[0].colors[0].c, mode: "brush", stamp: "☀️", images: [null, null, null], marks: [0, 0, 0] }),
};

let taskCleanups = [];
function onTaskCleanup(fn) { taskCleanups.push(fn); }
function runTaskCleanup() {
  taskCleanups.forEach((fn) => fn());
  taskCleanups = [];
  Haptics?.stopRhythm();
}
const taskStage = () => document.getElementById("task-stage");
const sfx = (kind) => window.ArtMindAudio?.chime(kind);
const Haptics = window.ArtMindHaptics;
const buzz = (pattern) => Haptics?.vibrate(pattern);

// 呼吸节奏：吸气时泡泡越大、震动越密越强；呼气时逐渐变疏变轻
const INHALE_MS = 4000;
const INHALE_PHASE = (e) => {
  if (e > 12000) return null;
  const p = Math.min(1, e / INHALE_MS);
  return { interval: Math.round(650 - 520 * p), dur: Math.round(12 + 38 * p), p };
};
const EXHALE_PHASE = (e) => {
  const p = e / INHALE_MS;
  if (p >= 1) return null;
  return { interval: Math.round(130 + 570 * p), dur: Math.round(50 - 38 * p), p: 1 - p };
};
const stripIcon = (label) => label.replace(/^\S+\s/, "");

function startTask(t) {
  state.activeTask = { id: t.id, finished: false, summary: "", resultHtml: "", ...TASK_INIT[t.kind]() };
  renderTasks();
  taskStage()?.scrollIntoView({ behavior: "smooth", block: "start" });
  announce(`开始任务：${t.title}。${t.desc}`);
}

function closeTask() {
  runTaskCleanup();
  state.activeTask = null;
  window.ArtMindAudio?.stopFx();
  renderTasks();
}

function completeTask(summary, resultHtml = "", spoken = summary) {
  const at = state.activeTask;
  const t = state.tasks.find((x) => x.id === at.id);
  t.done = true;
  Object.assign(at, { finished: true, summary, resultHtml });
  renderTasks();
  sfx("done");
  buzz([60, 40, 60, 40, 120]);
  announce(`任务完成：${t.title}。${spoken}`, { vibrate: false });
}

function renderTaskStage(stage) {
  runTaskCleanup();
  const at = state.activeTask;
  const t = state.tasks.find((x) => x.id === at.id);
  const hapticOn = Haptics?.enabled;
  const head = `
    <div class="stage-head">
      <h2><span aria-hidden="true">${t.icon}</span> ${t.title}</h2>
      <div class="stage-head-actions">
        <button class="btn btn-ghost" id="task-haptic" aria-pressed="${hapticOn}">📳 震动：${hapticOn ? "开" : "关"}</button>
        <button class="btn btn-ghost" id="task-close">✕ 收起</button>
      </div>
    </div>
    ${Haptics?.canVibrate ? "" : `<p class="service-note haptic-note">${Haptics?.isIOS
      ? "iPhone 网页只支持点击时轻震一下，节奏震动已改为节拍声和泡泡闪动。"
      : "当前浏览器不支持网页震动，已改用节拍声和画面闪动代替。"}</p>`}`;

  if (at.finished) {
    stage.innerHTML = `${head}
      <div class="stage-done">
        <div class="done-burst" aria-hidden="true">🎉</div>
        <p class="done-title">完成啦！</p>
        <p>${escapeHTML(at.summary)}</p>
        ${at.resultHtml}
        <div class="med-actions">
          <button class="btn btn-primary" id="task-again">再玩一次</button>
          <button class="btn btn-ghost" id="task-back">看看其他任务</button>
        </div>
      </div>`;
    stage.querySelector("#task-again").onclick = () => startTask(t);
    stage.querySelector("#task-back").onclick = closeTask;
  } else {
    stage.innerHTML = `${head}<div class="stage-body"></div>`;
    TASK_RENDER[t.kind](stage.querySelector(".stage-body"), at);
  }
  stage.querySelector("#task-close").onclick = closeTask;
  stage.querySelector("#task-haptic").onclick = () => {
    Haptics?.setEnabled(!Haptics.enabled);
    const btn = stage.querySelector("#task-haptic");
    btn.textContent = `📳 震动：${Haptics.enabled ? "开" : "关"}`;
    btn.setAttribute("aria-pressed", String(Haptics.enabled));
    if (Haptics.enabled) buzz([30, 50, 30]);
    announce(`震动反馈已${Haptics.enabled ? "开启" : "关闭"}。`, { vibrate: false });
  };
}

// 手指 / 鼠标绘画画布；mode 为 "stamp" 时点击放置贴纸
function setupPaint(canvas, { bg, color, size, mode = () => "brush", stamp = () => "⭐", stampBuzz = () => [40], onMark, restore }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 450;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (restore) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = restore;
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const stampAt = (x, y) => {
    ctx.font = `${Math.round(w / 9)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(stamp(), x, y);
    buzz(stampBuzz());
    onMark?.();
  };
  let last = null;
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const p = point(e);
    if (mode() === "stamp") return stampAt(p.x, p.y);
    buzz(Haptics?.colorProfile(color()).dur + 10);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    last = p;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color();
    ctx.beginPath();
    ctx.arc(p.x, p.y, size() / 2, 0, Math.PI * 2);
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    const p = point(e);
    Object.assign(ctx, { strokeStyle: color(), lineWidth: size(), lineCap: "round", lineJoin: "round" });
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    Haptics?.brush(Math.hypot(p.x - last.x, p.y - last.y), color(), size());
    last = p;
  });
  const end = () => {
    if (!last) return;
    last = null;
    ctx.globalAlpha = 1;
    onMark?.();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  return {
    stampRandom: () => stampAt(w * (0.15 + Math.random() * 0.7), h * (0.15 + Math.random() * 0.7)),
    // 看不见画布的用户可以让 AI 用所选颜色铺出柔和的色块
    autoPaint(colors) {
      for (let i = 0; i < 16; i++) {
        const c = colors[i % colors.length];
        const x = Math.random() * w;
        const y = Math.random() * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 40 + Math.random() * (w / 3));
        g.addColorStop(0, c);
        g.addColorStop(1, `${c}00`);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      buzz(AUTO_PAINT_BUZZ);
      onMark?.();
    },
    toDataURL: () => canvas.toDataURL("image/jpeg", 0.85),
  };
}

const TASK_RENDER = {
  breath(body, at) {
    body.innerHTML = `
      <p class="stage-tip">按住泡泡慢慢吸气，等它涨到最大、听到“可以松开了”再松开。也可以按住空格键。</p>
      <div class="breath-wrap">
        <button class="breath-bubble" id="bubble" aria-describedby="breath-count">
          <span id="bubble-text">按住吸气</span>
        </button>
      </div>
      <p class="breath-count" id="breath-count">已完成 <strong>${at.rounds}</strong> / ${at.goal} 次深呼吸</p>
      <div class="breath-dots" aria-hidden="true">
        ${Array.from({ length: at.goal }, (_, i) => `<span class="${i < at.rounds ? "on" : ""}"></span>`).join("")}
      </div>`;

    const bubble = body.querySelector("#bubble");
    const text = body.querySelector("#bubble-text");
    const MIN_HOLD = 3000;
    let start = 0;
    let origin = null;
    let ticker = null;
    let later = null;
    let releaseCue = false;
    const reset = () => {
      bubble.classList.remove("inhale", "exhale");
      text.textContent = "按住吸气";
    };
    // 每一拍让泡泡边缘闪一下，听障用户和不能震动的手机也能"看见"节奏
    const pulse = (step) => {
      bubble.style.setProperty("--beat", (0.35 + step.p * 0.65).toFixed(2));
      bubble.classList.remove("beat");
      void bubble.offsetWidth;
      bubble.classList.add("beat");
    };
    const playRhythm = (phase, maxMs) => {
      Haptics?.rhythm(phase, pulse);
      if (!Haptics?.canVibrate && Haptics?.enabled) window.ArtMindAudio?.playTaps(Haptics.schedule(phase, maxMs));
    };

    const begin = (e) => {
      e?.preventDefault();
      if (start || at.rounds >= at.goal) return;
      origin = { x: e.clientX || 0, y: e.clientY || 0 };
      clearTimeout(later);
      start = Date.now();
      releaseCue = false;
      bubble.classList.remove("exhale");
      bubble.classList.add("inhale");
      text.textContent = "吸气… 1";
      buzz(15);
      playRhythm(INHALE_PHASE, 8000);
      ticker = setInterval(() => {
        const held = Date.now() - start;
        const s = Math.floor(held / 1000) + 1;
        if (held >= INHALE_MS) {
          text.textContent = "可以松开了";
          if (!releaseCue) {
            releaseCue = true;
            announce("可以松开了。", { vibrate: false });
          }
        } else {
          text.textContent = `吸气… ${s}`;
        }
      }, 250);
    };

    const finish = (e) => {
      if (!start) return;
      if (origin && e?.clientY != null) {
        const dy = e.clientY - origin.y;
        const dx = (e.clientX || 0) - origin.x;
        if (Math.abs(dy) > 42 && Math.abs(dy) > Math.abs(dx)) {
          start = 0;
          origin = null;
          clearInterval(ticker);
          Haptics?.stopRhythm();
          window.ArtMindAudio?.stopFx();
          return;
        }
      }
      const held = Date.now() - start;
      start = 0;
      clearInterval(ticker);
      Haptics?.stopRhythm();
      window.ArtMindAudio?.stopFx();
      bubble.classList.remove("inhale");
      bubble.classList.add("exhale");
      if (held < MIN_HOLD) {
        text.textContent = "再久一点点";
        buzz([30, 60, 30]);
        announce("吸气再久一点，等泡泡变大再松开。", { vibrate: false });
        later = setTimeout(reset, 1200);
        return;
      }
      at.rounds += 1;
      text.textContent = "慢慢呼气…";
      body.querySelector("#breath-count strong").textContent = at.rounds;
      body.querySelectorAll(".breath-dots span").forEach((d, i) => d.classList.toggle("on", i < at.rounds));
      playRhythm(EXHALE_PHASE, INHALE_MS);
      if (at.rounds >= at.goal) {
        later = setTimeout(() => completeTask(`你完成了 ${at.goal} 次深呼吸，心跳和呼吸都慢下来了。`), 2500);
      } else {
        announce(`慢慢呼气……第 ${at.rounds} 次完成。`, { vibrate: false });
        later = setTimeout(reset, 4000);
      }
    };

    bubble.addEventListener("touchstart", (event) => {
      if (event.cancelable) event.preventDefault();
      clearTextSelection();
    }, { passive: false });
    bubble.addEventListener("pointerdown", begin);
    ["pointerup", "pointerleave", "pointercancel"].forEach((type) => bubble.addEventListener(type, finish));
    bubble.addEventListener("contextmenu", (e) => e.preventDefault());
    bubble.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) begin(e);
    });
    bubble.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") finish();
    });
    onTaskCleanup(() => {
      clearInterval(ticker);
      clearTimeout(later);
    });
  },

  mood(body, at) {
    const m = MOODS.find((x) => x.id === at.mood);
    body.innerHTML = `
      <p class="stage-tip"><strong>第一步</strong>：选一种最像今天心情的颜色。</p>
      <div class="mood-swatches" role="group" aria-label="心情颜色">
        ${MOODS.map((x) => `
          <button class="mood-swatch ${at.mood === x.id ? "selected" : ""}" data-mood="${x.id}"
            aria-pressed="${at.mood === x.id}" style="--c:${x.color}">
            <span class="swatch-dot" aria-hidden="true"></span>${x.name}<small>${x.mood}</small>
          </button>`).join("")}
      </div>
      ${m ? `
        <p class="stage-tip"><strong>第二步</strong>：这种感觉有多强？然后用手指在画布上涂抹它。</p>
        <label class="med-volume">感觉强度
          <input type="range" id="mood-intensity" min="1" max="5" value="${at.intensity}" />
          <span id="mood-int-label">${at.intensity}</span>
        </label>
        <p class="haptic-hint">📳 ${m.name}的笔触手感：${Haptics?.colorProfile(m.color).feel}，强度越大震得越久。</p>
        <canvas class="paint-canvas" id="mood-canvas" role="img" aria-label="心情画布，当前颜色${m.name}"></canvas>
        <div class="med-actions">
          <button class="btn btn-ghost" id="mood-auto">✨ 让 AI 帮我铺色</button>
          <button class="btn btn-ghost" id="mood-clear">清空重画</button>
        </div>
        <div class="field" style="margin-top:14px">
          <label for="mood-word"><strong>第三步</strong>（可选）：用一个词形容现在的感觉</label>
          <input id="mood-word" maxlength="12" placeholder="例如：轻飘飘" value="${escapeHTML(at.word)}" />
        </div>
        <button class="btn btn-primary btn-block" id="mood-finish" ${at.strokes ? "" : "disabled"}>完成心情画</button>
      ` : ""}`;

    body.querySelectorAll("[data-mood]").forEach((b) =>
      b.addEventListener("click", () => {
        at.mood = b.dataset.mood;
        at.strokes = 0;
        const x = MOODS.find((y) => y.id === at.mood);
        sfx("tick");
        buzz(x.buzz);
        renderTaskStage(taskStage());
        announce(`你选择了${x.name}，代表${x.mood}。笔触手感是${Haptics?.colorProfile(x.color).feel}。现在可以在画布上涂抹，或者让 AI 帮你铺色。`, { vibrate: false });
      })
    );
    if (!m) return;

    const finishBtn = body.querySelector("#mood-finish");
    const paint = setupPaint(body.querySelector("#mood-canvas"), {
      bg: "#fdfbf7",
      color: () => m.color,
      size: () => 8 + at.intensity * 8,
      onMark: () => {
        at.strokes += 1;
        finishBtn.disabled = false;
      },
    });
    body.querySelector("#mood-intensity").addEventListener("input", (e) => {
      at.intensity = Number(e.target.value);
      body.querySelector("#mood-int-label").textContent = at.intensity;
      buzz(at.intensity * 14);
    });
    body.querySelector("#mood-auto").addEventListener("click", () => {
      paint.autoPaint([m.color, m.color, "#ffffff"]);
      announce(`AI 已经用${m.name}铺好了画面，你可以继续涂抹，或者直接完成。`, { vibrate: false });
    });
    body.querySelector("#mood-clear").addEventListener("click", () => {
      at.strokes = 0;
      renderTaskStage(taskStage());
    });
    body.querySelector("#mood-word").addEventListener("input", (e) => (at.word = e.target.value.trim()));
    finishBtn.addEventListener("click", () => {
      const level = ["一点点", "有一些", "比较", "很", "非常"][at.intensity - 1];
      completeTask(
        `今天的你${level}${m.mood}${at.word ? `，像"${at.word}"一样` : ""}。${m.reply}`,
        `<img class="task-result-img" src="${paint.toDataURL()}" alt="用${m.name}画的心情画" />`,
      );
    });
  },

  weather(body, at) {
    const steps = ["选天气", "找原因"];
    const w = WEATHERS.find((x) => x.id === at.weather);
    body.innerHTML = `
      <ol class="stepper">
        ${steps.map((s, i) => `<li class="${i === at.step ? "on" : i < at.step ? "past" : ""}"><span>${i + 1}</span>${s}</li>`).join("")}
      </ol>
      ${at.step === 0 ? `
        <p class="stage-tip">如果把今天的心情比作天气，它是什么样的？</p>
        <div class="weather-grid">
          ${WEATHERS.map((x) => `
            <button class="weather-card" data-weather="${x.id}">
              <span class="weather-icon" aria-hidden="true">${x.icon}</span>
              <strong>${x.label}</strong><small>${x.mood}</small>
            </button>`).join("")}
        </div>` : `
        <p class="stage-tip">${w.icon} ${w.label}——是什么让心里的天气变成这样的？</p>
        <div class="sound-picker">
          ${WEATHER_CAUSES.map((c) => `<button class="style-choice" data-cause="${c}">${c}</button>`).join("")}
        </div>
        <button class="btn btn-ghost" id="weather-prev">← 重新选天气</button>`}`;

    body.querySelectorAll("[data-weather]").forEach((b) =>
      b.addEventListener("click", () => {
        at.weather = b.dataset.weather;
        at.step = 1;
        const x = WEATHERS.find((y) => y.id === at.weather);
        sfx("tick");
        renderTaskStage(taskStage());
        announce(`${x.label}，${x.mood}。是什么让天气变成这样的？`, { vibrate: false });
      })
    );
    body.querySelector("#weather-prev")?.addEventListener("click", () => {
      at.step = 0;
      renderTaskStage(taskStage());
    });
    body.querySelectorAll("[data-cause]").forEach((b) =>
      b.addEventListener("click", () => {
        const cause = b.dataset.cause === "说不清" ? "原因暂时还说不清" : `主要和${b.dataset.cause}有关`;
        const care = w.care ? "如果这种感觉持续很久，记得告诉信任的大人或疗愈师。" : "";
        completeTask(
          "这是你的今日情绪天气预报，天气会变，心情也会慢慢变好。",
          `<div class="forecast-card">
            <span class="weather-icon" aria-hidden="true">${w.icon}</span>
            <div>
              <strong>今日情绪天气：${w.label}</strong>
              <p>${cause}。</p>
              <p>🌱 小建议：${w.tip}</p>
              ${care ? `<p>💛 ${care}</p>` : ""}
            </div>
          </div>`,
          `今天心里是${w.label}，${cause}。小建议：${w.tip}${care}`,
        );
      })
    );
  },

  melody(body, at) {
    const current = () => MELODIES.find((x) => x.id === at.melody);
    const bars = (mel) => mel.notes.map((n) => `<span style="height:${24 + n * 5}px;--c:${mel.color}"></span>`).join("");
    body.innerHTML = `
      <p class="stage-tip"><strong>第一步</strong>：选一段旋律听一听。听不到也没关系，下方的音符条会跟着旋律跳动。</p>
      <div class="sound-picker" role="group" aria-label="旋律">
        ${MELODIES.map((x) => `<button class="style-choice ${x.id === at.melody ? "selected" : ""}" data-melody="${x.id}" aria-pressed="${x.id === at.melody}">${x.label}</button>`).join("")}
      </div>
      <div class="melody-bars" id="melody-bars" aria-hidden="true">${bars(current())}</div>
      <button class="btn btn-ghost" id="melody-play">▶ 播放旋律</button>
      <p class="stage-tip" style="margin-top:16px"><strong>第二步</strong>：它像什么形状？选一个，或者直接在画布上画出来。</p>
      <div class="sound-picker" role="group" aria-label="旋律的形状">
        ${MELODY_SHAPES.map((s) => `<button class="style-choice ${at.shape === s ? "selected" : ""}" data-shape="${s}" aria-pressed="${at.shape === s}">${s}</button>`).join("")}
      </div>
      <p class="haptic-hint">📳 每种形状都有自己的震动：波浪起伏、山峰渐强、闪电急促……点一下就能感受。</p>
      <canvas class="paint-canvas" id="melody-canvas" role="img" aria-label="旋律画布"></canvas>
      <button class="btn btn-primary btn-block" id="melody-finish" style="margin-top:12px" disabled>完成旋律画</button>`;

    const finishBtn = body.querySelector("#melody-finish");
    const refresh = () => (finishBtn.disabled = !(at.listened && (at.shape || at.strokes)));
    refresh();
    const paint = setupPaint(body.querySelector("#melody-canvas"), {
      bg: "#10142e",
      color: () => current().color,
      size: () => 10,
      onMark: () => {
        at.strokes += 1;
        refresh();
      },
    });

    let timers = [];
    const clearTimers = () => {
      timers.forEach(clearTimeout);
      timers = [];
      body.querySelectorAll("#melody-bars span").forEach((s) => s.classList.remove("on"));
    };
    onTaskCleanup(clearTimers);

    body.querySelectorAll("[data-melody]").forEach((b) =>
      b.addEventListener("click", () => {
        at.melody = b.dataset.melody;
        clearTimers();
        body.querySelectorAll("[data-melody]").forEach((x) => {
          const on = x.dataset.melody === at.melody;
          x.classList.toggle("selected", on);
          x.setAttribute("aria-pressed", String(on));
        });
        body.querySelector("#melody-bars").innerHTML = bars(current());
      })
    );
    body.querySelector("#melody-play").addEventListener("click", () => {
      const mel = current();
      clearTimers();
      window.ArtMindAudio?.playNotes(mel.notes.map((n) => ({ f: 261.63 * 2 ** (n / 12), d: mel.dur })));
      const spans = body.querySelectorAll("#melody-bars span");
      mel.notes.forEach((n, i) => {
        timers.push(setTimeout(() => {
          spans.forEach((s, j) => s.classList.toggle("on", j === i));
          if (Haptics?.enabled && Haptics.canVibrate) navigator.vibrate(Math.max(15, Math.min(160, mel.dur * 600 - n * 6)));
        }, i * mel.dur * 1000));
      });
      timers.push(setTimeout(() => spans.forEach((s) => s.classList.remove("on")), mel.notes.length * mel.dur * 1000 + 300));
      at.listened = true;
      refresh();
    });
    body.querySelectorAll("[data-shape]").forEach((b) =>
      b.addEventListener("click", () => {
        at.shape = b.dataset.shape;
        body.querySelectorAll("[data-shape]").forEach((x) => {
          const on = x.dataset.shape === at.shape;
          x.classList.toggle("selected", on);
          x.setAttribute("aria-pressed", String(on));
        });
        buzz(SHAPE_BUZZ[at.shape]);
        if (!at.listened) announce("先播放一遍旋律，再完成任务哦。", { vibrate: false });
        refresh();
      })
    );
    finishBtn.addEventListener("click", () => {
      const mel = current();
      const shape = at.shape ? `想象成了"${stripIcon(at.shape)}"` : "画成了自己的线条";
      completeTask(
        `你把${stripIcon(mel.label)}的旋律${shape}。${mel.reply}`,
        at.strokes ? `<img class="task-result-img" src="${paint.toDataURL()}" alt="旋律的形状画" />` : "",
      );
    });
  },

  triptych(body, at) {
    const panel = TRIPTYCH[at.panel];
    const blind = state.role === "blind";
    body.innerHTML = `
      <div class="triptych-tabs" role="tablist" aria-label="三联画">
        ${TRIPTYCH.map((p, i) => `
          <button role="tab" class="style-choice ${i === at.panel ? "selected" : ""}" data-panel="${i}" aria-selected="${i === at.panel}">
            ${at.marks[i] ? "✅ " : ""}${i + 1}. ${p.label}
          </button>`).join("")}
      </div>
      <p class="stage-tip">${panel.tip}</p>
      <span class="field-label">颜色</span>
      <div class="color-row" role="group" aria-label="颜色">
        ${panel.colors.map(({ c, n }) => `
          <button class="color-dot ${at.mode === "brush" && at.color === c ? "selected" : ""}" data-color="${c}" style="--c:${c}"
            aria-label="画笔颜色：${n}" aria-pressed="${at.mode === "brush" && at.color === c}"></button>`).join("")}
      </div>
      <span class="field-label">${blind ? "贴纸（点一下就会贴到画面上）" : "贴纸（选好后点画布放上去）"}</span>
      <div class="color-row" role="group" aria-label="贴纸">
        ${STAMPS.map((s) => `
          <button class="stamp-btn ${at.mode === "stamp" && at.stamp === s.icon ? "selected" : ""}" data-stamp="${s.icon}"
            aria-label="贴纸：${s.name}">${s.icon}</button>`).join("")}
      </div>
      <p class="haptic-hint">📳 ${at.mode === "stamp"
        ? `贴纸"${STAMPS.find((s) => s.icon === at.stamp)?.name}"放上去时会有专属震动。`
        : `当前颜色手感：${Haptics?.colorProfile(at.color).feel}。`}</p>
      <canvas class="paint-canvas" id="tri-canvas" role="img" aria-label="${panel.label}画布"></canvas>
      <div class="med-actions">
        <button class="btn btn-ghost" id="tri-auto">✨ AI 帮我铺底色</button>
        <button class="btn btn-ghost" id="tri-next">${at.panel < 2 ? `下一幅：${TRIPTYCH[at.panel + 1].label} →` : "← 回到清晨"}</button>
        <button class="btn btn-primary" id="tri-finish" ${at.marks.every(Boolean) ? "" : "disabled"}>完成三联画</button>
      </div>`;

    const paint = setupPaint(body.querySelector("#tri-canvas"), {
      bg: panel.bg,
      color: () => at.color,
      size: () => 14,
      mode: () => at.mode,
      stamp: () => at.stamp,
      stampBuzz: () => STAMPS.find((s) => s.icon === at.stamp)?.buzz,
      restore: at.images[at.panel],
      onMark: () => {
        const first = !at.marks[at.panel];
        at.marks[at.panel] += 1;
        at.images[at.panel] = paint.toDataURL();
        if (first) {
          body.querySelector(`[data-panel="${at.panel}"]`).textContent = `✅ ${at.panel + 1}. ${panel.label}`;
          body.querySelector("#tri-finish").disabled = !at.marks.every(Boolean);
          sfx("good");
        }
      },
    });

    const goPanel = (i) => {
      at.panel = i;
      at.color = TRIPTYCH[i].colors[0].c;
      at.mode = "brush";
      buzz(Array.from({ length: i * 2 + 1 }, (_, k) => (k % 2 ? 80 : 40)));
      renderTaskStage(taskStage());
      announce(`第 ${i + 1} 幅：${TRIPTYCH[i].label}。${TRIPTYCH[i].tip}`, { vibrate: false });
    };
    body.querySelectorAll("[data-panel]").forEach((b) => b.addEventListener("click", () => goPanel(Number(b.dataset.panel))));
    body.querySelector("#tri-next").addEventListener("click", () => goPanel((at.panel + 1) % 3));
    body.querySelectorAll("[data-color]").forEach((b) =>
      b.addEventListener("click", () => {
        at.color = b.dataset.color;
        at.mode = "brush";
        const feel = Haptics?.colorProfile(at.color);
        buzz(feel?.tap);
        renderTaskStage(taskStage());
        announce(`${b.getAttribute("aria-label").replace("画笔颜色：", "")}，手感${feel?.feel}。`, { vibrate: false });
      })
    );
    body.querySelectorAll("[data-stamp]").forEach((b) =>
      b.addEventListener("click", () => {
        at.stamp = b.dataset.stamp;
        const name = STAMPS.find((s) => s.icon === at.stamp)?.name;
        if (blind) {
          paint.stampRandom();
          announce(`已在${panel.label}的画面上贴了一个${name}。`, { vibrate: false });
          return;
        }
        at.mode = "stamp";
        buzz(STAMPS.find((s) => s.icon === at.stamp)?.buzz);
        body.querySelectorAll("[data-stamp]").forEach((x) => x.classList.toggle("selected", x === b));
        body.querySelectorAll("[data-color]").forEach((x) => x.classList.remove("selected"));
        body.querySelector(".haptic-hint").textContent = `📳 贴纸"${name}"放上去时会有专属震动。`;
      })
    );
    body.querySelector("#tri-auto").addEventListener("click", () => {
      paint.autoPaint(panel.colors.map((x) => x.c));
      announce(`AI 已经为${panel.label}铺好了底色。`, { vibrate: false });
    });
    body.querySelector("#tri-finish").addEventListener("click", async () => {
      const composite = await composeTriptych(at.images);
      completeTask(
        "你用三幅画记录了一天里光线和心情的变化：清晨的柔和、正午的明亮、夜晚的安静。",
        `<img class="task-result-img" src="${composite}" alt="三联画：清晨、正午、夜晚" />
         <a class="btn btn-ghost" href="${composite}" download="心绘-三联画.jpg">⬇ 保存三联画</a>`,
      );
    });
  },
};

async function composeTriptych(images) {
  const pw = 480, ph = 360, gap = 16, label = 44;
  const canvas = document.createElement("canvas");
  canvas.width = pw * 3 + gap * 4;
  canvas.height = ph + gap * 2 + label;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f6f1e7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const loaded = await Promise.all(
    images.map((src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    }))
  );
  ctx.font = '600 22px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = "center";
  loaded.forEach((img, i) => {
    const x = gap + i * (pw + gap);
    if (img) ctx.drawImage(img, x, gap, pw, ph);
    ctx.fillStyle = "#3a3550";
    ctx.fillText(TRIPTYCH[i].label, x + pw / 2, gap + ph + 30);
  });
  return canvas.toDataURL("image/jpeg", 0.88);
}

/* ---------------- 模块三：欣赏与冥想 ---------------- */
const MEDITATION_SOUNDS = [
  { id: "ocean", label: "🌊 海浪" },
  { id: "rain", label: "🌧️ 雨声" },
  { id: "forest", label: "🌲 森林" },
  { id: "white", label: "☁️ 白噪音" },
  { id: "none", label: "🔇 无背景音" },
];
const MEDITATION_CUES = [
  "慢慢吸气，数到四……再缓缓地呼气。",
  "感受肩膀放松下来，身体轻轻地沉进椅子里。",
  "如果走神了也没关系，温柔地把注意力带回呼吸。",
  "想象一种你喜欢的颜色，随着每一次呼吸慢慢铺开。",
  "听一听身边的声音，让它像海浪一样来了又走。",
  "继续保持平稳的呼吸，你做得很好。",
];
const CUE_EVERY_SEC = 40;
let meditationTimer = null;

function formatClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function startMeditation(m) {
  stopMeditation({ silent: true });
  state.meditation = { id: m.id, sound: m.sound || "ocean", remaining: m.minutes * 60, elapsed: 0, paused: false };
  window.ArtMindAudio?.setNoiseVolume(state.meditationVolume / 100);
  window.ArtMindAudio?.startNoise(state.meditation.sound);
  meditationTimer = setInterval(tickMeditation, 1000);
  renderGallery();
  announce(`开始冥想：${m.title}。请找到一个舒适的姿势，跟随引导，慢慢地深呼吸。`, { vibrate: true });
}

function tickMeditation() {
  const med = state.meditation;
  if (!med || med.paused) return;
  med.remaining -= 1;
  med.elapsed += 1;
  const clock = document.getElementById("med-time");
  if (clock) clock.textContent = formatClock(med.remaining);
  if (med.remaining <= 0) {
    stopMeditation();
    return;
  }
  if (med.elapsed % CUE_EVERY_SEC === 0) {
    const m = D.meditations.find((x) => x.id === med.id);
    const cues = m?.cues?.length ? m.cues : MEDITATION_CUES;
    const cue = cues[(med.elapsed / CUE_EVERY_SEC - 1) % cues.length];
    announce(cue, { vibrate: state.role === "deaf" });
  }
}

function toggleMeditationPause() {
  const med = state.meditation;
  if (!med) return;
  med.paused = !med.paused;
  if (med.paused) {
    window.ArtMindAudio?.pauseNoise();
    window.ArtMindAudio?.stopSpeech();
  } else {
    window.ArtMindAudio?.startNoise(med.sound);
  }
  renderGallery();
  if (!med.paused) announce("继续冥想。", { vibrate: false });
}

function stopMeditation({ silent = false } = {}) {
  clearInterval(meditationTimer);
  meditationTimer = null;
  const wasActive = !!state.meditation;
  state.meditation = null;
  window.ArtMindAudio?.stopNoise();
  if (state.view === "gallery") renderGallery();
  if (wasActive && !silent) announce("冥想结束。慢慢睁开眼睛，感受此刻的平静。");
}

function renderMeditationPlayer() {
  const med = state.meditation;
  if (!med) return "";
  const m = D.meditations.find((x) => x.id === med.id);
  const iosVolume = window.ArtMindAudio?.isIOS;
  return `
    <section class="card med-player ${med.paused ? "paused" : ""}" aria-labelledby="med-player-title">
      <div class="breath-orb" aria-hidden="true"><span>跟随光圈呼吸</span></div>
      <div class="med-player-body">
        <h3 id="med-player-title">正在冥想：${escapeHTML(m?.title || "")}</h3>
        <p class="med-time"><span class="sr-only">剩余时间</span><span id="med-time">${formatClock(med.remaining)}</span></p>
        <span class="field-label" id="sound-label">背景声音</span>
        <div class="sound-picker" role="group" aria-labelledby="sound-label">
          ${MEDITATION_SOUNDS.map((s) => `
            <button type="button" class="style-choice ${med.sound === s.id ? "selected" : ""}"
              data-sound="${s.id}" aria-pressed="${med.sound === s.id}">${s.label}</button>
          `).join("")}
        </div>
        ${iosVolume
          ? `<p class="service-note">iPhone 请用侧边音量键调节背景音大小。</p>`
          : `<label class="med-volume">背景音量
              <input type="range" id="med-volume" min="0" max="100" value="${state.meditationVolume}" />
            </label>`}
        <div class="med-actions">
          <button class="btn btn-ghost" id="med-pause">${med.paused ? "▶ 继续" : "⏸ 暂停"}</button>
          <button class="btn btn-primary" id="med-stop">■ 结束冥想</button>
        </div>
      </div>
    </section>
  `;
}

const ART_PAGE_SIZE = 4;
const MED_PAGE_SIZE = 3;
const MED_TYPE_LABEL = { blind: "纯语音沉浸", deaf: "动态视觉引导", all: "通用放松" };

function availableMeditations() {
  if (state.role === "blind") return D.meditations.filter((m) => m.forRole === "blind" || m.forRole === "all");
  if (state.role === "deaf") return D.meditations.filter((m) => m.forRole === "deaf" || m.forRole === "all");
  return D.meditations;
}

function pageOf(list, batch, size) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const start = (batch % pages) * size;
  return { items: list.slice(start, start + size), page: (batch % pages) + 1, pages };
}

function renderGallery() {
  if (isMobileShell()) {
    if (!state.meditation) {
      renderGalleryRoom();
      return;
    }
    renderGalleryFocus();
    return;
  }
  renderGalleryLegacy();
  function renderGalleryLegacy() {
  const el = document.getElementById("view-gallery");
  const arts = pageOf(D.artworks, state.artBatch, ART_PAGE_SIZE);
  const meds = pageOf(availableMeditations(), state.medBatch, MED_PAGE_SIZE);

  el.innerHTML = `
    <div class="view-head">
      <h1>无障碍艺术欣赏 + AI 冥想引导</h1>
      <p>AI 为每幅作品提供情感、色彩、构图的深度解读；冥想课程按人群适配。</p>
    </div>

    <div class="section-head">
      <h2>AI 智能艺术导览</h2>
      <button class="btn btn-ghost btn-shuffle" id="art-shuffle" aria-label="换一批作品，当前第 ${arts.page} 批，共 ${arts.pages} 批">
        🔄 换一批 <span class="batch-count">${arts.page}/${arts.pages}</span>
      </button>
    </div>
    <div class="grid grid-2">
      ${arts.items
        .map(
          (a) => `
        <article class="card art-guide-card ${a.pro && !isPro() ? "locked" : ""}">
          ${a.pro && !isPro() ? '<span class="lock-pill">PRO 深度</span>' : ""}
          <img class="art-guide-img" src="${a.image}" alt="${escapeHTML(a.alt || a.title)}" loading="lazy" />
          <h3 style="margin-top:12px">${a.title}</h3>
          <p>作者：${a.author}</p>
          <button class="btn btn-primary" data-art="${a.id}">🔊 AI 语音解读</button>
        </article>`
        )
        .join("")}
    </div>

    <div class="section-head" style="margin-top:22px">
      <h2>分人群冥想引导</h2>
      <button class="btn btn-ghost btn-shuffle" id="med-shuffle" aria-label="换一批冥想课程，当前第 ${meds.page} 批，共 ${meds.pages} 批">
        🔄 换一批 <span class="batch-count">${meds.page}/${meds.pages}</span>
      </button>
    </div>
    ${renderMeditationPlayer()}
    <div class="grid grid-3">
      ${meds.items
        .map(
          (m) => `
        <article class="card med-card ${m.pro && !isPro() ? "locked" : ""}">
          ${m.pro && !isPro() ? '<span class="lock-pill">PRO</span>' : ""}
          <h3>${m.title}</h3>
          <p class="med-meta">${MED_TYPE_LABEL[m.forRole] || ""} · ${m.minutes} 分钟 · ${MEDITATION_SOUNDS.find((s) => s.id === m.sound)?.label || ""}</p>
          ${m.desc ? `<p class="med-desc">${escapeHTML(m.desc)}</p>` : ""}
          <button class="btn btn-ghost btn-block" data-med="${m.id}">${state.meditation?.id === m.id ? "↻ 重新开始" : "▶ 开始冥想"}</button>
        </article>`
        )
        .join("")}
    </div>
  `;

  el.querySelector("#art-shuffle").addEventListener("click", () => {
    state.artBatch += 1;
    renderGallery();
    const next = pageOf(D.artworks, state.artBatch, ART_PAGE_SIZE);
    announce(`已换一批作品：${next.items.map((a) => a.title).join("、")}。`, { vibrate: false });
    document.getElementById("art-shuffle")?.focus();
  });
  el.querySelector("#med-shuffle").addEventListener("click", () => {
    state.medBatch += 1;
    renderGallery();
    const next = pageOf(availableMeditations(), state.medBatch, MED_PAGE_SIZE);
    announce(`已换一批冥想课程：${next.items.map((m) => m.title).join("、")}。`, { vibrate: false });
    document.getElementById("med-shuffle")?.focus();
  });

  el.querySelectorAll("[data-art]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = D.artworks.find((x) => x.id === b.dataset.art);
      if (a.pro && !requirePro("深度艺术导览为会员专享。")) return;
      announce(`${a.title}。画面：${a.alt}色彩以${a.palette.join("、")}为主。构图：${a.composition}。整体情感：${a.emotion}。`);
    })
  );

  el.querySelectorAll("[data-med]").forEach((b) =>
    b.addEventListener("click", () => {
      const m = D.meditations.find((x) => x.id === b.dataset.med);
      if (m.pro && !requirePro("该冥想课程为会员专享。")) return;
      startMeditation(m);
    })
  );

  el.querySelectorAll("[data-sound]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!state.meditation) return;
      state.meditation.sound = b.dataset.sound;
      if (!state.meditation.paused) window.ArtMindAudio?.startNoise(b.dataset.sound);
      renderGallery();
      announce(`背景声音已切换为${b.textContent.replace(/^\S+\s/, "")}。`, { vibrate: false });
    })
  );
  el.querySelector("#med-volume")?.addEventListener("input", (e) => {
    state.meditationVolume = Number(e.target.value);
    window.ArtMindAudio?.setNoiseVolume(state.meditationVolume / 100);
  });
  el.querySelector("#med-pause")?.addEventListener("click", toggleMeditationPause);
  el.querySelector("#med-stop")?.addEventListener("click", () => stopMeditation());
  }
}

/* ---------------- 模块四：安全社区 ---------------- */
function renderCommunity() {
  if (isMobileShell()) {
    renderCommunityRoom();
    return;
  }
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
  if (isMobileShell()) {
    renderSubscribeRoom();
    return;
  }
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
  document.body.dataset.role = role;
  announce(`已切换到${labels[role]}视角。${role === "blind" ? "语音会在每次进入新页面时说明你在哪、下一步做什么。" : role === "deaf" ? "语音已关闭，字幕会显示同样的引导。" : "需要时可以点再听一遍。"}`);
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
      try {
        const feed = await API.feed();
        if (Array.isArray(feed) && feed.length) state.posts = feed;
      } catch {}
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

  document.getElementById("paywall-go").addEventListener("click", closePaywall);
  document.getElementById("paywall-close").addEventListener("click", closePaywall);
  document.getElementById("btn-replay")?.addEventListener("click", () => orient(state.view));
  document.body.dataset.role = state.role;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("paywall").hidden) closePaywall();
  });
  if (!isMobileShell()) {
    await bootstrapBackend();
    switchDesktopView("studio");
    return;
  }
  blockMobileSelection();
  window.ArtMindVoid?.start();
  window.ArtMindVoid?.setRoom("studio");
  const deck = document.getElementById("main");
  if (deck) {
    deck.style.scrollBehavior = "auto";
    deck.scrollLeft = deck.clientWidth || window.innerWidth;
    deck.style.scrollBehavior = "";
  }
  bindDeck();
  bindVerticalCycle(document.getElementById("view-tasks"), (delta) => {
    if (state.view !== "tasks") return;
    stepTask(delta);
  });
  bindVerticalCycle(document.getElementById("view-gallery"), (delta) => {
    if (state.view !== "gallery") return;
    stepArt(delta);
  });

  if (window.ArtMindAudio?.isMobile && !window.ArtMindAudio.unlocked) {
    setCaption("手机上请先轻触一下屏幕，语音和背景音才能播放。");
  }

  await bootstrapBackend();
  ROOMS.forEach((view) => renderView(view));
  syncClones();
  if (deck) {
    deck.style.scrollBehavior = "auto";
    deck.scrollLeft = deck.clientWidth;
    deck.style.scrollBehavior = "";
  }
  state.view = "studio";
  updateRoomChrome();
  orient("studio");
}

document.addEventListener("DOMContentLoaded", init);
