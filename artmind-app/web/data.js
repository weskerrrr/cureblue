/* 演示数据（前端原型用，真实数据来自后端 API） */
window.ARTMIND_DATA = {
  // 疗愈任务：分层（入门/进阶/挑战），每个任务都是一个可操作的互动小练习；免费版开放入门任务
  tasks: [
    {
      id: "t1", kind: "breath", icon: "🫧", level: "入门", title: "呼吸泡泡", minutes: 3, pro: false, done: false,
      desc: "按住泡泡慢慢吸气，松开时缓缓呼气，完成 5 次深呼吸。",
    },
    {
      id: "t2", kind: "mood", icon: "🎨", level: "入门", title: "心情调色盘", minutes: 5, pro: false, done: false,
      desc: "选一种代表今天心情的颜色，用手指在画布上涂抹出来。",
    },
    {
      id: "t3", kind: "weather", icon: "🌦️", level: "入门", title: "情绪天气预报", minutes: 3, pro: false, done: false,
      desc: "把心情比作天气，三步生成一份属于你的今日情绪预报。",
    },
    {
      id: "t4", kind: "melody", icon: "🎵", level: "进阶", title: "为一段旋律画出它的形状", minutes: 12, pro: true, done: false,
      desc: "听（或看）一段旋律，用线条和形状把它画下来。",
    },
    {
      id: "t5", kind: "triptych", icon: "🖼️", level: "挑战", title: "创作系列三联画：清晨 / 正午 / 夜晚", minutes: 25, pro: true, done: false,
      desc: "用画笔和贴纸完成三幅画，记录一天中光线和心情的变化。",
    },
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
      image: "art/sea-wind.jpg",
      alt: "黎明的海面，深蓝的海水占据画面下方，青色的风痕划过天空，地平线上透出暖金色的光。",
      palette: ["深靛蓝", "雾青", "暖金"],
      emotion: "宁静中带着期待",
      composition: "横向三分构图，留白集中在右上，引导视线向远方",
      pro: false,
    },
    {
      id: "a2", title: "城市的脉搏", author: "AI × 周同学",
      image: "art/city-pulse.jpg",
      alt: "黑色背景上，品红与电光蓝的光束从中心一点向四周迸发，隐约可见城市楼群的剪影。",
      palette: ["品红", "电光蓝", "炭黑"],
      emotion: "兴奋而紧张",
      composition: "放射状线条由中心向外，节奏强烈",
      pro: true,
    },
    {
      id: "a3", title: "雨后的窗台", author: "AI × 陈同学",
      image: "art/rain-window.jpg",
      alt: "雨滴顺着玻璃滑落，窗台上放着一盆嫩绿的小植物，窗外是灰绿色的城市，云缝里透出银白的光。",
      palette: ["雾灰", "嫩绿", "银白"],
      emotion: "安静、被保护的感觉",
      composition: "植物位于左下角，窗框形成画中画，视线自然投向窗外的光",
      pro: false,
    },
    {
      id: "a4", title: "萤火森林", author: "AI × 王同学",
      image: "art/firefly-forest.jpg",
      alt: "夜晚幽深的绿色森林里飞满金色的萤火虫，一条小路蜿蜒着通向森林深处的微光。",
      palette: ["墨绿", "翡翠绿", "萤火金"],
      emotion: "神秘却温暖，带着一点点勇气",
      composition: "中心透视，小路从下方延伸到画面中央的光亮处",
      pro: false,
    },
    {
      id: "a5", title: "纸飞机的天空", author: "AI × 李同学",
      image: "art/paper-planes.jpg",
      alt: "用蜡笔画出的天空，一半是蜜桃粉一半是天蓝，许多白色纸飞机穿过棉花般的云朵，下方是一片绿色山坡。",
      palette: ["蜜桃粉", "天蓝", "草绿"],
      emotion: "轻快、充满希望",
      composition: "纸飞机呈斜线排列，从左下飞向右上，形成向上的动势",
      pro: false,
    },
    {
      id: "a6", title: "外婆的厨房", author: "AI × 赵同学",
      image: "art/grandma-kitchen.jpg",
      alt: "午后的老式厨房，灶台上的锅冒着热气，木桌上放着一碗饺子和一双筷子，橙色阳光从小窗照进来。",
      palette: ["琥珀橙", "暖棕", "砖红"],
      emotion: "怀念与安心",
      composition: "近景是饺子碗，远景是窗户的光，前后层次分明，像一段被放慢的回忆",
      pro: true,
    },
    {
      id: "a7", title: "星空下的鲸", author: "AI × 孙同学",
      image: "art/star-whale.jpg",
      alt: "一头巨大的鲸鱼在满是星星的夜空中游动，身后拖着星尘，下方是平静反光的大海。",
      palette: ["深海蓝", "银灰", "星光金"],
      emotion: "辽阔、自由、梦一般的平静",
      composition: "鲸鱼横贯画面中部，天空与海面上下呼应",
      pro: false,
    },
    {
      id: "a8", title: "雪地里的红围巾", author: "AI × 刘同学",
      image: "art/red-scarf.jpg",
      alt: "一望无际的白色雪原和灰白的天空，一个背影小小的人系着鲜红的围巾向前走，身后留下一串脚印。",
      palette: ["雪白", "雾灰", "正红"],
      emotion: "孤独中的坚定",
      composition: "大面积留白，红色是唯一的焦点，脚印把视线引向人物",
      pro: true,
    },
    {
      id: "a9", title: "向日葵的合唱", author: "AI × 吴同学",
      image: "art/sunflowers.jpg",
      alt: "一大片向日葵朝着太阳盛开，天空是旋转的钴蓝色笔触，金黄的太阳像漩涡一样发光。",
      palette: ["明黄", "橙金", "钴蓝"],
      emotion: "热烈、开心、充满能量",
      composition: "前景是几朵大向日葵，向后渐小排到地平线，天空的漩涡带来律动",
      pro: false,
    },
    {
      id: "a10", title: "情绪的形状", author: "AI × 郑同学",
      image: "art/emotion-shapes.jpg",
      alt: "米色纸上漂浮着圆形、三角形和波浪线，左边是冷静的蓝紫色，渐渐过渡到右边温暖的珊瑚红和金黄。",
      palette: ["钴蓝", "淡紫", "珊瑚红", "金黄"],
      emotion: "从低落慢慢转向温暖",
      composition: "左冷右暖的渐变，形状大小错落，像情绪在流动",
      pro: true,
    },
    {
      id: "a11", title: "灯塔守望", author: "AI × 黄同学",
      image: "art/lighthouse.jpg",
      alt: "黄昏时分，白色灯塔立在岩石悬崖上，暖黄的光束扫过深青色的海浪，天空是紫色和桃色的晚霞，几只海鸥飞过。",
      palette: ["深青", "暮紫", "桃橙", "灯光黄"],
      emotion: "安全感，被指引的感觉",
      composition: "灯塔位于右侧三分线，光束斜向穿过画面，与左侧落日对称",
      pro: false,
    },
    {
      id: "a12", title: "樱花校园小径", author: "AI × 何同学",
      image: "art/cherry-path.jpg",
      alt: "春天的校园小路两旁开满粉色樱花，花瓣在空中飘落，路边有一张空着的木长椅，远处是红砖教学楼。",
      palette: ["樱花粉", "嫩绿", "暖白"],
      emotion: "温柔、新的开始",
      composition: "小路呈 S 形通向远处的教学楼，长椅在右下角留出歇脚的位置",
      pro: true,
    },
  ],

  // 冥想课程。forRole: blind 纯语音 / deaf 视觉引导 / all 通用
  meditations: [
    {
      id: "m1", title: "海边晨光 · 纯语音沉浸", forRole: "blind", minutes: 8, pro: false, sound: "ocean",
      desc: "跟着海浪的节奏呼吸，想象清晨的阳光照在脸上。",
      cues: ["听，海浪涌上来……又退回去，跟着它吸气、呼气。", "感受清晨的阳光，暖暖地落在你的额头和脸颊上。", "脚下是柔软的细沙，每一次呼气，身体都更沉一点。", "海风轻轻吹过，把烦恼一点点带走。"],
    },
    {
      id: "m2", title: "呼吸光圈 · 动态视觉旋律", forRole: "deaf", minutes: 10, pro: true, sound: "rain",
      desc: "看着光圈慢慢变大、变小，让呼吸跟上它的节奏。",
      cues: ["光圈变大时吸气，变小时呼气。", "让目光柔和地停在光圈中心。", "如果走神了，就重新回到光圈的节奏。", "感受肩膀随着光圈一起放松。"],
    },
    {
      id: "m3", title: "森林声景 · 深度放松", forRole: "blind", minutes: 20, pro: true, sound: "forest",
      desc: "在鸟鸣和微风里，从头到脚做一次全身放松。",
      cues: ["听见远处的鸟叫了吗？让它陪你慢慢放松。", "先放松额头和眉毛，再放松下巴。", "让肩膀和手臂变得沉沉的、暖暖的。", "感受双脚踩在松软的落叶上，稳稳地扎根。", "微风穿过树叶，你的呼吸也像风一样轻。"],
    },
    {
      id: "m4", title: "雨声小屋 · 入睡前放松", forRole: "blind", minutes: 12, pro: false, sound: "rain",
      desc: "想象自己躺在温暖的小屋里，窗外下着细雨。",
      cues: ["窗外的雨滴答滴答，你在屋里很安全。", "盖上一条软软的毯子，让身体完全交给床。", "每听到一阵雨声，就慢慢呼出一口气。", "今天辛苦了，现在可以什么都不用想。"],
    },
    {
      id: "m5", title: "手心的温度 · 触觉专注", forRole: "blind", minutes: 6, pro: false, sound: "white",
      desc: "把双手搓热，感受掌心的温度，练习专注当下。",
      cues: ["把双手搓一搓，再轻轻覆盖在眼睛上。", "感受掌心的温度，慢慢传到脸上。", "把手放在胸口，感觉心跳和呼吸。", "手指一根一根地放松，从拇指到小指。"],
    },
    {
      id: "m6", title: "声音地图 · 聆听练习", forRole: "blind", minutes: 10, pro: true, sound: "forest",
      desc: "分辨身边远近不同的声音，在心里画一张声音地图。",
      cues: ["先找一找离你最近的声音。", "再听听远一点的地方，有什么声音？", "不评价它们，只是听见，然后放下。", "回到自己的呼吸，它是最近的声音。"],
    },
    {
      id: "m7", title: "流动色彩 · 情绪调色", forRole: "deaf", minutes: 8, pro: false, sound: "ocean",
      desc: "跟随屏幕上的文字和光圈，把心情想象成一种颜色。",
      cues: ["现在的心情是什么颜色？在心里给它涂上去。", "吸气时，让这种颜色变得更柔和。", "呼气时，想象颜色慢慢变成浅浅的蓝。", "看看光圈，它的颜色就是此刻的平静。"],
    },
    {
      id: "m8", title: "一片叶子 · 视觉专注", forRole: "deaf", minutes: 6, pro: false, sound: "forest",
      desc: "想象一片叶子在水面上漂，让念头像叶子一样漂走。",
      cues: ["想象一条小溪，水面上漂着一片叶子。", "有念头出现时，把它放在叶子上。", "看着叶子慢慢漂远，不用追。", "呼吸跟着光圈，平稳而缓慢。"],
    },
    {
      id: "m9", title: "数息练习 · 振动提示", forRole: "deaf", minutes: 5, pro: false, sound: "white",
      desc: "跟着字幕从一数到十，手机会在提示时轻轻振动。",
      cues: ["吸气……呼气……这是第一次。", "继续数，二、三、四，不着急。", "数乱了也没关系，从一重新开始。", "最后一次深呼吸，感受身体的安稳。"],
    },
    {
      id: "m10", title: "星空漫游 · 视觉想象", forRole: "deaf", minutes: 15, pro: true, sound: "white",
      desc: "想象自己漂浮在星空里，身体轻得像一片云。",
      cues: ["想象你轻轻地飘起来，离开地面。", "四周是安静的星星，一闪一闪。", "你很安全，星光托着你。", "慢慢回到地面，感受双脚的重量。"],
    },
    {
      id: "m11", title: "三分钟呼吸 · 课间小憩", forRole: "all", minutes: 3, pro: false, sound: "white",
      desc: "适合课间或考试前，三分钟让心跳慢下来。",
      cues: ["坐直一点，双脚平放在地上。", "吸气四秒，停一下，再呼气六秒。", "你已经准备好了，带着这份平静出发。"],
    },
    {
      id: "m12", title: "身体扫描 · 释放紧张", forRole: "all", minutes: 12, pro: false, sound: "ocean",
      desc: "从头顶到脚尖逐一放松，找到身体里紧绷的地方。",
      cues: ["注意头顶和额头，让它们松开。", "感受脖子和肩膀，有紧绷就让它慢慢化开。", "注意肚子随着呼吸起伏。", "最后来到双脚，感受它们稳稳地接住你。"],
    },
    {
      id: "m13", title: "感恩日记 · 温暖回顾", forRole: "all", minutes: 8, pro: true, sound: "rain",
      desc: "回想今天三件让你觉得温暖的小事。",
      cues: ["想一件今天让你微笑的小事。", "再想一个今天帮助过你的人。", "最后，谢谢今天努力的自己。"],
    },
    {
      id: "m14", title: "情绪急救 · 焦虑缓解", forRole: "all", minutes: 5, pro: false, sound: "rain",
      desc: "感到慌张时使用：说出五样看到的、四样摸到的东西。",
      cues: ["说出你能感觉到的五样东西。", "感受四种触感：衣服、椅子、地面、空气。", "慢慢呼气，比吸气更长一些。", "你已经比刚才好一点了，做得很好。"],
    },
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
