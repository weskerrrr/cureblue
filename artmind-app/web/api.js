/* ============================================================
   心绘 ArtMind — 前端 API 客户端
   连接 Cloudflare Pages Functions（/api/*）+ D1。
   设计为「渐进增强」：
     · 若后端可用（探测 /api/me 成功）→ 使用服务端权威的额度/审核/订阅/社区；
     · 若后端不可用（纯静态托管或本地 file://）→ ready=false，
       app.js 自动回退到内置的客户端演示逻辑，保证功能永不中断。
   ============================================================ */
window.ArtMindAPI = (() => {
  const UID_KEY = "artmind_uid";
  let userId = localStorage.getItem(UID_KEY);
  if (!userId) {
    userId = (crypto.randomUUID ? crypto.randomUUID() : "u" + Date.now() + Math.random().toString(16).slice(2));
    localStorage.setItem(UID_KEY, userId);
  }

  let ready = false;
  let role = "blind_teen";

  // 前端角色名 → 后端角色名
  const ROLE_MAP = { blind: "blind_teen", deaf: "deaf_teen", therapist: "therapist", parent: "parent" };

  function headers() {
    return { "Content-Type": "application/json", "X-User-Id": userId, "X-User-Role": role };
  }

  async function req(path, method = "GET", body) {
    const res = await fetch(path, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  return {
    get ready() { return ready; },
    get userId() { return userId; },

    setRole(frontendRole) { role = ROLE_MAP[frontendRole] || "blind_teen"; },

    // 探测后端是否可用；成功则返回权益/额度
    async init(frontendRole) {
      this.setRole(frontendRole);
      try {
        const { status, data } = await req("/api/me");
        ready = status === 200 && data.ok === true;
        return ready ? data : null;
      } catch {
        ready = false;
        return null;
      }
    },

    async me() {
      const { data } = await req("/api/me");
      return data;
    },

    // 返回 { ok, result, aiQuotaLeft } 或 { ok:false, code }
    async ai(capability, prompt, options = {}) {
      const { data } = await req("/api/ai", "POST", { capability, prompt, options });
      return data;
    },

    async moderate(text) {
      const { data } = await req("/api/moderate", "POST", { text });
      return data;
    },

    async feed() {
      const { data } = await req("/api/feed");
      return data.posts || [];
    },

    async subscribe(planId, guardianApproved) {
      const { data } = await req("/api/subscribe", "POST", { planId, guardianApproved });
      return data;
    },
  };
})();
