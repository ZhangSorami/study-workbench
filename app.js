/* 筑计划 · 主应用 */
(() => {
  let db = Store.load();
  Store.autoBackup(db);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const statusLabel = {
    todo: "未开始",
    doing: "进行中",
    done: "已完成",
    partial: "部分完成",
    delayed: "延期",
    abandoned: "放弃",
  };
  const planStatusLabel = {
    active: "进行中",
    done: "已完成",
    paused: "已暂停",
    archived: "已归档",
  };
  const priorityLabel = { high: "高", mid: "中", low: "低" };

  let selectedTaskId = null;
  let selectedReviewId = null;
  let charts = {};
  let sortablePlan = null;
  let matrixSortables = [];
  let pomo = {
    taskId: null,
    remain: 25 * 60,
    phase: "work",
    running: false,
    timer: null,
  };

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  function confirmModal(title, body, onOk) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = `<p>${body}</p>`;
    $("#modal-actions").innerHTML = "";
    const cancel = document.createElement("button");
    cancel.className = "btn ghost";
    cancel.textContent = "取消";
    cancel.onclick = () => $("#modal").classList.add("hidden");
    const ok = document.createElement("button");
    ok.className = "btn danger";
    ok.textContent = "确认";
    ok.onclick = () => {
      $("#modal").classList.add("hidden");
      onOk();
    };
    $("#modal-actions").append(cancel, ok);
    $("#modal").classList.remove("hidden");
  }

  function promptModal(title, fields, onOk) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = fields
      .map((f) => {
        if (f.type === "textarea") {
          return `<label class="field">${f.label}<textarea id="m-${f.name}" rows="3">${escapeHtml(f.value || "")}</textarea></label>`;
        }
        return `<label class="field">${f.label}<input id="m-${f.name}" value="${escapeHtml(f.value || "")}" ${
          f.type ? `type="${f.type}"` : ""
        }/></label>`;
      })
      .join("");
    $("#modal-actions").innerHTML = "";
    const cancel = document.createElement("button");
    cancel.className = "btn ghost";
    cancel.textContent = "取消";
    cancel.onclick = () => $("#modal").classList.add("hidden");
    const ok = document.createElement("button");
    ok.className = "btn primary";
    ok.textContent = "确定";
    ok.onclick = () => {
      const values = {};
      fields.forEach((f) => (values[f.name] = $(`#m-${f.name}`).value));
      $("#modal").classList.add("hidden");
      onOk(values);
    };
    $("#modal-actions").append(cancel, ok);
    $("#modal").classList.remove("hidden");
  }

  function persist() {
    Store.save(db);
  }

  function activePlan() {
    return db.plans.find((p) => p.id === db.activePlanId) || db.plans[0];
  }

  function allTasks(plan = activePlan()) {
    return plan ? plan.tasks || [] : [];
  }

  function flatVisibleTasks(plan = activePlan()) {
    if (!plan || plan.status === "archived") return [];
    return allTasks(plan);
  }

  function childrenOf(taskId, plan = activePlan()) {
    return allTasks(plan).filter((t) => t.parentId === taskId);
  }

  function rootTasks(plan = activePlan()) {
    return allTasks(plan)
      .filter((t) => !t.parentId)
      .sort((a, b) => a.order - b.order);
  }

  function parentProgress(task, plan = activePlan()) {
    const kids = childrenOf(task.id, plan);
    if (!kids.length) return task.status === "done" ? 100 : task.status === "partial" ? 50 : 0;
    const done = kids.filter((k) => k.status === "done").length;
    return Math.round((done / kids.length) * 100);
  }

  function syncParentStatus(plan) {
    rootTasks(plan).forEach((t) => {
      const kids = childrenOf(t.id, plan);
      if (!kids.length) return;
      const p = parentProgress(t, plan);
      if (p === 100) t.status = "done";
      else if (p > 0) t.status = "partial";
      else if (t.status === "done" || t.status === "partial") t.status = "doing";
    });
  }

  function isDueToday(task) {
    return task.due === Store.today();
  }

  function isOverdue(task) {
    return task.due < Store.today() && !["done", "abandoned"].includes(task.status);
  }

  function countdownText(due) {
    const a = new Date(Store.today() + "T00:00:00");
    const b = new Date(due + "T00:00:00");
    const diff = Math.round((b - a) / 86400000);
    if (diff < 0) return `已过期 ${-diff} 天`;
    if (diff === 0) return "今天到期";
    if (diff === 1) return "明天到期";
    return `剩余 ${diff} 天`;
  }

  function ensureRepeats() {
    const plan = activePlan();
    if (!plan || plan.status === "archived") return;
    const t0 = Store.today();
    const existingKeys = new Set(plan.tasks.map((t) => `${t.title}|${t.due}|${t.repeat}`));
    const bases = plan.tasks.filter((t) => t.repeat && t.repeat !== "none");
    bases.forEach((t) => {
      let next = null;
      if (t.repeat === "daily" && t.due < t0) next = t0;
      if (t.repeat === "weekly") {
        const due = new Date(t.due + "T00:00:00");
        const now = new Date(t0 + "T00:00:00");
        if (now >= due && now.getDay() === due.getDay() && t.due !== t0) next = t0;
      }
      if (t.repeat === "monthly") {
        const due = new Date(t.due + "T00:00:00");
        const now = new Date(t0 + "T00:00:00");
        if (now.getDate() === due.getDate() && t.due !== t0 && now >= due) next = t0;
      }
      if (next && !existingKeys.has(`${t.title}|${next}|${t.repeat}`)) {
        plan.tasks.push(
          Store.blankTask({
            title: t.title,
            estimate: t.estimate,
            priority: t.priority,
            due: next,
            tag: t.tag,
            difficulty: t.difficulty,
            quadrant: t.quadrant,
            urgent: t.urgent,
            important: t.important,
            repeat: t.repeat,
            parentId: null,
          })
        );
      }
    });
  }

  function addStudyMinutes(mins) {
    const d = Store.today();
    db.studyLog[d] = (db.studyLog[d] || 0) + mins;
  }

  function streakInfo() {
    let cur = 0;
    let d = Store.today();
    if (!db.checkins[d]) d = Store.addDays(d, -1);
    while (db.checkins[d]) {
      cur++;
      d = Store.addDays(d, -1);
    }
    const days = Object.keys(db.checkins).filter((k) => db.checkins[k]).sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    days.forEach((day) => {
      if (prev && Store.addDays(prev, 1) === day) run++;
      else run = 1;
      longest = Math.max(longest, run);
      prev = day;
    });
    return {
      current: cur,
      longest: Math.max(longest, cur),
      broken: !db.checkins[Store.today()],
      todayChecked: !!db.checkins[Store.today()],
    };
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", db.theme === "dark" ? "dark" : "light");
  }

  /* ---------- 渲染：导航/通用 ---------- */
  function switchView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
    $(`#view-${name}`).classList.add("active");
    $("#sidebar").classList.remove("open");
    if (name === "home") renderHome();
    if (name === "plans") renderPlans();
    if (name === "today") renderToday();
    if (name === "matrix") renderMatrix();
    if (name === "dashboard") renderDashboard();
    if (name === "review") renderReview();
    if (name === "notes") renderNotes();
    if (name === "settings") renderSettings();
  }

  function taskMetaHTML(t) {
    const due = t.due || "";
    return `
      <div class="meta">
        <span class="badge">${statusLabel[t.status] || t.status}</span>
        <span class="badge">${priorityLabel[t.priority] || t.priority}优先</span>
        ${t.tag ? `<span class="badge">${escapeHtml(t.tag)}</span>` : ""}
        <span>${due || "无截止"} · ${countdownText(due || Store.today())}</span>
        <span>预计 ${t.estimate || 0} 分 / 实际 ${t.actualMinutes || 0} 分</span>
      </div>`;
  }

  function renderTaskItem(t, opts = {}) {
    const overdue = isOverdue(t);
    const prog = parentProgress(t);
    return `<div class="task-item ${opts.child ? "child" : ""} ${overdue ? "overdue" : ""} ${
      selectedTaskId === t.id ? "active" : ""
    }" data-id="${t.id}">
      <input type="checkbox" class="batch-check" data-id="${t.id}" ${opts.checked ? "checked" : ""} onclick="event.stopPropagation()" />
      <div>
        <div class="title">${escapeHtml(t.title)}</div>
        ${taskMetaHTML(t)}
        ${!opts.child ? `<div class="progress-mini"><span style="width:${prog}%"></span></div>` : ""}
      </div>
      <div class="row gap">
        <button class="btn ghost" data-act="done" data-id="${t.id}">完成</button>
      </div>
    </div>`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    const plan = activePlan();
    const streak = streakInfo();
    const h = new Date().getHours();
    const greet = h < 5 ? "夜深了，注意休息" : h < 9 ? "早上好" : h < 12 ? "上午好" : h < 18 ? "下午好" : "晚上好";
    $("#home-greeting").textContent = `${greet}，${plan ? `「${plan.name}」` : ""}今天继续加油`;
    const quotes = db.quotes?.length ? db.quotes : Store.DEFAULT_QUOTES;
    $("#home-quote").textContent = quotes[Math.floor(Math.random() * quotes.length)];
    const ck = db.checkins[Store.today()];
    const ckTime = typeof ck === "string" ? new Date(ck) : null;
    const ckText = ckTime ? ` · 今日 ${String(ckTime.getHours()).padStart(2, "0")}:${String(ckTime.getMinutes()).padStart(2, "0")} 已签到` : "";
    $("#streak-pill").textContent = streak.broken
      ? `今日未签到 · 已连续 ${streak.current} 天 · 最长 ${streak.longest} 天`
      : `连续 ${streak.current} 天 · 最长 ${streak.longest} 天${ckText}`;
    if (streak.broken) $("#streak-pill").style.outline = "2px solid var(--danger)";
    else $("#streak-pill").style.outline = "";

    const tasks = flatVisibleTasks(plan);
    const todayTasks = tasks.filter((t) => isDueToday(t) || isOverdue(t));
    const done = tasks.filter((t) => t.status === "done").length;
    const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const todayMins = db.studyLog[Store.today()] || 0;

    $("#home-stats").innerHTML = `
      <div class="stat-card"><div class="label">今日任务</div><div class="value">${todayTasks.length}</div></div>
      <div class="stat-card"><div class="label">今日学习时长</div><div class="value">${todayMins} 分</div></div>
      <div class="stat-card"><div class="label">计划完成率</div><div class="value">${rate}%</div></div>`;

    $("#home-today-list").innerHTML = todayTasks.length
      ? todayTasks
          .sort((a, b) => (isOverdue(a) === isOverdue(b) ? 0 : isOverdue(a) ? -1 : 1))
          .slice(0, 6)
          .map((t) => renderTaskItem(t))
          .join("")
      : `<div class="empty-hint">今天暂无待办，去计划里添加或点「临时任务」</div>`;

    $("#home-plan-name").textContent = plan ? `${plan.name} · ${rate}%` : "暂无计划";
    drawRing("home-ring", rate);
    drawHours("home-bar", 7);
    bindTaskListClicks($("#home-today-list"));
  }

  /* ---------- 计划 ---------- */
  function fillTagList() {
    const tags = new Set();
    db.plans.forEach((p) => p.tasks.forEach((t) => t.tag && tags.add(t.tag)));
    $("#tag-list").innerHTML = [...tags].map((t) => `<option value="${escapeHtml(t)}"></option>`).join("");
    const opts = `<option value="">全部标签</option>` + [...tags].map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    ["#task-filter-tag", "#dash-tag", "#notes-tag-filter"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      const prev = el.value;
      el.innerHTML = opts;
      el.value = tags.has(prev) ? prev : "";
    });
  }

  function renderPlans() {
    ensureRepeats();
    persist();
    fillTagList();
    const sel = $("#plan-switcher");
    sel.innerHTML = db.plans
      .map((p) => `<option value="${p.id}" ${p.id === db.activePlanId ? "selected" : ""}>${escapeHtml(p.name)}（${planStatusLabel[p.status] || p.status}）</option>`)
      .join("");

    const plan = activePlan();
    if (!plan) {
      $("#plan-task-list").innerHTML = `<div class="empty-hint">还没有计划，先新建一个</div>`;
      return;
    }
    $("#current-plan-title").textContent = plan.name;
    $("#plan-name").value = plan.name;
    $("#plan-goal").value = plan.goal || "";
    $("#plan-cycle").value = plan.cycle || "custom";
    $("#plan-start").value = plan.start || "";
    $("#plan-end").value = plan.end || "";
    $("#plan-status").innerHTML = Object.entries(planStatusLabel)
      .map(([k, v]) => `<option value="${k}" ${plan.status === k ? "selected" : ""}>${v}</option>`)
      .join("");

    const tag = $("#task-filter-tag").value;
    const pri = $("#task-filter-priority").value;
    const st = $("#task-filter-status").value;
    const match = (t) =>
      (!tag || t.tag === tag) && (!pri || t.priority === pri) && (!st || t.status === st);

    syncParentStatus(plan);
    const html = [];
    rootTasks(plan)
      .filter(match)
      .forEach((t) => {
        html.push(renderTaskItem(t));
        childrenOf(t.id, plan)
          .filter(match)
          .sort((a, b) => a.order - b.order)
          .forEach((c) => html.push(renderTaskItem(c, { child: true })));
      });
    $("#plan-task-list").innerHTML = html.length ? html.join("") : `<div class="empty-hint">暂无任务</div>`;
    bindTaskListClicks($("#plan-task-list"));
    if (window.Sortable) {
      if (sortablePlan) sortablePlan.destroy();
      sortablePlan = Sortable.create($("#plan-task-list"), {
        animation: 150,
        draggable: ".task-item:not(.child)",
        onEnd: () => {
          const ids = $$("#plan-task-list .task-item:not(.child)").map((el) => el.dataset.id);
          ids.forEach((id, i) => {
            const t = plan.tasks.find((x) => x.id === id);
            if (t) t.order = i + 1;
          });
          persist();
          toast("已调整任务顺序");
        },
      });
    }
    renderTaskEditor();
    const archived = plan.status === "archived";
    $$("#task-form input, #task-form select, #task-form textarea").forEach((el) => (el.disabled = archived));
    ["#btn-add-task", "#btn-delete-task", "#btn-add-sub", "#btn-start-pomodoro"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = archived;
    });
    $("#plan-name").disabled = archived;
    $("#plan-goal").disabled = archived;
    $("#plan-cycle").disabled = archived;
    $("#plan-start").disabled = archived;
    $("#plan-end").disabled = archived;
  }

  function renderTaskEditor() {
    const plan = activePlan();
    const task = plan?.tasks.find((t) => t.id === selectedTaskId);
    if (!task) {
      $("#task-editor").classList.remove("hidden");
      $("#task-form").classList.add("hidden");
      return;
    }
    $("#task-editor").classList.add("hidden");
    $("#task-form").classList.remove("hidden");
    const f = $("#task-form");
    f.title.value = task.title;
    f.estimate.value = task.estimate || 0;
    f.priority.value = task.priority || "mid";
    f.due.value = task.due || "";
    f.tag.value = task.tag || "";
    f.difficulty.value = String(task.difficulty || 2);
    f.status.value = task.status || "todo";
    f.quadrant.value = String(task.quadrant || 2);
    f.repeat.value = task.repeat || "none";
    f.urgent.checked = !!task.urgent;
    f.important.checked = !!task.important;

    const tl = (task.timeline || []).slice(-8).reverse();
    $("#task-timeline").innerHTML = tl.length
      ? tl
          .map((x) => {
            const at = new Date(x.at);
            const time = Number.isNaN(at.getTime())
              ? x.at
              : `${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")} ${String(
                  at.getHours()
                ).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
            const label =
              x.type === "start" ? "开始专注" : x.type === "done" ? "标记完成" : `状态改为 ${statusLabel[x.status] || x.status}`;
            return `<div class="tl-row"><span class="muted">${time}</span> ${label}${
              x.note ? `<div class="muted">${escapeHtml(x.note)}</div>` : ""
            }</div>`;
          })
          .join("")
      : `<span class="muted">暂无记录，开始番茄钟或标记完成后自动记录</span>`;
  }

  /* ---------- 今日 ---------- */
  function renderToday() {
    const plan = activePlan();
    let list = flatVisibleTasks(plan).filter((t) => isDueToday(t) || isOverdue(t));
    list = [
      ...list.filter(isOverdue).sort((a, b) => a.due.localeCompare(b.due)),
      ...list.filter((t) => !isOverdue(t)),
    ];
    $("#today-list").innerHTML = list.length
      ? list.map((t) => renderTaskItem(t)).join("")
      : `<div class="empty-hint">今日无待办</div>`;
    bindTaskListClicks($("#today-list"));
  }

  function selectedBatchIds() {
    const active = $(".view.active");
    return $$(".batch-check:checked", active || document).map((el) => el.dataset.id);
  }

  /* ---------- 四象限 ---------- */
  function renderMatrix() {
    const plan = activePlan();
    [1, 2, 3, 4].forEach((q) => {
      const box = $(`.matrix-list[data-q="${q}"]`);
      const items = flatVisibleTasks(plan)
        .filter((t) => !t.parentId && Number(t.quadrant || 2) === q && t.status !== "abandoned")
        .sort((a, b) => a.order - b.order);
      box.innerHTML = items.map((t) => renderTaskItem(t)).join("") || `<div class="empty-hint">拖拽任务到这里</div>`;
    });
    bindTaskListClicks($("#matrix-board"));
    if (window.Sortable) {
      matrixSortables.forEach((s) => s.destroy());
      matrixSortables = $$(".matrix-list").map((el) =>
        Sortable.create(el, {
          group: "matrix",
          animation: 150,
          onAdd: (evt) => {
            const id = evt.item.dataset.id;
            const q = Number(evt.to.dataset.q);
            const task = activePlan().tasks.find((t) => t.id === id);
            if (task) {
              task.quadrant = q;
              task.urgent = q === 1 || q === 3;
              task.important = q === 1 || q === 2;
              persist();
              toast("已更新象限");
              renderMatrix();
            }
          },
        })
      );
    }
  }

  /* ---------- 看板 ---------- */
  function filteredTasksForDash() {
    const planId = $("#dash-plan").value;
    const tag = $("#dash-tag").value;
    let plans = db.plans.filter((p) => p.status !== "archived");
    if (planId) plans = plans.filter((p) => p.id === planId);
    let tasks = plans.flatMap((p) => p.tasks);
    if (tag) tasks = tasks.filter((t) => t.tag === tag);
    return { plans, tasks };
  }

  function renderDashboard() {
    const prevPlan = $("#dash-plan").value;
    $("#dash-plan").innerHTML =
      `<option value="">全部计划</option>` +
      db.plans.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    $("#dash-plan").value = db.plans.some((p) => p.id === prevPlan) ? prevPlan : "";
    fillTagList();
    const range = Number($("#dash-range").value || 7);
    const { tasks } = filteredTasksForDash();
    const done = tasks.filter((t) => t.status === "done").length;
    const doing = tasks.filter((t) => t.status === "doing").length;
    const delayed = tasks.filter((t) => t.status === "delayed" || isOverdue(t)).length;
    const tagValue = $("#dash-tag").value;
    const totalMins = tagValue
      ? tasks.reduce((a, t) => a + (t.actualMinutes || 0), 0)
      : Object.values(db.studyLog).reduce((a, b) => a + b, 0);
    const days = tagValue
      ? Math.max(1, new Set(tasks.filter((t) => t.actualMinutes).map((t) => t.due)).size)
      : Math.max(1, Object.keys(db.studyLog).length);
    const streak = streakInfo();
    const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    const weekTasks = tasks.filter((t) => t.due >= Store.addDays(Store.today(), -6));
    const weekDone = weekTasks.filter((t) => t.status === "done").length;
    const dayTasks = tasks.filter((t) => t.due === Store.today());
    const dayDone = dayTasks.filter((t) => t.status === "done").length;

    $("#dash-cards").innerHTML = `
      <div class="stat-card"><div class="label">总任务</div><div class="value">${tasks.length}</div></div>
      <div class="stat-card"><div class="label">已完成</div><div class="value">${done}</div></div>
      <div class="stat-card"><div class="label">进行中</div><div class="value">${doing}</div></div>
      <div class="stat-card"><div class="label">延期/过期</div><div class="value">${delayed}</div></div>
      <div class="stat-card"><div class="label">累计学习</div><div class="value">${totalMins} 分</div></div>
      <div class="stat-card"><div class="label">日均学习</div><div class="value">${Math.round(totalMins / days)} 分</div></div>
      <div class="stat-card"><div class="label">最长连续签到</div><div class="value">${streak.longest}</div></div>
      <div class="stat-card"><div class="label">完成率(总/周/日)</div><div class="value" style="font-size:1.1rem">${rate}% / ${
      weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0
    }% / ${dayTasks.length ? Math.round((dayDone / dayTasks.length) * 100) : 0}%</div></div>`;

    drawRing("chart-ring", rate);
    drawHours("chart-hours", range);
    drawPie("chart-pie", tasks);
    drawTrend("chart-trend", range, tasks);
    drawPriority("chart-priority", tasks);
    drawHeatmap();
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      delete charts[key];
    }
  }

  function chartColors() {
    const dark = db.theme === "dark";
    return {
      brand: dark ? "#3dbdb6" : "#0f6e6a",
      accent: dark ? "#e08a55" : "#c45c26",
      grid: dark ? "#2d3a3e" : "#d5dee2",
      ink: dark ? "#e8eef0" : "#1a2b2e",
    };
  }

  function drawRing(canvasId, rate) {
    destroyChart(canvasId);
    const c = chartColors();
    charts[canvasId] = new Chart($(`#${canvasId}`), {
      type: "doughnut",
      data: {
        labels: ["已完成", "未完成"],
        datasets: [{ data: [rate, 100 - rate], backgroundColor: [c.brand, c.grid], borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: {
          legend: { display: false },
          title: { display: true, text: `${rate}%`, color: c.ink, font: { size: 22 } },
        },
      },
    });
  }

  function rangeDates(n) {
    return Array.from({ length: n }, (_, i) => Store.addDays(Store.today(), i - (n - 1)));
  }

  function localDay(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function drawHours(canvasId, n) {
    destroyChart(canvasId);
    const c = chartColors();
    const labels = rangeDates(n);
    charts[canvasId] = new Chart($(`#${canvasId}`), {
      type: "bar",
      data: {
        labels: labels.map((d) => d.slice(5)),
        datasets: [{ label: "分钟", data: labels.map((d) => db.studyLog[d] || 0), backgroundColor: c.brand }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: c.ink }, grid: { color: c.grid } },
          y: { ticks: { color: c.ink }, grid: { color: c.grid }, beginAtZero: true },
        },
      },
    });
  }

  function drawPie(canvasId, tasks) {
    destroyChart(canvasId);
    const c = chartColors();
    const map = {};
    tasks.forEach((t) => {
      const k = t.tag || "未分类";
      map[k] = map[k] || { count: 0, mins: 0 };
      map[k].count++;
      map[k].mins += t.actualMinutes || 0;
    });
    const labels = Object.keys(map);
    charts[canvasId] = new Chart($(`#${canvasId}`), {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data: labels.map((k) => map[k].mins || map[k].count),
            backgroundColor: labels.map((_, i) => `hsl(${170 + i * 35} 45% 42%)`),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: c.ink } } },
      },
    });
  }

  function drawTrend(canvasId, n, tasks) {
    destroyChart(canvasId);
    const c = chartColors();
    const labels = rangeDates(n);
    const data = labels.map((d) => {
      const byTimeline = tasks.filter((t) => t.status === "done" && (t.timeline || []).some((x) => x.at && localDay(x.at) === d)).length;
      const byDue = tasks.filter((t) => t.status === "done" && t.due === d).length;
      return Math.max(byTimeline, byDue);
    });
    charts[canvasId] = new Chart($(`#${canvasId}`), {
      type: "line",
      data: {
        labels: labels.map((d) => d.slice(5)),
        datasets: [{ label: "完成数", data, borderColor: c.accent, tension: 0.3, fill: false }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: c.ink }, grid: { color: c.grid } },
          y: { ticks: { color: c.ink }, grid: { color: c.grid }, beginAtZero: true, precision: 0 },
        },
      },
    });
  }

  function drawPriority(canvasId, tasks) {
    destroyChart(canvasId);
    const c = chartColors();
    const levels = ["high", "mid", "low"];
    charts[canvasId] = new Chart($(`#${canvasId}`), {
      type: "bar",
      data: {
        labels: ["高", "中", "低"],
        datasets: [
          {
            label: "完成",
            data: levels.map((p) => tasks.filter((t) => t.priority === p && t.status === "done").length),
            backgroundColor: c.brand,
          },
          {
            label: "未完成",
            data: levels.map((p) => tasks.filter((t) => t.priority === p && t.status !== "done").length),
            backgroundColor: c.accent,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: c.ink } } },
        scales: {
          x: { stacked: true, ticks: { color: c.ink }, grid: { color: c.grid } },
          y: { stacked: true, ticks: { color: c.ink }, grid: { color: c.grid }, beginAtZero: true },
        },
      },
    });
  }

  function drawHeatmap() {
    const box = $("#heatmap");
    const start = new Date(Store.today() + "T00:00:00");
    start.setDate(1);
    const year = start.getFullYear();
    const month = start.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const max = Math.max(1, ...Object.values(db.studyLog));
    let html = "";
    for (let i = 1; i <= days; i++) {
      const d = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const m = db.studyLog[d] || 0;
      const lv = !m ? 0 : m / max > 0.75 ? 4 : m / max > 0.5 ? 3 : m / max > 0.25 ? 2 : 1;
      html += `<div class="heat-cell lv${lv}" title="${d}: ${m} 分钟">${i}</div>`;
    }
    box.innerHTML = html;
  }

  function buildReport(type) {
    const n = type === "week" ? 7 : 30;
    const labels = rangeDates(n);
    const mins = labels.reduce((a, d) => a + (db.studyLog[d] || 0), 0);
    const prevLabels = labels.map((d) => Store.addDays(d, -n));
    const prevMins = prevLabels.reduce((a, d) => a + (db.studyLog[d] || 0), 0);
    const check = labels.filter((d) => db.checkins[d]).length;
    const { tasks } = filteredTasksForDash();
    const done = tasks.filter((t) => t.status === "done" && labels.includes(t.due)).length;
    const delta = mins - prevMins;
    return `【${type === "week" ? "周度" : "月度"}学习报告】\n统计区间：${labels[0]} ~ ${labels.at(-1)}\n` +
      `学习总时长：${mins} 分钟（较上一周期 ${delta >= 0 ? "+" : ""}${delta} 分钟）\n` +
      `签到天数：${check}/${n}\n` +
      `区间内完成任务：${done} 个\n` +
      `连续签到：${streakInfo().current} 天（历史最长 ${streakInfo().longest}）\n` +
      `变化趋势：${delta > 0 ? "投入上升，保持节奏。" : delta < 0 ? "投入有所回落，建议找回固定学习时段。" : "投入与上周期持平。"}\n` +
      `建议：优先清理过期任务，保证每日复盘。`;
  }

  /* ---------- 复盘 ---------- */
  function renderReview() {
    const q = ($("#review-search").value || "").trim().toLowerCase();
    const tag = $("#review-tag-filter").value;
    const tags = new Set();
    db.reviews.forEach((r) => (r.tags || []).forEach((t) => tags.add(t)));
    $("#review-tag-filter").innerHTML =
      `<option value="">全部标签</option>` + [...tags].map((t) => `<option value="${escapeHtml(t)}" ${tag === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("");

    const list = [...db.reviews]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .filter((r) => {
        const text = [r.gain, r.reason, r.hard, r.improve, r.question, r.free, ...(r.tags || [])].join(" ").toLowerCase();
        return (!q || text.includes(q)) && (!tag || (r.tags || []).includes(tag));
      });

    $("#review-timeline").innerHTML = list.length
      ? list
          .map(
            (r) => `<div class="timeline-item ${selectedReviewId === r.id ? "active" : ""}" data-id="${r.id}">
        <strong>${r.date}</strong> · ${r.type === "weekly" ? "每周" : "每日"}
        <div class="muted">${escapeHtml((r.gain || "").slice(0, 40) || "（无收获摘要）")}</div>
      </div>`
          )
          .join("")
      : `<div class="empty-hint">暂无复盘</div>`;

    $$("#review-timeline .timeline-item").forEach((el) => {
      el.onclick = () => {
        selectedReviewId = el.dataset.id;
        renderReview();
      };
    });

    const r = db.reviews.find((x) => x.id === selectedReviewId);
    if (!r) {
      $("#review-editor").classList.remove("hidden");
      $("#review-form").classList.add("hidden");
      return;
    }
    $("#review-editor").classList.add("hidden");
    $("#review-form").classList.remove("hidden");
    const f = $("#review-form");
    f.type.value = r.type;
    f.date.value = r.date;
    f.gain.value = r.gain || "";
    f.reason.value = r.reason || "";
    f.hard.value = r.hard || "";
    f.improve.value = r.improve || "";
    f.question.value = r.question || "";
    f.free.value = r.free || "";
    f.tags.value = (r.tags || []).join(",");
  }

  /* ---------- 沉淀 ---------- */
  function renderNotes() {
    fillTagList();
    const tag = $("#notes-tag-filter") ? $("#notes-tag-filter").value : "";
    const qs = db.questions.filter((x) => !tag || x.tag === tag);
    const ks = db.knowledge.filter((x) => !tag || x.tag === tag);
    const ms = db.mistakes.filter((x) => !tag || x.tag === tag);
    $("#question-list").innerHTML = qs
      .map(
        (q) => `<div class="stack-item">
        <h4>${escapeHtml(q.title)} <span class="badge ${q.status === "solved" ? "" : "warn"}">${q.status === "solved" ? "已解决" : "未解决"}</span></h4>
        <div class="muted">${escapeHtml(q.tag || "未分类")}</div>
        ${q.solution ? `<p><strong>解决方案：</strong>${escapeHtml(q.solution)}</p>` : ""}
        <div class="row gap wrap mt">
          <button class="btn" data-q="${q.id}" data-act="toggle-q">${q.status === "solved" ? "标为未解决" : "标为已解决"}</button>
          <button class="btn danger ghost" data-q="${q.id}" data-act="del-q">删除</button>
        </div>
      </div>`
      )
      .join("") || `<div class="empty-hint">暂无疑问${tag ? "（当前科目筛选下）" : ""}</div>`;

    $("#knowledge-list").innerHTML = ks
      .map(
        (k) => `<div class="stack-item">
        <h4>${escapeHtml(k.title)}</h4>
        <div class="badge">${escapeHtml(k.tag || "未分类")}</div>
        <p>${escapeHtml(k.content || "")}</p>
        <button class="btn danger ghost" data-k="${k.id}" data-act="del-k">删除</button>
      </div>`
      )
      .join("") || `<div class="empty-hint">暂无知识点${tag ? "（当前科目筛选下）" : ""}</div>`;

    $("#mistake-list").innerHTML = ms
      .map(
        (m) => `<div class="stack-item">
        <h4>${escapeHtml(m.title)}</h4>
        <div class="badge">${escapeHtml(m.tag || "未分类")}</div>
        <p><strong>错误原因：</strong>${escapeHtml(m.reason || "")}</p>
        <p><strong>正确思路：</strong>${escapeHtml(m.thinking || "")}</p>
        <button class="btn danger ghost" data-m="${m.id}" data-act="del-m">删除</button>
      </div>`
      )
      .join("") || `<div class="empty-hint">暂无错题${tag ? "（当前科目筛选下）" : ""}</div>`;
  }

  /* ---------- 设置 ---------- */
  function renderSettings() {
    $("#quote-list").innerHTML = (db.quotes || [])
      .map(
        (q, i) => `<div class="stack-item row gap"><span style="flex:1">${escapeHtml(q)}</span>
      <button class="btn danger ghost" data-qi="${i}">删除</button></div>`
      )
      .join("");

    const due = flatVisibleTasks()
      .filter((t) => t.due === Store.today() || (t.due > Store.today() && t.due <= Store.addDays(Store.today(), 2)))
      .filter((t) => !["done", "abandoned"].includes(t.status));
    $("#due-alerts").innerHTML = due.length
      ? due.map((t) => `<div class="alert-item">${escapeHtml(t.title)} · ${countdownText(t.due)}</div>`).join("")
      : `<div class="muted">近两日没有到期提醒</div>`;

    const backups = Store.getBackups();
    $("#backup-list").innerHTML = backups.length
      ? backups
          .map(
            (b) => `<div class="stack-item row gap"><span style="flex:1">${b.date} 快照</span>
        <button class="btn" data-back="${b.date}">回退</button></div>`
          )
          .join("")
      : `<div class="empty-hint">暂无备份</div>`;
  }

  /* ---------- 任务交互 ---------- */
  function bindTaskListClicks(root) {
    $$(".task-item", root).forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest("[data-act='done']")) {
          completeTask(el.dataset.id);
          return;
        }
        selectedTaskId = el.dataset.id;
        switchView("plans");
        renderPlans();
      };
    });
  }

  function findTask(id) {
    for (const p of db.plans) {
      const t = p.tasks.find((x) => x.id === id);
      if (t) return { plan: p, task: t };
    }
    return null;
  }

  function completeTask(id) {
    const hit0 = findTask(id);
    if (!hit0) return;
    if (hit0.plan.status === "archived") return toast("归档计划只读，已暂停打卡");
    const task = hit0.task;
    promptModal(
      "完成备注",
      [
        { name: "note", label: "学习记录 / 收获 / 问题（选填）", value: "" },
        {
          name: "minutes",
          label: "本次实际用时（分钟，计入今日学习时长）",
          value: String(task.actualMinutes ? 0 : task.estimate || 25),
          type: "number",
        },
      ],
      (v) => {
        const hit = findTask(id);
        if (!hit) return;
        const mins = Math.max(0, Number(v.minutes) || 0);
        hit.task.status = "done";
        hit.task.note = v.note || "";
        hit.task.timeline = hit.task.timeline || [];
        hit.task.timeline.push({ type: "done", at: new Date().toISOString(), note: v.note || "" });
        hit.task.actualMinutes = (hit.task.actualMinutes || 0) + mins;
        if (mins) addStudyMinutes(mins);
        syncParentStatus(hit.plan);
        persist();
        toast("已标记完成");
        refreshCurrent();
      }
    );
  }

  function refreshCurrent() {
    const cur = $(".nav-item.active")?.dataset.view || "home";
    switchView(cur);
  }

  /* ---------- 番茄钟 ---------- */
  function creditFocus(minutes) {
    const hit = findTask(pomo.taskId);
    if (!hit || minutes <= 0) return;
    hit.task.actualMinutes = Math.round(((hit.task.actualMinutes || 0) + minutes) * 10) / 10;
    addStudyMinutes(minutes);
    persist();
  }

  function paintPomo() {
    const m = String(Math.floor(pomo.remain / 60)).padStart(2, "0");
    const s = String(pomo.remain % 60).padStart(2, "0");
    $("#focus-timer").textContent = `${m}:${s}`;
    $("#focus-phase").textContent = pomo.phase === "work" ? (pomo.running ? "专注中" : "已暂停") : "休息中";
    $("#btn-focus-toggle").textContent = pomo.running ? "暂停" : "继续";
  }

  function startPomodoro(taskId) {
    const hit = findTask(taskId);
    if (!hit) return toast("请先选择任务");
    pomo.taskId = taskId;
    const work = Number($("#pomo-work").value) || 25;
    pomo.remain = work * 60;
    pomo.phase = "work";
    pomo.running = true;
    pomo.focusSec = 0;
    $("#focus-task-title").textContent = hit.task.title;
    $("#focus-overlay").classList.remove("hidden");
    hit.task.status = hit.task.status === "todo" ? "doing" : hit.task.status;
    hit.task.timeline = hit.task.timeline || [];
    hit.task.timeline.push({ type: "start", at: new Date().toISOString() });
    persist();
    tickPomo();
  }

  function tickPomo() {
    clearInterval(pomo.timer);
    paintPomo();
    pomo.timer = setInterval(() => {
      if (!pomo.running) return;
      pomo.remain--;
      if (pomo.phase === "work") pomo.focusSec = (pomo.focusSec || 0) + 1;
      if (pomo.remain <= 0) {
        if (pomo.phase === "work") {
          const mins = Number($("#pomo-work").value) || 25;
          creditFocus(mins);
          pomo.focusSec = 0;
          toast("专注结束，开始休息");
          pomo.phase = "break";
          pomo.remain = (Number($("#pomo-break").value) || 5) * 60;
        } else {
          toast("休息结束，继续专注");
          pomo.phase = "work";
          pomo.remain = (Number($("#pomo-work").value) || 25) * 60;
        }
        pomo.running = true;
      }
      paintPomo();
    }, 1000);
  }

  function endPomodoro() {
    clearInterval(pomo.timer);
    const mins = pomo.phase === "work" ? Math.round(((pomo.focusSec || 0) / 60) * 10) / 10 : 0;
    if (mins) creditFocus(mins);
    pomo.focusSec = 0;
    pomo.running = false;
    $("#focus-overlay").classList.add("hidden");
    toast(mins ? `已记录 ${mins} 分钟专注` : "已退出专注");
  }

  /* ---------- 搜索 ---------- */
  function globalSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) return toast("请输入关键词");
    const hits = [];
    db.plans.forEach((p) =>
      p.tasks.forEach((t) => {
        if ((t.title || "").toLowerCase().includes(q)) hits.push(`任务 · ${t.title}`);
      })
    );
    db.reviews.forEach((r) => {
      const text = [r.gain, r.free, r.question].join(" ");
      if (text.toLowerCase().includes(q)) hits.push(`复盘 · ${r.date}`);
    });
    db.questions.forEach((x) => {
      if ((x.title || "").toLowerCase().includes(q)) hits.push(`疑问 · ${x.title}`);
    });
    db.knowledge.forEach((x) => {
      if ((x.title + x.content).toLowerCase().includes(q)) hits.push(`知识点 · ${x.title}`);
    });
    db.mistakes.forEach((x) => {
      if ((x.title + (x.reason || "") + (x.thinking || "")).toLowerCase().includes(q)) hits.push(`错题 · ${x.title}`);
    });
    $("#modal-title").textContent = `搜索结果（${hits.length}）`;
    $("#modal-body").innerHTML = hits.length
      ? `<ul>${hits.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`
      : `<p class="muted">没有匹配内容</p>`;
    $("#modal-actions").innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn primary";
    ok.textContent = "关闭";
    ok.onclick = () => $("#modal").classList.add("hidden");
    $("#modal-actions").append(ok);
    $("#modal").classList.remove("hidden");
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $$(".nav-item").forEach((btn) => (btn.onclick = () => switchView(btn.dataset.view)));
    $("#btn-menu").onclick = () => $("#sidebar").classList.toggle("open");
    $("#btn-theme").onclick = () => {
      db.theme = db.theme === "dark" ? "light" : "dark";
      persist();
      applyTheme();
      toast(db.theme === "dark" ? "已切换深色" : "已切换浅色");
      refreshCurrent();
    };
    $("#btn-checkin").onclick = () => {
      const d = Store.today();
      if (db.checkins[d]) return toast("今天已经签到过了");
      const now = new Date();
      db.checkins[d] = now.toISOString();
      persist();
      toast(`签到成功 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
      renderHome();
    };

    $("#btn-quick-task").onclick = () => {
      promptModal(
        "添加临时任务",
        [
          { name: "title", label: "任务名称", value: "" },
          { name: "estimate", label: "预计分钟", value: "30", type: "number" },
        ],
        (v) => {
          if (!v.title.trim()) return toast("请填写标题");
          const plan = activePlan();
          if (!plan) return toast("请先创建计划");
          plan.tasks.push(
            Store.blankTask({
              title: v.title.trim(),
              estimate: Number(v.estimate) || 30,
              due: Store.today(),
              tag: "临时",
              quadrant: 1,
              urgent: true,
              important: true,
            })
          );
          persist();
          toast("已添加临时任务");
          refreshCurrent();
        }
      );
    };

    $("[data-goto='today']")?.addEventListener("click", () => switchView("today"));

    $("#plan-switcher").onchange = (e) => {
      db.activePlanId = e.target.value;
      selectedTaskId = null;
      persist();
      renderPlans();
    };
    ["plan-name", "plan-goal", "plan-cycle", "plan-start", "plan-end"].forEach((id) => {
      $(`#${id}`).onchange = () => {
        const plan = activePlan();
        if (!plan) return;
        plan.name = $("#plan-name").value;
        plan.goal = $("#plan-goal").value;
        plan.cycle = $("#plan-cycle").value;
        plan.start = $("#plan-start").value;
        plan.end = $("#plan-end").value;
        persist();
        toast("计划已保存");
        renderPlans();
      };
    });
    $("#plan-status").onchange = (e) => {
      const plan = activePlan();
      plan.status = e.target.value;
      persist();
      toast("计划状态已更新");
      renderPlans();
    };

    $("#btn-new-plan").onclick = () => {
      promptModal("新建计划", [{ name: "name", label: "计划名称", value: "新的学习计划" }], (v) => {
        const p = {
          id: Store.uid(),
          name: v.name || "新计划",
          goal: "",
          cycle: "week",
          start: Store.today(),
          end: Store.addDays(Store.today(), 7),
          status: "active",
          createdAt: new Date().toISOString(),
          tasks: [],
        };
        db.plans.push(p);
        db.activePlanId = p.id;
        persist();
        toast("已创建计划");
        renderPlans();
      });
    };

    $("#btn-delete-plan").onclick = () => {
      confirmModal("删除计划", "删除后不可恢复，确认删除当前计划？", () => {
        if (db.plans.length <= 1) return toast("至少保留一套计划");
        db.plans = db.plans.filter((p) => p.id !== db.activePlanId);
        db.activePlanId = db.plans[0].id;
        selectedTaskId = null;
        persist();
        toast("已删除");
        renderPlans();
      });
    };

    $("#btn-apply-template").onclick = () => {
      const all = [...Store.TEMPLATES, ...(db.customTemplates || [])];
      $("#modal-title").textContent = "选择模板";
      $("#modal-body").innerHTML = all
        .map((t, i) => `<button class="btn block" style="margin-bottom:8px" data-tpl="${i}">${escapeHtml(t.name)}</button>`)
        .join("");
      $("#modal-actions").innerHTML = "";
      const cancel = document.createElement("button");
      cancel.className = "btn ghost";
      cancel.textContent = "取消";
      cancel.onclick = () => $("#modal").classList.add("hidden");
      $("#modal-actions").append(cancel);
      $("#modal").classList.remove("hidden");
      $$("#modal-body [data-tpl]").forEach((btn) => {
        btn.onclick = () => {
          const tpl = all[Number(btn.dataset.tpl)];
          const p = {
            id: Store.uid(),
            name: tpl.name,
            goal: tpl.goal,
            cycle: tpl.cycle || "custom",
            start: Store.today(),
            end: Store.addDays(Store.today(), 30),
            status: "active",
            createdAt: new Date().toISOString(),
            tasks: (tpl.tasks || []).map((t, i) =>
              Store.blankTask({ ...t, due: Store.today(), order: i + 1, quadrant: t.priority === "high" ? 1 : 2 })
            ),
          };
          db.plans.push(p);
          db.activePlanId = p.id;
          persist();
          $("#modal").classList.add("hidden");
          toast("已套用模板");
          renderPlans();
        };
      });
    };

    $("#btn-save-template").onclick = () => {
      const plan = activePlan();
      db.customTemplates = db.customTemplates || [];
      db.customTemplates.push({
        id: Store.uid(),
        name: plan.name + "（模板）",
        goal: plan.goal,
        cycle: plan.cycle,
        tasks: rootTasks(plan).map((t) => ({
          title: t.title,
          tag: t.tag,
          priority: t.priority,
          estimate: t.estimate,
          repeat: t.repeat,
        })),
      });
      persist();
      toast("已保存为个人模板");
    };

    $("#btn-add-task").onclick = () => {
      const plan = activePlan();
      if (plan.status === "archived") return toast("归档计划不可编辑");
      const t = Store.blankTask({ title: "新任务", due: Store.today() });
      plan.tasks.push(t);
      selectedTaskId = t.id;
      persist();
      renderPlans();
    };

    ["task-filter-tag", "task-filter-priority", "task-filter-status"].forEach((id) => {
      $(`#${id}`).onchange = () => renderPlans();
    });

    $("#task-form").onsubmit = (e) => {
      e.preventDefault();
      const hit = findTask(selectedTaskId);
      if (!hit) return;
      if (hit.plan.status === "archived") return toast("归档计划只读，已暂停编辑");
      const f = e.target;
      const prev = hit.task.status;
      Object.assign(hit.task, {
        title: f.title.value.trim(),
        estimate: Number(f.estimate.value) || 0,
        priority: f.priority.value,
        due: f.due.value,
        tag: f.tag.value.trim(),
        difficulty: Number(f.difficulty.value),
        status: f.status.value,
        quadrant: Number(f.quadrant.value),
        repeat: f.repeat.value,
        urgent: f.urgent.checked,
        important: f.important.checked,
      });
      if (prev !== hit.task.status) {
        hit.task.timeline = hit.task.timeline || [];
        hit.task.timeline.push({ type: "status", at: new Date().toISOString(), status: hit.task.status });
      }
      // 同步象限与紧急重要
      const q = hit.task.quadrant;
      hit.task.urgent = q === 1 || q === 3;
      hit.task.important = q === 1 || q === 2;
      syncParentStatus(hit.plan);
      persist();
      toast("任务已保存");
      renderPlans();
    };

    $("#btn-add-sub").onclick = () => {
      const hit = findTask(selectedTaskId);
      if (!hit) return;
      const parentId = hit.task.parentId || hit.task.id;
      const t = Store.blankTask({
        title: "子任务",
        parentId,
        due: hit.task.due,
        tag: hit.task.tag,
        quadrant: hit.task.quadrant,
      });
      hit.plan.tasks.push(t);
      selectedTaskId = t.id;
      persist();
      renderPlans();
    };

    $("#btn-delete-task").onclick = () => {
      confirmModal("删除任务", "确认删除该任务及其子任务？", () => {
        const hit = findTask(selectedTaskId);
        if (!hit) return;
        const ids = new Set([hit.task.id, ...childrenOf(hit.task.id, hit.plan).map((c) => c.id)]);
        hit.plan.tasks = hit.plan.tasks.filter((t) => !ids.has(t.id));
        selectedTaskId = null;
        persist();
        toast("已删除任务");
        renderPlans();
      });
    };

    $("#btn-start-pomodoro").onclick = () => startPomodoro(selectedTaskId);
    $("#btn-focus-toggle").onclick = () => {
      pomo.running = !pomo.running;
      $("#btn-focus-toggle").textContent = pomo.running ? "暂停" : "继续";
    };
    $("#btn-focus-skip").onclick = () => {
      if (pomo.phase === "work") {
        const mins = Math.round(((pomo.focusSec || 0) / 60) * 10) / 10;
        if (mins) creditFocus(mins);
        pomo.focusSec = 0;
        pomo.phase = "break";
        pomo.remain = (Number($("#pomo-break").value) || 5) * 60;
        toast("已跳过，进入休息");
      } else {
        pomo.phase = "work";
        pomo.remain = (Number($("#pomo-work").value) || 25) * 60;
        toast("开始新一轮专注");
      }
      pomo.running = true;
      paintPomo();
    };
    $("#btn-focus-exit").onclick = () => {
      endPomodoro();
      refreshCurrent();
    };

    $("#btn-batch-done").onclick = () => {
      const ids = selectedBatchIds();
      if (!ids.length) return toast("请先勾选任务");
      const plans = new Set();
      ids.forEach((id) => {
        const hit = findTask(id);
        if (!hit) return;
        hit.task.status = "done";
        hit.task.timeline = hit.task.timeline || [];
        hit.task.timeline.push({ type: "done", at: new Date().toISOString(), note: "批量标记完成" });
        plans.add(hit.plan);
      });
      plans.forEach((p) => syncParentStatus(p));
      persist();
      toast(`已完成 ${ids.length} 项`);
      renderToday();
    };
    $("#btn-batch-delete").onclick = () => {
      const ids = selectedBatchIds();
      if (!ids.length) return toast("请先勾选任务");
      confirmModal("批量删除", `确认删除 ${ids.length} 个任务？（子任务会一并删除）`, () => {
        const hitPlans = new Set();
        ids.forEach((id) => {
          const hit = findTask(id);
          if (!hit) return;
          const kill = new Set([id, ...childrenOf(id, hit.plan).map((c) => c.id)]);
          hit.plan.tasks = hit.plan.tasks.filter((t) => !kill.has(t.id));
          hitPlans.add(hit.plan);
        });
        persist();
        toast("已删除");
        renderToday();
      });
    };
    $("#btn-batch-tag").onclick = () => {
      const ids = selectedBatchIds();
      if (!ids.length) return toast("请先勾选任务");
      promptModal("批量修改标签", [{ name: "tag", label: "新标签", value: "" }], (v) => {
        ids.forEach((id) => {
          const hit = findTask(id);
          if (hit) hit.task.tag = v.tag.trim();
        });
        persist();
        toast("标签已更新");
        renderToday();
      });
    };

    ["dash-plan", "dash-tag", "dash-range"].forEach((id) => {
      $(`#${id}`).onchange = () => renderDashboard();
    });
    $("#btn-week-report").onclick = () => {
      $("#report-box").hidden = false;
      $("#report-text").textContent = buildReport("week");
    };
    $("#btn-month-report").onclick = () => {
      $("#report-box").hidden = false;
      $("#report-text").textContent = buildReport("month");
    };
    $("#btn-close-report").onclick = () => ($("#report-box").hidden = true);
    $("#btn-export-dash").onclick = async () => {
      const node = $("#dash-charts");
      if (!window.html2canvas) return toast("截图组件未加载");
      const canvas = await html2canvas(node, { backgroundColor: getComputedStyle(document.body).backgroundColor });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `筑计划看板_${Store.today()}.png`;
      a.click();
      toast("看板图已导出");
    };

    $("#btn-new-daily-review").onclick = () => newReview("daily");
    $("#btn-new-weekly-review").onclick = () => newReview("weekly");
    function newReview(type) {
      const r = {
        id: Store.uid(),
        type,
        date: Store.today(),
        gain: "",
        reason: "",
        hard: "",
        improve: "",
        question: "",
        free: "",
        tags: [],
      };
      db.reviews.unshift(r);
      selectedReviewId = r.id;
      persist();
      renderReview();
    }
    $("#review-form").onsubmit = (e) => {
      e.preventDefault();
      const r = db.reviews.find((x) => x.id === selectedReviewId);
      if (!r) return;
      const f = e.target;
      Object.assign(r, {
        type: f.type.value,
        date: f.date.value,
        gain: f.gain.value,
        reason: f.reason.value,
        hard: f.hard.value,
        improve: f.improve.value,
        question: f.question.value,
        free: f.free.value,
        tags: f.tags.value
          .split(/[,，]/)
          .map((x) => x.trim())
          .filter(Boolean),
      });
      if (r.question.trim()) {
        const title = r.question.trim();
        const existed = db.questions.some((q) => q.sourceReviewId === r.id || q.title === title);
        if (!existed) {
          db.questions.unshift({
            id: Store.uid(),
            title,
            status: "open",
            solution: "",
            tag: r.tags[0] || "",
            sourceReviewId: r.id,
          });
        }
      }
      persist();
      toast("复盘已保存");
      renderReview();
    };
    $("#btn-delete-review").onclick = () => {
      confirmModal("删除复盘", "确认删除这条复盘？", () => {
        db.reviews = db.reviews.filter((r) => r.id !== selectedReviewId);
        selectedReviewId = null;
        persist();
        toast("已删除");
        renderReview();
      });
    };
    $("#review-search").oninput = () => renderReview();
    $("#review-tag-filter").onchange = () => renderReview();
    $("#notes-tag-filter").onchange = () => renderNotes();
    $("#btn-export-review").onclick = () => {
      const text = db.reviews
        .map(
          (r) =>
            `# ${r.date} ${r.type === "weekly" ? "每周" : "每日"}复盘\n收获：${r.gain}\n未完成原因：${r.reason}\n困难：${r.hard}\n改进：${r.improve}\n疑问：${r.question}\n笔记：${r.free}\n标签：${(r.tags || []).join(",")}\n`
        )
        .join("\n---\n\n");
      downloadText(`筑计划复盘_${Store.today()}.txt`, text);
      toast("复盘已导出");
    };

    $$("#notes-tabs .tab").forEach((tab) => {
      tab.onclick = () => {
        $$("#notes-tabs .tab").forEach((t) => t.classList.remove("active"));
        $$(".tab-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        $(`#tab-${tab.dataset.tab}`).classList.add("active");
      };
    });
    $("#btn-add-question").onclick = () => {
      promptModal(
        "新增疑问",
        [
          { name: "title", label: "问题", value: "" },
          { name: "tag", label: "科目", value: "" },
        ],
        (v) => {
          db.questions.unshift({ id: Store.uid(), title: v.title, tag: v.tag, status: "open", solution: "" });
          persist();
          renderNotes();
        }
      );
    };
    $("#btn-add-knowledge").onclick = () => {
      promptModal(
        "新增知识点",
        [
          { name: "title", label: "标题", value: "" },
          { name: "content", label: "内容", value: "", type: "textarea" },
          { name: "tag", label: "科目", value: "" },
        ],
        (v) => {
          db.knowledge.unshift({ id: Store.uid(), ...v });
          persist();
          renderNotes();
        }
      );
    };
    $("#btn-add-mistake").onclick = () => {
      promptModal(
        "新增错题",
        [
          { name: "title", label: "错题简述", value: "" },
          { name: "reason", label: "错误原因", value: "", type: "textarea" },
          { name: "thinking", label: "正确思路", value: "", type: "textarea" },
          { name: "tag", label: "科目", value: "" },
        ],
        (v) => {
          db.mistakes.unshift({ id: Store.uid(), ...v });
          persist();
          renderNotes();
        }
      );
    };
    $("#view-notes").onclick = (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "toggle-q") {
        const q = db.questions.find((x) => x.id === btn.dataset.q);
        if (!q) return;
        if (q.status !== "solved") {
          promptModal("填写解决方案", [{ name: "solution", label: "解决方案", value: "" }], (v) => {
            q.status = "solved";
            q.solution = v.solution;
            persist();
            renderNotes();
          });
        } else {
          q.status = "open";
          persist();
          renderNotes();
        }
      }
      if (btn.dataset.act === "del-q") {
        db.questions = db.questions.filter((x) => x.id !== btn.dataset.q);
        persist();
        renderNotes();
      }
      if (btn.dataset.act === "del-k") {
        db.knowledge = db.knowledge.filter((x) => x.id !== btn.dataset.k);
        persist();
        renderNotes();
      }
      if (btn.dataset.act === "del-m") {
        db.mistakes = db.mistakes.filter((x) => x.id !== btn.dataset.m);
        persist();
        renderNotes();
      }
    };

    $("#btn-add-quote").onclick = () => {
      const v = $("#new-quote").value.trim();
      if (!v) return;
      db.quotes.push(v);
      $("#new-quote").value = "";
      persist();
      renderSettings();
    };
    $("#quote-list").onclick = (e) => {
      const btn = e.target.closest("[data-qi]");
      if (!btn) return;
      db.quotes.splice(Number(btn.dataset.qi), 1);
      persist();
      renderSettings();
    };
    $("#backup-list").onclick = (e) => {
      const btn = e.target.closest("[data-back]");
      if (!btn) return;
      confirmModal("回退数据", `确认回退到 ${btn.dataset.back} 的快照？当前数据会被覆盖。`, () => {
        db = Store.restoreBackup(btn.dataset.back);
        applyTheme();
        toast("已回退");
        switchView("home");
      });
    };

    $("#btn-export-all").onclick = () => {
      downloadText(`筑计划全量_${Store.today()}.json`, Store.exportJSON(db));
      toast("已导出全部数据");
    };
    $("#btn-export-plan").onclick = () => {
      const plan = activePlan();
      downloadText(`筑计划_${plan.name}_${Store.today()}.json`, JSON.stringify(plan, null, 2));
      toast("已导出当前计划");
    };
    $("#import-json").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        db = Store.importJSON(text);
        applyTheme();
        toast("导入成功");
        switchView("home");
      } catch (err) {
        toast("导入失败：" + err.message);
      }
      e.target.value = "";
    };
    $("#btn-load-sample").onclick = () => {
      confirmModal("载入示例数据", "会用一套演示数据覆盖当前本地数据（可在设置里回退今日快照），确认载入？", () => {
        const prev = { guided: db.guided, theme: db.theme, quotes: db.quotes || [], customTemplates: db.customTemplates || [] };
        db = Store.sample();
        db.guided = prev.guided;
        db.theme = prev.theme;
        if (prev.quotes.length) db.quotes = prev.quotes;
        if (prev.customTemplates.length) db.customTemplates = prev.customTemplates;
        Store.save(db);
        selectedTaskId = null;
        selectedReviewId = null;
        applyTheme();
        toast("已载入示例数据");
        switchView("home");
      });
    };
    $("#btn-clear-all").onclick = () => {
      confirmModal("清空全部数据", "将删除本地所有学习数据，确认继续？", () => {
        db = Store.clearAll();
        Store.save(db);
        applyTheme();
        toast("已清空并重建示例数据");
        switchView("home");
      });
    };

    $("#global-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") globalSearch(e.target.value);
    });

    document.addEventListener("keydown", (e) => {
      if (Tour.isActive()) return;
      if (e.target.matches("input, textarea, select")) return;
      if (e.key === "n") {
        switchView("plans");
        $("#btn-add-task").click();
      }
      if (e.key === "t") startPomodoro(selectedTaskId);
      if (e.key === "1") switchView("home");
      if (e.key === "2") switchView("plans");
      if (e.key === "3") switchView("today");
      if (e.key === "4") switchView("dashboard");
      if (e.key === "5") switchView("review");
    });
  }

  function downloadText(filename, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 新手全功能教学（鼠标引导点击） ---------- */
  const Tour = (() => {
    let index = 0;
    let active = false;
    let paintToken = 0;
    let advanceLocked = false;

    function advance() {
      if (!active || advanceLocked) return;
      advanceLocked = true;
      setTimeout(() => {
        advanceLocked = false;
      }, 320);
      index++;
      if (index >= steps.length) finish(true);
      else showStep();
    }
    let clickHandler = null;
    let resizeHandler = null;
    let guardHandler = null;
    let currentEl = null;

    const steps = [
      {
        kind: "center",
        title: "欢迎来到筑计划",
        text: "这是一次完整功能教学。页面一开始是空白的：任务、模板、复盘都由你自己添加。请跟着橙色鼠标提示，点击高亮按钮逐步体验。",
        nextLabel: "开始教学",
      },
      {
        kind: "click",
        view: "home",
        selector: '#btn-checkin',
        title: "每日签到",
        text: "点这里完成今日签到。连续签到会显示在右上角，断签会提醒你。",
      },
      {
        kind: "click",
        view: "home",
        selector: '.nav-item[data-view="plans"]',
        title: "进入学习计划",
        text: "任务不会预置。先点左侧「学习计划」，在这里管理你的计划。",
      },
      {
        kind: "next",
        view: "plans",
        selector: "#btn-apply-template",
        title: "模板请自己选（可选）",
        text: "不会自动套用任何模板。若需要，先点高亮的「套用模板」，在弹窗里自己挑一套；不需要就直接点「下一步」。",
        nextLabel: "下一步",
      },
      {
        kind: "next",
        view: "plans",
        selector: "#btn-add-task",
        title: "任务请自己添加",
        text: "点「+ 主任务」新建任务（右侧可设时长、优先级、截止、循环、番茄钟）。也可以先点「下一步」，稍后自己慢慢加。",
        nextLabel: "下一步",
        alsoAllowClick: true,
      },
      {
        kind: "next",
        view: "home",
        selector: "#btn-quick-task",
        title: "临时任务快捷入口",
        text: "顶栏的「+ 临时任务」可快速加今天的小事，不用进计划编辑页；这里先了解入口，稍后再用。",
        nextLabel: "下一步",
      },
      {
        kind: "click",
        view: "today",
        selector: '.nav-item[data-view="today"]',
        title: "今日待办",
        text: "这里只看今天要做的和已过期的任务，支持批量完成 / 改标签 / 删除。",
      },
      {
        kind: "click",
        view: "matrix",
        selector: '.nav-item[data-view="matrix"]',
        title: "四象限",
        text: "按紧急/重要分类。有任务后，可以把任务拖到不同象限。",
      },
      {
        kind: "click",
        view: "dashboard",
        selector: '.nav-item[data-view="dashboard"]',
        title: "数据看板",
        text: "完成率、学习时长、科目占比、打卡热力、周/月报告都在这里。数据会随你打卡和学习自动积累。",
      },
      {
        kind: "click",
        view: "review",
        selector: '.nav-item[data-view="review"]',
        title: "学习复盘",
        text: "用「每日复盘 / 每周复盘」记录收获与问题，支持搜索和导出 TXT。",
      },
      {
        kind: "next",
        view: "review",
        selector: "#btn-new-daily-review",
        title: "写一条复盘",
        text: "点「每日复盘」打开表单体验；不想现在写就点「下一步」。",
        nextLabel: "下一步",
        alsoAllowClick: true,
      },
      {
        kind: "click",
        view: "notes",
        selector: '.nav-item[data-view="notes"]',
        title: "沉淀本",
        text: "疑问清单、知识点摘录、错题记录分三个页签，可按科目筛选，全部自己添加。",
      },
      {
        kind: "click",
        view: "settings",
        selector: '.nav-item[data-view="settings"]',
        title: "设置与备份",
        text: "可改激励语、导出/导入全部数据、回退每日快照。所有数据都存在本机浏览器 localStorage，不会上传。",
      },
      {
        kind: "next",
        view: "settings",
        selector: "#btn-load-sample",
        title: "想先看有数据的界面？",
        text: "点「载入示例数据」可以一键得到一套演示数据（含任务、打卡、复盘、看板）；不想覆盖就点「下一步」，从零开始自己记录。",
        nextLabel: "下一步",
      },
      {
        kind: "click",
        view: "settings",
        selector: "#btn-theme",
        title: "深浅色切换",
        text: "点「切换深浅色」试试主题，选择会自动记住。",
      },
      {
        kind: "click",
        view: "home",
        selector: '.nav-item[data-view="home"]',
        title: "回到首页仪表盘",
        text: "首页汇总签到、今日待办和进度。全局搜索在顶栏，随时可找任务/复盘/知识点。",
      },
      {
        kind: "center",
        title: "教学完成",
        text: "之后请自己添加任务，或在「学习计划」里按需套用模板；想快速看效果，去设置页点「载入示例数据」。设置页可随时「重新观看功能教学」。开始打造你的学习节奏吧！",
        nextLabel: "开始使用",
      },
    ];

    function root() {
      return $("#tour");
    }

    function clearTarget() {
      if (currentEl) {
        currentEl.classList.remove("tour-target-live");
        if (clickHandler) currentEl.removeEventListener("click", clickHandler, true);
      }
      currentEl = null;
      clickHandler = null;
    }

    function placeCard(rect) {
      const card = $("#tour-card");
      const pad = 14;
      const cw = card.offsetWidth || 360;
      const ch = card.offsetHeight || 180;
      let left = rect.left;
      let top = rect.bottom + 14;
      if (top + ch > window.innerHeight - pad) top = Math.max(pad, rect.top - ch - 14);
      if (left + cw > window.innerWidth - pad) left = window.innerWidth - cw - pad;
      if (left < pad) left = pad;
      if (top < pad) top = pad;
      // 目标在视口外（例如长页面底部按钮）时，避免卡片被算到屏幕之外
      if (top + ch > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - ch - pad);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    function moveCursorTo(rect, thenClickAnim) {
      const cur = $("#tour-cursor");
      const x = rect.left + Math.min(rect.width * 0.6, rect.width - 8);
      const y = rect.top + Math.min(rect.height * 0.55, rect.height - 8);
      cur.style.left = `${x}px`;
      cur.style.top = `${y}px`;
      cur.classList.remove("clicking");
      if (thenClickAnim) {
        setTimeout(() => cur.classList.add("clicking"), 560);
      }
    }

    function highlight(el) {
      const spot = $("#tour-spotlight");
      const rect = el.getBoundingClientRect();
      const pad = 8;
      spot.style.left = `${rect.left - pad}px`;
      spot.style.top = `${rect.top - pad}px`;
      spot.style.width = `${rect.width + pad * 2}px`;
      spot.style.height = `${rect.height + pad * 2}px`;
      spot.classList.add("pulse");
      placeCard(rect);
      moveCursorTo(rect, true);
      el.classList.add("tour-target-live");
      currentEl = el;
    }

    function showCenter(step) {
      const box = root();
      box.classList.add("centered-card");
      clearTarget();
      $("#tour-title").textContent = step.title;
      $("#tour-text").textContent = step.text;
      $("#tour-next").textContent = step.nextLabel || "下一步";
      $("#tour-next").classList.remove("hidden");
      $("#tour-card").style.left = "";
      $("#tour-card").style.top = "";
    }

    function paintStep(step, el, token) {
      if (!active || token !== paintToken) return;
      $("#tour-title").textContent = step.title;
      $("#tour-text").textContent = step.text;
      highlight(el);

      if (step.kind === "click") {
        $("#tour-next").classList.add("hidden");
      } else {
        $("#tour-next").classList.remove("hidden");
        $("#tour-next").textContent = step.nextLabel || "下一步";
      }

      if (step.kind === "click" || step.alsoAllowClick) {
        const at = index;
        clickHandler = () => {
          setTimeout(() => {
            if (!active || index !== at) return;
            advance();
          }, 280);
        };
        el.addEventListener("click", clickHandler, { once: true, capture: true });
      }
    }

    function showStep() {
      if (!active) return;
      const token = ++paintToken;
      const step = steps[index];
      $("#tour-step-num").textContent = String(index + 1);
      $("#tour-step-total").textContent = String(steps.length);
      clearTarget();
      $("#modal").classList.add("hidden");

      if (step.kind === "center") {
        showCenter(step);
        return;
      }

      root().classList.remove("centered-card");
      if (step.view) switchView(step.view);
      // 等待视图切换与淡入动画完成后再定位高亮
      setTimeout(() => {
        if (!active || token !== paintToken) return;
        const el = $(step.selector);
        if (!el) {
          index++;
          if (index >= steps.length) return finish(true);
          return showStep();
        }
        const inSidebar = $("#sidebar").contains(el) && window.innerWidth <= 980;
        // 目标在页面下方时先滚到可见区域，否则卡片会被算到屏幕外
        if (!inSidebar && step.view !== "home") {
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        }
        if (inSidebar) {
          $("#sidebar").classList.add("open");
          setTimeout(() => paintStep(step, el, token), 240);
        } else {
          paintStep(step, el, token);
        }
      }, 300);
    }

    function finish(markDone) {
      active = false;
      paintToken++;
      advanceLocked = false;
      clearTarget();
      root().classList.add("hidden");
      root().classList.remove("centered-card");
      window.removeEventListener("resize", resizeHandler);
      if (guardHandler) document.removeEventListener("click", guardHandler, true);
      guardHandler = null;
      if (markDone) {
        db.guided = true;
        persist();
        toast("教学结束，可以开始添加自己的计划了");
        window.scrollTo({ top: 0, behavior: "auto" });
        switchView("home");
      }
    }

    function start() {
      index = 0;
      active = true;
      paintToken++;
      advanceLocked = false;
      root().classList.remove("hidden");
      installGuard();
      $("#tour-skip").onclick = () => finish(true);
      $("#tour-next").onclick = () => advance();
      resizeHandler = () => {
        if (!active) return;
        const step = steps[index];
        if (step?.kind !== "center" && currentEl) highlight(currentEl);
      };
      window.addEventListener("resize", resizeHandler);
      showStep();
    }

    function installGuard() {
      if (guardHandler) document.removeEventListener("click", guardHandler, true);
      guardHandler = (e) => {
        if (!active) return;
        const card = $("#tour-card");
        if (card && card.contains(e.target)) return;
        if (currentEl && currentEl.contains(e.target)) return;
        // 允许在弹窗、专注层里正常操作，避免“教学期间弹窗点不动”
        if (e.target.closest && e.target.closest("#modal, #focus-overlay")) return;
        e.stopPropagation();
        e.preventDefault();
      };
      document.addEventListener("click", guardHandler, true);
    }

    function isActive() {
      return active;
    }

    return { start, finish, isActive, steps };
  })();

  function init() {
    applyTheme();
    bindEvents();
    ensureRepeats();
    persist();
    switchView("home");

    $("#btn-replay-tour").onclick = () => {
      db.guided = false;
      persist();
      Tour.start();
    };
    $("#btn-tour").onclick = () => Tour.start();

    if (!db.guided) {
      setTimeout(() => Tour.start(), 350);
    } else {
      const dueSoon = flatVisibleTasks().filter(
        (t) => t.due === Store.today() && !["done", "abandoned"].includes(t.status)
      );
      if (dueSoon.length) setTimeout(() => toast(`今天有 ${dueSoon.length} 个任务到期`), 800);
    }
  }

  init();
})();
