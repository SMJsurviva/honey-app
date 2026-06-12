/* Operator view. Authenticated via Supabase Auth (no service key in client).
   Realtime subscription + 30s polling fallback — orders must never be missed. */

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const els = {
  loginView: $("loginView"), opView: $("opView"),
  loginEmail: $("loginEmail"), loginPw: $("loginPw"), loginBtn: $("loginBtn"), loginErr: $("loginErr"),
  logoutBtn: $("logoutBtn"),
  pendingList: $("pendingList"), pendingEmpty: $("pendingEmpty"), pendingCount: $("pendingCount"),
  cancelledSec: $("cancelledSec"), cancelledList: $("cancelledList"),
  doneList: $("doneList"), doneCount: $("doneCount"),
  productList: $("productList"),
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
  subscribeRealtime();
  setInterval(refresh, 30000); // polling fallback — Realtime can degrade independently
  requestWakeLock();
  setupPush();
}

async function loadProducts() {
  const { data } = await sb.from("products").select("*").order("sort");
  if (data) products = data;
  renderProducts();
  renderVerbalOptions();
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function orderCard(o, buttons) {
  const card = document.createElement("div");
  card.className = "card" + (o.urgent && o.status === "pending" ? " urgent" : "") + (o.status === "cancelled" ? " cancelled" : "");
  const left = document.createElement("div");
  left.innerHTML =
    `<div class="who">${o.requester_name || "이름 없음"}${o.verbal ? " (구두)" : ""}</div>` +
    `<div class="what">${o.products.display_label}${o.quantity > 1 ? " × " + o.quantity + "개" : ""}${o.urgent ? ' <span class="badge-urgent">급함</span>' : ""}</div>` +
    `<div class="meta">${fmtTime(o.created_at)}</div>`;
  card.appendChild(left);
  const right = document.createElement("div");
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
  // Cancelled orders stay visible until dismissed — this is the Bug #5 fix:
  // a cancellation must be a loud event in the queue, never a silent disappearance.
  const cancelled = data.filter((o) => o.status === "cancelled" && !o.dismissed);
  const doneToday = data.filter((o) => o.status === "done" && new Date(o.created_at) >= today);

  els.pendingList.innerHTML = "";
  for (const o of pending) {
    els.pendingList.appendChild(orderCard(o, [
      btn("✓ 완료", "good", async () => {
        await sb.from("orders").update({ status: "done" }).eq("id", o.id);
        refresh();
      }),
    ]));
  }
  els.pendingCount.textContent = pending.length ? `(${pending.length})` : "";
  els.pendingEmpty.hidden = pending.length > 0;

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

// ---- product stockout toggles ----
function renderProducts() {
  els.productList.innerHTML = "";
  for (const p of products) {
    const row = document.createElement("div");
    row.className = "togglerow" + (p.active ? "" : " off");
    const label = document.createElement("span");
    label.textContent = p.display_label;
    row.appendChild(label);
    row.appendChild(btn(p.active ? "판매 중" : "품절", p.active ? "good" : "danger", async () => {
      await sb.from("products").update({ active: !p.active }).eq("id", p.id);
      await loadProducts();
    }));
    els.productList.appendChild(row);
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

// ---- web push (Phase 4 — active once VAPID_PUBLIC_KEY is set) ----
function urlB64ToUint8Array(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function setupPush() {
  if (!CONFIG.VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const reg = await navigator.serviceWorker.register("sw.js");
  if (Notification.permission === "granted") return subscribePush(reg);
  els.notifBtn.hidden = false;
  els.notifBtn.addEventListener("click", async () => {
    const perm = await Notification.requestPermission();
    if (perm === "granted") { await subscribePush(reg); els.notifBtn.hidden = true; }
  });
}

async function subscribePush(reg) {
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY),
  });
  // keep a single row — replace any previous subscription
  await sb.from("operator_subscriptions").delete().neq("id", 0);
  await sb.from("operator_subscriptions").insert({ subscription: sub.toJSON() });
}

sb.auth.onAuthStateChange(() => {});
checkAuth();
