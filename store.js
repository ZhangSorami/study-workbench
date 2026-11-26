/* 筑计划 · 数据层 */
const Store = (() => {
  const KEY = "zhujihua_v2";
  const BACKUP_KEY = "zhujihua_backups_v2";

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => fmtDate(new Date());
  const addDays = (d, n) => {
    const x = new Date(d + "T00:00:00");
    x.setDate(x.getDate() + n);
    return fmtDate(x);
  };

  const TEMPLATES = [
    {
      id: "tpl-final",
      name: "期末复习",
      goal: "系统梳理本学期重点，查漏补缺，稳住分数。",
      cycle: "custom",
      tasks: [
        { title: "整理各科笔记与考点清单", tag: "综合", priority: "high", estimate: 120 },
        { title: "按科目刷真题/模拟卷", tag: "刷题", priority: "high", estimate: 180 },
        { title: "错题回顾与薄弱点攻坚", tag: "复盘", priority: "mid", estimate: 90 },
        { title: "考前突击记忆与默写", tag: "记忆", priority: "mid", estimate: 60 },
      ],
    },
    {
      id: "tpl-cet",
      name: "四六级冲刺",
      goal: "听力、阅读、写作均衡提升，完成套题训练。",
      cycle: "month",
      tasks: [
        { title: "每日听力精听 30 分钟", tag: "英语", priority: "high", estimate: 30, repeat: "daily" },
        { title: "阅读两篇精读", tag: "英语", priority: "high", estimate: 45, repeat: "daily" },
        { title: "每周一套真题", tag: "英语", priority: "mid", estimate: 120, repeat: "weekly" },
        { title: "写作模板与范文积累", tag: "英语", priority: "mid", estimate: 40 },
      ],
    },
    {
      id: "tpl-kaoyan",
      name: "考研备考",
      goal: "按科目推进基础→强化→冲刺三阶段。",
      cycle: "custom",
      tasks: [
        { title: "数学基础巩固", tag: "数学", priority: "high", estimate: 120 },
        { title: "专业课框架梳理", tag: "专业课", priority: "high", estimate: 90 },
        { title: "英语阅读与单词", tag: "英语", priority: "mid", estimate: 60, repeat: "daily" },
        { title: "政治选择题练习", tag: "政治", priority: "low", estimate: 40 },
      ],
    },
    {
      id: "tpl-daily",
      name: "日常课业",
      goal: "跟上课程节奏，完成作业与预习复习。",
      cycle: "week",
      tasks: [
        { title: "完成今日作业", tag: "作业", priority: "high", estimate: 90, repeat: "daily" },
        { title: "预习明天课程", tag: "预习", priority: "mid", estimate: 40, repeat: "daily" },
        { title: "周末章节复习", tag: "复习", priority: "mid", estimate: 120, repeat: "weekly" },
      ],
    },
    {
      id: "tpl-sprint",
      name: "考前突击",
      goal: "短周期高强度突破重点与易错点。",
      cycle: "day",
      tasks: [
        { title: "核心公式/概念速记", tag: "记忆", priority: "high", estimate: 45 },
        { title: "高频题型限时训练", tag: "刷题", priority: "high", estimate: 90 },
        { title: "错题回炉", tag: "复盘", priority: "mid", estimate: 40 },
      ],
    },
  ];

  const DEFAULT_QUOTES = [
    "一点点推进，也是在靠近目标。",
    "今天的专注，是明天的从容。",
    "先完成，再完美。",
    "学习不是靠爆发，是靠持续。",
    "把难的拆小，把小的做完。",
  ];

  function blankTask(partial = {}) {
    const due = partial.due || today();
    return {
      id: uid(),
      title: "",
      estimate: 30,
      actualMinutes: 0,
      priority: "mid",
      due,
      tag: "",
      difficulty: 2,
      status: "todo",
      quadrant: 2,
      urgent: false,
      important: true,
      repeat: "none",
      parentId: null,
      order: Date.now(),
      note: "",
      timeline: [],
      createdAt: new Date().toISOString(),
      ...partial,
    };
  }

  function seed() {
    const planId = uid();
    return {
      version: 2,
      theme: "light",
      activePlanId: planId,
      guided: false,
      quotes: [...DEFAULT_QUOTES],
      customTemplates: [],
      checkins: {},
      studyLog: {},
      plans: [
        {
          id: planId,
          name: "我的学习计划",
          goal: "",
          cycle: "week",
          start: today(),
          end: addDays(today(), 7),
          status: "active",
          createdAt: new Date().toISOString(),
          tasks: [],
        },
      ],
      reviews: [],
      questions: [],
      knowledge: [],
      mistakes: [],
    };
  }

  /* 一套可直接演示的示例数据（不改用户现有数据，主动点击才载入） */
  function sample() {
    const data = seed();
    const t = today();
    const P = (n) => addDays(t, n);
    const mk = (o) => blankTask(o);

    const plan1 = {
      id: uid(),
      name: "期末复习冲刺",
      goal: "两周内过完三门主课重点，真题正确率提到 80%。",
      cycle: "custom",
      start: P(-6),
      end: P(9),
      status: "active",
      createdAt: new Date().toISOString(),
      tasks: [],
    };
    const plan2 = {
      id: uid(),
      name: "英语四级冲刺",
      goal: "每天听力 + 阅读，考前完成 5 套真题。",
      cycle: "week",
      start: P(-3),
      end: P(25),
      status: "active",
      createdAt: new Date().toISOString(),
      tasks: [],
    };
    const plan3 = {
      id: uid(),
      name: "上学期日常课业（已归档）",
      goal: "跟课、交作业。",
      cycle: "week",
      start: P(-120),
      end: P(-60),
      status: "archived",
      createdAt: new Date().toISOString(),
      tasks: [mk({ title: "课程论文提交", tag: "专业课", status: "done", due: P(-70), estimate: 180, actualMinutes: 150 })],
    };

    const parent1 = mk({
      title: "整理《国际贸易实务》重点",
      tag: "专业课",
      priority: "high",
      estimate: 120,
      due: P(-2),
      status: "partial",
      quadrant: 1,
    });
    parent1.timeline = [{ type: "start", at: new Date(P(-3) + "T19:00:00").toISOString() }];
    const c11 = mk({
      title: "第 3–5 章笔记梳理",
      tag: "专业课",
      parentId: parent1.id,
      estimate: 50,
      due: P(-2),
      status: "done",
      actualMinutes: 55,
      quadrant: 1,
    });
    c11.timeline = [{ type: "done", at: new Date(P(-3) + "T21:10:00").toISOString(), note: "第 3 章公式较多，整理了对照表" }];
    const c12 = mk({
      title: "课后习题重做",
      tag: "专业课",
      parentId: parent1.id,
      estimate: 60,
      due: P(1),
      status: "doing",
      actualMinutes: 20,
      quadrant: 1,
    });

    plan1.tasks = [
      parent1,
      c11,
      c12,
      mk({ title: "高数真题第 1 套（限时）", tag: "数学", priority: "high", estimate: 120, due: t, status: "todo", quadrant: 1, difficulty: 3 }),
      mk({ title: "背 60 个四级核心词", tag: "英语", priority: "mid", estimate: 30, due: t, status: "done", actualMinutes: 35, quadrant: 2, repeat: "daily" }),
      mk({ title: "错题回炉：极限与导数", tag: "数学", priority: "mid", estimate: 60, due: P(2), status: "todo", quadrant: 3 }),
      mk({ title: "《大学英语》听力精听", tag: "英语", priority: "mid", estimate: 40, due: P(-4), status: "delayed", quadrant: 3 }),
      mk({ title: "整理政治课考点提纲", tag: "政治", priority: "low", estimate: 60, due: P(5), status: "todo", quadrant: 4 }),
      mk({ title: "统计学第 6 章课后题", tag: "统计", priority: "mid", estimate: 45, due: P(3), status: "todo", quadrant: 2 }),
    ];

    plan2.tasks = [
      mk({ title: "四级听力 Section A 精听", tag: "英语", priority: "high", estimate: 30, due: t, status: "done", actualMinutes: 32, quadrant: 1, repeat: "daily" }),
      mk({ title: "阅读真题 2 篇 + 复盘", tag: "英语", priority: "high", estimate: 45, due: t, status: "doing", actualMinutes: 15, quadrant: 1 }),
      mk({ title: "写作模板整理与仿写", tag: "英语", priority: "mid", estimate: 40, due: P(4), status: "todo", quadrant: 2 }),
      mk({ title: "整套真题模考", tag: "英语", priority: "high", estimate: 130, due: P(6), status: "todo", quadrant: 2, repeat: "weekly" }),
    ];

    data.plans = [plan1, plan2, plan3];
    data.activePlanId = plan1.id;

    data.studyLog = {};
    data.checkins = {};
    const log = [95, 140, 60, 180, 120, 0, 165, 210, 90, 150, 130, 75];
    log.forEach((m, i) => {
      const d = P(-11 + i);
      if (m) data.studyLog[d] = m;
      if (m > 0) data.checkins[d] = true;
    });
    data.checkins[t] = true;
    data.studyLog[t] = 82;

    data.reviews = [
      {
        id: uid(),
        type: "daily",
        date: P(-1),
        gain: "把《国际贸易实务》第 4 章的贸易术语对照表整理完了，FOB/CIF 的责任划分终于理清。",
        reason: "下午刷手机超时，真题没做完。",
        hard: "高数极限的等价无穷小替换还是不熟。",
        improve: "明天先做 45 分钟真题再看手机，手机放到另一个房间。",
        question: "等价无穷小在加减法里到底什么时候能用？",
        free: "小结：先做题，再回看教材，比反过来有效。",
        tags: ["专业课", "数学"],
      },
      {
        id: uid(),
        type: "weekly",
        date: P(-4),
        gain: "这周完成了 3 套听力、2 篇阅读精读，节奏比上周稳。",
        reason: "周三有课到晚上，任务顺延。",
        hard: "阅读长难句定位慢。",
        improve: "下周把阅读拆成每天 1 篇，降低单次压力。",
        question: "",
        free: "周复盘：把「大块任务」拆小是这周最有效的改变。",
        tags: ["英语", "复盘"],
      },
    ];

    data.questions = [
      { id: uid(), title: "等价无穷小在加减法里到底什么时候能用？", tag: "数学", status: "open", solution: "", sourceReviewId: data.reviews[0].id },
      { id: uid(), title: "CIF 与 CIP 的保险责任有什么区别？", tag: "专业课", status: "solved", solution: "CIF 只保到货物越过船舷的最低险别，CIP 覆盖全程且可约定更高险别。" },
      { id: uid(), title: "听力 Section C 总是漏关键词怎么办？", tag: "英语", status: "open", solution: "" },
    ];
    data.knowledge = [
      { id: uid(), title: "FOB / CFR / CIF 责任划分", tag: "专业课", content: "FOB：买方租船订舱、保费自付；CFR：卖方付运费；CIF：卖方付运费 + 最低险。" },
      { id: uid(), title: "等价无穷小常用替换", tag: "数学", content: "sinx~x、tanx~x、1-cosx~x²/2、ln(1+x)~x、e^x-1~x；加减法中需谨慎，先通分或泰勒展开。" },
      { id: uid(), title: "四级听力信号词", tag: "英语", content: "but / however / actually 后常出答案；数字、转折、因果处注意速记。" },
    ];
    data.mistakes = [
      {
        id: uid(),
        title: "极限题：sinx - x 直接用等价无穷小替换",
        tag: "数学",
        reason: "加减法中直接替换 sinx~x 得到 0，掩盖了低阶项。",
        thinking: "用泰勒展开：sinx = x - x³/6 + o(x³)，sinx - x ~ -x³/6。",
      },
      {
        id: uid(),
        title: "阅读题：把「推断题」当细节题做",
        tag: "英语",
        reason: "只在原文找同义替换，忽略了需要一步推理。",
        thinking: "先定位段落，再判断作者态度与言外之意，排除绝对化选项。",
      },
    ];

    data.guided = false;
    data.theme = "light";
    data.customTemplates = [];
    return data;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        const data = seed();
        save(data);
        return data;
      }
      return JSON.parse(raw);
    } catch {
      const data = seed();
      save(data);
      return data;
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function exportJSON(data) {
    return JSON.stringify(data, null, 2);
  }

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.plans)) throw new Error("无效数据文件");
    save(data);
    return data;
  }

  function clearAll() {
    localStorage.removeItem(KEY);
    return seed();
  }

  function getBackups() {
    try {
      return JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveBackups(list) {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, 14)));
  }

  function autoBackup(data) {
    const list = getBackups();
    const d = today();
    if (list.some((b) => b.date === d)) return list;
    list.unshift({ date: d, at: new Date().toISOString(), data: JSON.parse(JSON.stringify(data)) });
    saveBackups(list);
    return list;
  }

  function restoreBackup(date) {
    const b = getBackups().find((x) => x.date === date);
    if (!b) throw new Error("找不到该备份");
    save(b.data);
    return b.data;
  }

  return {
    KEY,
    TEMPLATES,
    DEFAULT_QUOTES,
    uid,
    today,
    addDays,
    blankTask,
    seed,
    sample,
    load,
    save,
    exportJSON,
    importJSON,
    clearAll,
    getBackups,
    autoBackup,
    restoreBackup,
  };
})();
