/* 演示数据（前端原型用，真实数据来自后端 API） */
window.ARTMIND_DATA = {
  // 疗愈任务：分层（入门/进阶/挑战），免费版仅开放 1 个入门
  tasks: [
    { id: "t1", level: "入门", title: "用一种颜色表达今天的心情", minutes: 5, pro: false, done: false },
    { id: "t2", level: "进阶", title: "为一段旋律画出它的形状", minutes: 12, pro: true, done: false },
    { id: "t3", level: "挑战", title: "创作系列三联画：清晨 / 正午 / 夜晚", minutes: 25, pro: true, done: false },
  ],

  // 进度报告（脱敏后的离散情绪标签与完成率）
  progress: {
    streakDays: 6,
    completionRate: 0.72,
    moodTrend: [2, 3, 3, 4, 3, 5, 4], // 1-5 离散情绪等级（已脱敏）
    note: "近一周情绪稳定上行，创作专注时长增加 18%。",
  },

  // 艺术欣赏作品
  artworks: [
    {
      id: "a1", title: "海与风的对话", author: "AI × 林同学",
      palette: ["深靛蓝", "雾青", "暖金"],
      emotion: "宁静中带着期待",
      composition: "横向三分构图，留白集中在右上，引导视线向远方",
      pro: false,
    },
    {
      id: "a2", title: "城市的脉搏", author: "AI × 周同学",
      palette: ["品红", "电光蓝", "炭黑"],
      emotion: "兴奋而紧张",
      composition: "放射状线条由中心向外，节奏强烈",
      pro: true,
    },
  ],

  // 冥想课程
  meditations: [
    { id: "m1", title: "海边晨光 · 纯语音沉浸", forRole: "blind", minutes: 8, pro: false },
    { id: "m2", title: "呼吸光圈 · 动态视觉旋律", forRole: "deaf", minutes: 10, pro: true },
    { id: "m3", title: "森林声景 · 深度放松", forRole: "blind", minutes: 20, pro: true },
  ],

  // 社区帖子（含已审核状态，演示审核算法的不同结果）
  posts: [
    { id: "p1", author: "小帆（视障）", text: "今天用语音画了一片海，AI 帮我配了海浪声，太治愈了！", status: "approved" },
    { id: "p2", author: "阿乐（听障）", text: "把我最喜欢的歌做成了流动的色块，分享给大家～", status: "approved", hasImage: true },
    { id: "p3", author: "匿名", text: "你们画得真差，根本看不懂这种垃圾", status: "blocked", reason: "欺凌/攻击性言论被拦截" },
    { id: "p4", author: "小雨", text: "最近真的好累，感觉撑不下去了……", status: "crisis", reason: "检测到情绪危机信号，已触发干预" },
  ],

  // 订阅方案
  plans: [
    {
      id: "free", name: "免费版", price: "¥0", period: "永久",
      featured: false,
      features: ["每日 3 次 AI 生成", "每日 1 个基础疗愈任务", "基础艺术赏析", "社区浏览", "云端存储 200MB"],
      cta: "当前方案",
    },
    {
      id: "monthly", name: "月度会员", price: "¥39", period: "/月",
      featured: true,
      features: ["无限 AI 高级创作", "全套分层疗愈课程", "1v1 线上疗愈师预约", "全套冥想课程", "云端存储 50GB", "私密家庭分享空间"],
      cta: "立即订阅",
    },
    {
      id: "yearly", name: "年度会员", price: "¥299", period: "/年",
      featured: false,
      features: ["月度会员全部权益", "约 5 折更划算", "优先疗愈师排期", "年度成长纪念册"],
      cta: "立即订阅",
    },
  ],
};
