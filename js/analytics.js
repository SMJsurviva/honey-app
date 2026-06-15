/* Analytics dashboard. Operator-only — redirects to operator.html if not authenticated. */

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

// ---- auth ----
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    $("analyticsView").hidden = false;
    setupTabs();
    loadTab("today");
    return;
  }
  // No session — show inline login
  $("loginView").hidden = false;
  $("loginBtn").addEventListener("click", async () => {
    $("loginErr").hidden = true;
    $("loginBtn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: $("loginEmail").value.trim(),
      password: $("loginPw").value,
    });
    $("loginBtn").disabled = false;
    if (error) { $("loginErr").textContent = "로그인에 실패했습니다."; $("loginErr").hidden = false; return; }
    $("loginView").hidden = true;
    $("analyticsView").hidden = false;
    setupTabs();
    loadTab("today");
  });
}

// ---- tabs ----
function setupTabs() {
  document.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabbtn").forEach((b) => b.classList.remove("sel"));
      btn.classList.add("sel");
      loadTab(btn.dataset.tab);
    });
  });
}

// ---- data fetching ----
async function fetchOrders(from, to) {
  const { data, error } = await sb
    .from("orders")
    .select("id, created_at, done_at, product_id, quantity, urgent, verbal, status, products(honey_type, size_g, display_label)")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data;
}

function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---- tab routing ----
async function loadTab(tab) {
  const el = $("tabContent");
  el.innerHTML = "<p class='meta' style='color:var(--muted);margin-top:16px'>불러오는 중…</p>";
  if (tab === "today") {
    const start = dayStart(new Date());
    const end = new Date(start.getTime() + 86400000);
    const orders = await fetchOrders(start, end);
    renderDayReport(el, orders);
  } else if (tab === "week") {
    const end = new Date();
    const start = dayStart(new Date(end.getTime() - 6 * 86400000));
    const orders = await fetchOrders(start, end);
    renderWeekReport(el, orders);
  } else {
    renderRangeSelector(el);
  }
}

// ---- day report ----
function renderDayReport(el, orders) {
  const done = orders.filter((o) => o.status === "done");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const active = orders.filter((o) => o.status === "pending" || o.status === "in_process");
  const totalBottles = done.reduce((s, o) => s + o.quantity, 0);
  const urgentCount = orders.filter((o) => o.urgent).length;
  const verbalCount = orders.filter((o) => o.verbal).length;

  // Average fulfillment time (requires done_at from migration)
  const timed = done.filter((o) => o.done_at);
  const avgMins = timed.length
    ? Math.round(timed.reduce((s, o) => s + (new Date(o.done_at) - new Date(o.created_at)) / 60000, 0) / timed.length)
    : null;

  // Peak hour
  const hourCounts = {};
  for (const o of orders) {
    const h = new Date(o.created_at).getHours();
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  }
  const peakEntry = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];

  // By SKU (done only)
  const bySku = {};
  for (const o of done) {
    const k = o.product_id;
    if (!bySku[k]) bySku[k] = { label: o.products.display_label, bottles: 0 };
    bySku[k].bottles += o.quantity;
  }
  const skuRows = Object.values(bySku).sort((a, b) => b.bottles - a.bottles);

  el.innerHTML =
    `<div class="stat-grid">
      <div class="stat"><div class="stat-n">${totalBottles}</div><div class="stat-l">완료 병수</div></div>
      <div class="stat"><div class="stat-n">${done.length}</div><div class="stat-l">완료 주문</div></div>
      <div class="stat"><div class="stat-n">${active.length}</div><div class="stat-l">대기·진행</div></div>
      <div class="stat"><div class="stat-n">${cancelled.length}</div><div class="stat-l">취소</div></div>
      ${urgentCount ? `<div class="stat"><div class="stat-n">${urgentCount}</div><div class="stat-l">급한 주문</div></div>` : ""}
      ${verbalCount ? `<div class="stat"><div class="stat-n">${verbalCount}</div><div class="stat-l">구두 주문</div></div>` : ""}
      ${avgMins !== null ? `<div class="stat"><div class="stat-n">${avgMins}분</div><div class="stat-l">평균 처리</div></div>` : ""}
      ${peakEntry ? `<div class="stat"><div class="stat-n">${peakEntry[0]}시</div><div class="stat-l">가장 바쁜 시간</div></div>` : ""}
    </div>` +
    (skuRows.length
      ? `<h3 class="label" style="margin-top:24px">품목별 완료</h3>
         <table class="atable">
           <thead><tr><th>품목</th><th>병수</th></tr></thead>
           <tbody>${skuRows.map((r) => `<tr><td>${r.label}</td><td>${r.bottles}</td></tr>`).join("")}</tbody>
         </table>`
      : `<p class='meta' style='color:var(--muted);text-align:center;margin-top:32px'>오늘 완료된 주문이 없습니다.</p>`
    );
}

// ---- week report ----
function renderWeekReport(el, orders) {
  const today = dayStart(new Date());
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    days.push({
      key: d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
      ts: d.getTime(),
    });
  }

  const dayMap = {};
  for (const d of days) dayMap[d.key] = { orders: 0, bottles: 0, cancelled: 0 };

  for (const o of orders) {
    const key = new Date(o.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
    if (!dayMap[key]) continue;
    if (o.status === "done") { dayMap[key].orders += 1; dayMap[key].bottles += o.quantity; }
    else if (o.status === "cancelled") { dayMap[key].cancelled += 1; }
  }

  const done = orders.filter((o) => o.status === "done");
  const totalBottles = done.reduce((s, o) => s + o.quantity, 0);

  // Top 3 SKUs
  const bySku = {};
  for (const o of done) {
    const k = o.product_id;
    if (!bySku[k]) bySku[k] = { label: o.products.display_label, bottles: 0 };
    bySku[k].bottles += o.quantity;
  }
  const top3 = Object.values(bySku).sort((a, b) => b.bottles - a.bottles).slice(0, 3);

  el.innerHTML =
    `<div class="stat-grid">
      <div class="stat"><div class="stat-n">${totalBottles}</div><div class="stat-l">주간 완료 병수</div></div>
      <div class="stat"><div class="stat-n">${done.length}</div><div class="stat-l">주간 완료 주문</div></div>
    </div>
    <h3 class="label" style="margin-top:24px">일별 현황</h3>
    <table class="atable">
      <thead><tr><th>날짜</th><th>완료</th><th>병수</th><th>취소</th></tr></thead>
      <tbody>${days.map(({ key }) => {
        const v = dayMap[key];
        return `<tr><td>${key}</td><td>${v.orders || ""}</td><td>${v.bottles || ""}</td><td>${v.cancelled || ""}</td></tr>`;
      }).join("")}</tbody>
    </table>` +
    (top3.length
      ? `<h3 class="label" style="margin-top:24px">인기 품목 (완료 기준)</h3>
         <table class="atable">
           <thead><tr><th>품목</th><th>병수</th></tr></thead>
           <tbody>${top3.map((r, i) => `<tr><td>${i + 1}. ${r.label}</td><td>${r.bottles}</td></tr>`).join("")}</tbody>
         </table>`
      : ""
    );
}

// ---- range selector ----
function renderRangeSelector(el) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  el.innerHTML =
    `<div class="date-inputs">
      <label>시작일<input type="date" id="rangeFrom" value="${weekAgoStr}"></label>
      <label>종료일<input type="date" id="rangeTo" value="${todayStr}"></label>
      <button id="rangeGo" class="smallbtn good" type="button" style="align-self:flex-end">조회</button>
    </div>
    <div id="rangeResult"></div>`;
  $("rangeGo").addEventListener("click", async () => {
    const from = new Date($("rangeFrom").value);
    const toRaw = new Date($("rangeTo").value);
    const to = new Date(toRaw.getTime() + 86400000); // include the end date
    $("rangeResult").innerHTML = "<p class='meta' style='color:var(--muted)'>불러오는 중…</p>";
    const orders = await fetchOrders(from, to);
    renderDayReport($("rangeResult"), orders);
  });
}

init();
