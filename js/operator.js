/* Operator view. Authenticated via Supabase Auth (no service key in client).
   Realtime subscription + 30s polling fallback — orders must never be missed. */

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const els = {
  loginView: $("loginView"), opView: $("opView"),
  loginEmail: $("loginEmail"), loginPw: $("loginPw"), loginBtn: $("loginBtn"), loginErr: $("loginErr"),
  logoutBtn: $("logoutBtn"),
  pendingList: $("pendingList"), pendingEmpty: $("pendingEmpty"), pendingCount: $("pendingCount"),
  inProcessSec: $("inProcessSec"), inProcessList: $("inProcessList"), inProcessCount: $("inProcessCount"),
  cancelledSec: $("cancelledSec"), cancelledList: $("cancelledList"),
  doneList: $("doneList"), doneCount: $("doneCount"),
  stockList: $("stockList"),
  verbalBtn: $("verbalBtn"), verbalModal: $("verbalModal"),
  vName: $("vName"), vProduct: $("vProduct"), vUrgent: $("vUrgent"), vSave: $("vSave"), vCancel: $("vCancel"),
  vQty: $("vQty"), vQtyMinus: $("vQtyMinus"), vQtyPlus: $("vQtyPlus"),
  notifBtn: $("notifBtn"),
  offline: $("offlineBanner"),
};

let products = [];

// ---- auth ----
async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) enter();
  else { els.loginView.hidden = false; els.opView.hidden = true; els.logoutBtn.hidden = true; }
}

els.loginBtn.addEventListener("click", async () => {
  els.loginErr.hidden = true;
  els.loginBtn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: els.loginEmail.value.trim(),
    password: els.loginPw.value,
  });
  els.loginBtn.disabled = false;
  if (error) {
    els.loginErr.textContent = "로그인에 실패했습니다.";
    els.loginErr.hidden = false;
    return;
  }
  enter();
});

els.logoutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

// ---- main ----
async function enter() {
  els.loginView.hidden = true;
  els.opView.hidden = false;
  els.logoutBtn.hidden = false;
  await loadProducts();
  await refresh();
  setupStockListener();
  await renderStock();
  subscribeRealtime();
  setInterval(refresh, 30000); // polling fallback — Realtime can degrade independently
  requestWakeLock();
  setupPush();
  catchUpNotify();
}

async function loadProducts() {
  const { data } = await sb.from("products").select("*").order("sort");
  if (data) products = data;
  renderVerbalOptions();
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function orderCard(o, buttons) {
  const card = document.createElement("div");
  card.className = "card"
    + (o.urgent && o.status === "pending" ? " urgent" : "")
    + (o.status === "in_process" ? " in-process" : "")
    + (o.status === "cancelled" ? " cancelled" : "");

  const left = document.createElement("div");
  const qtyStr = o.quantity >= 10
    ? `<span class="badge-qty">× ${o.quantity}개</span>`
    : (o.quantity > 1 ? ` × ${o.quantity}개` : "");
  left.innerHTML =
    `<div class="who">${o.requester_name || "이름 없음"}${o.verbal ? " (구두)" : ""}</div>` +
    `<div class="what">${o.products.display_label}${qtyStr}${o.urgent ? ' <span class="badge-urgent">급함</span>' : ""}</div>` +
    `<div class="meta">${fmtTime(o.created_at)}</div>`;
  card.appendChild(left);

  const right = document.createElement("div");
  right.style.cssText = "display:flex;gap:8px;flex-shrink:0";
  for (const b of buttons) right.appendChild(b);
  card.appendChild(right);
  return card;
}

function btn(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "smallbtn " + cls;
  b.textContent = label;
  b.addEventListener("click", async () => { b.disabled = true; await fn(); });
  return b;
}

async function refresh() {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await sb
    .from("orders")
    .select("*, products(display_label)")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error || !data) { els.offline.hidden = false; return; }
  els.offline.hidden = true;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const pending = data.filter((o) => o.status === "pending")
    .sort((a, b) => (b.urgent - a.urgent) || (new Date(a.created_at) - new Date(b.created_at)));
  const inProcess = data.filter((o) => o.status === "in_process")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  // Cancelled orders stay visible until dismissed — this is the Bug #5 fix:
  // a cancellation must be a loud event in the queue, never a silent disappearance.
  const cancelled = data.filter((o) => o.status === "cancelled" && !o.dismissed);
  const doneToday = data.filter((o) => o.status === "done" && new Date(o.created_at) >= today);

  // ---- pending ----
  els.pendingList.innerHTML = "";
  for (const o of pending) {
    els.pendingList.appendChild(orderCard(o, [
      btn("준비 중", "process", async () => {
        await sb.from("orders").update({ status: "in_process" }).eq("id", o.id);
        refresh();
      }),
      btn("✓ 완료", "good", async () => {
        await sb.from("orders").update({ status: "done" }).eq("id", o.id);
        refresh();
      }),
    ]));
  }
  els.pendingCount.textContent = pending.length ? `(${pending.length})` : "";
  els.pendingEmpty.hidden = pending.length > 0;

  // ---- in process ----
  els.inProcessList.innerHTML = "";
  for (const o of inProcess) {
    els.inProcessList.appendChild(orderCard(o, [
      btn("되돌리기", "", async () => {
        await sb.from("orders").update({ status: "pending" }).eq("id", o.id);
        refresh();
      }),
      btn("✓ 완료", "good", async () => {
        await sb.from("orders").update({ status: "done" }).eq("id", o.id);
        refresh();
      }),
    ]));
  }
  els.inProcessSec.hidden = inProcess.length === 0;
  els.inProcessCount.textContent = inProcess.length ? `(${inProcess.length})` : "";

  // ---- cancelled ----
  els.cancelledList.innerHTML = "";
  for (const o of cancelled) {
    els.cancelledList.appendChild(orderCard(o, [
      btn("확인", "", async () => {
        await sb.from("orders").update({ dismissed: true }).eq("id", o.id);
        refresh();
      }),
    ]));
  }
  els.cancelledSec.hidden = cancelled.length === 0;

  // ---- done today ----
  els.doneList.innerHTML = "";
  for (const o of doneToday.reverse()) els.doneList.appendChild(orderCard(o, []));
  els.doneCount.textContent = `(${doneToday.length})`;
}

// ---- realtime ----
function subscribeRealtime() {
  sb.channel("orders-feed")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => refresh())
    .subscribe();
}

// ---- pre-poured stock ----
function setupStockListener() {
  els.stockList.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-delta]");
    if (!button) return;
    const pid = parseInt(button.dataset.id, 10);
    const delta = parseInt(button.dataset.delta, 10);
    const countEl = els.stockList.querySelector(`.stock-count[data-id="${pid}"]`);
    if (!countEl) return;
    const next = Math.max(0, parseInt(countEl.textContent, 10) + delta);
    countEl.textContent = next;
    await sb.from("stock").update({ ready_count: next }).eq("product_id", pid);
  });
}

async function renderStock() {
  if (!els.stockList) return;
  const { data, error } = await sb
    .from("stock")
    .select("product_id, ready_count, products(display_label)")
    .order("product_id");
  if (error || !data) {
    // stock table not yet created — show placeholder until migration is run
    els.stockList.innerHTML = "<p class='meta' style='color:var(--muted);padding:8px 0'>재고 정보를 불러올 수 없습니다.</p>";
    return;
  }
  els.stockList.innerHTML = "";
  for (const s of data) {
    const row = document.createElement("div");
    row.className = "stockrow";
    row.innerHTML =
      `<span>${s.products.display_label}</span>` +
      `<div style="display:flex;align-items:center;gap:8px">` +
        `<button class="qtybtn" type="button" data-id="${s.product_id}" data-delta="-1">−</button>` +
        `<span class="stock-count" data-id="${s.product_id}">${s.ready_count}</span>` +
        `<button class="qtybtn" type="button" data-id="${s.product_id}" data-delta="1">＋</button>` +
      `</div>`;
    els.stockList.appendChild(row);
  }
}

// ---- verbal order entry ----
function renderVerbalOptions() {
  els.vProduct.innerHTML = "";
  for (const p of products.filter((p) => p.active)) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.display_label;
    if (p.honey_type === "벌꿀" && p.size_g === 470) opt.selected = true;
    els.vProduct.appendChild(opt);
  }
}

function vQtyVal() {
  const n = parseInt(els.vQty.value, 10);
  return Number.isFinite(n) ? Math.min(9999, Math.max(1, n)) : 1;
}
els.vQtyMinus.addEventListener("click", () => { els.vQty.value = Math.max(1, vQtyVal() - 1); });
els.vQtyPlus.addEventListener("click", () => { els.vQty.value = Math.min(9999, vQtyVal() + 1); });

els.verbalBtn.addEventListener("click", () => { els.verbalModal.hidden = false; });
els.vCancel.addEventListener("click", () => { els.verbalModal.hidden = true; });
els.vSave.addEventListener("click", async () => {
  els.vSave.disabled = true;
  const { error } = await sb.from("orders").insert({
    device_id: "00000000-0000-0000-0000-000000000000", // operator-entered, no monk device
    requester_name: els.vName.value.trim() || null,
    product_id: Number(els.vProduct.value),
    quantity: vQtyVal(),
    urgent: els.vUrgent.checked,
    verbal: true,
  });
  els.vSave.disabled = false;
  if (!error) {
    els.verbalModal.hidden = true;
    els.vName.value = "";
    els.vQty.value = 1;
    els.vUrgent.checked = false;
    refresh();
  }
});

// ---- wake lock ----
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      await navigator.wakeLock.request("screen");
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") navigator.wakeLock.request("screen").catch(() => {});
      });
    }
  } catch (_) { /* not critical */ }
}

// ---- catch-up: local notification for orders missed while subscription was down ----
async function catchUpNotify() {
  if (Notification.permission !== "granted") return;
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // last 2h
  const { data } = await sb.from("orders")
    .select("id")
    .eq("status", "pending")
    .gt("created_at", since);
  if (!data?.length) return;
  const n = data.length;
  new Notification(`🍯 미확인 주문 ${n}개`, {
    body: "앱을 열고 확인하세요",
    icon: "icons/icon-192.png",
    tag: "honey-catchup",
  });
}

// ---- web push (Phase 4 — active once VAPID_PUBLIC_KEY is set) ----
function urlB64ToUint8Array(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function showPushError() {
  els.notifBtn.textContent = "🔔 알림 오류 — 탭하여 재시도";
  els.notifBtn.classList.add("danger");
  els.notifBtn.hidden = false;
}

async function subscribePush(reg) {
  try {
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY),
    });
    await sb.from("operator_subscriptions").delete().neq("id", 0);
    await sb.from("operator_subscriptions").insert({ subscription: sub.toJSON() });
    els.notifBtn.hidden = true;
    els.notifBtn.textContent = "🔔 알림 켜기";
    els.notifBtn.classList.remove("danger");
  } catch (err) {
    console.error("Push subscription failed:", err);
    showPushError();
  }
}

async function setupPush() {
  if (!CONFIG.VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  let reg;
  try { reg = await navigator.serviceWorker.register("sw.js"); }
  catch (err) { console.error("SW registration failed:", err); return; }

  // Retry handler covers both first-time enable and error-state tap-to-retry
  els.notifBtn.addEventListener("click", async () => {
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    await subscribePush(reg);
  });

  if (Notification.permission === "denied") return;
  if (Notification.permission === "granted") await subscribePush(reg);
  else { els.notifBtn.textContent = "🔔 알림 켜기"; els.notifBtn.hidden = false; }
}

// Handle push subscription rotation from the service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", async (e) => {
    if (e.data?.type === "push-resubscribe") {
      try {
        await sb.from("operator_subscriptions").delete().neq("id", 0);
        await sb.from("operator_subscriptions").insert({ subscription: e.data.sub });
      } catch (_) {}
    } else if (e.data?.type === "push-failed") {
      showPushError();
    }
  });
}

// One-time Samsung battery optimization reminder when running as installed PWA
(function () {
  if (window.matchMedia("(display-mode: standalone)").matches && !localStorage.getItem("honey_pwa_battery_ok")) {
    const warn = document.getElementById("pwaBatteryWarning");
    if (warn) warn.hidden = false;
  }
})();

window.dismissPwaWarning = function () {
  const warn = document.getElementById("pwaBatteryWarning");
  if (warn) warn.hidden = true;
  localStorage.setItem("honey_pwa_battery_ok", "1");
};

sb.auth.onAuthStateChange(() => {});
checkAuth();
