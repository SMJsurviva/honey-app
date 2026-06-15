/* Monk ordering view. All writes are synchronous-confirmation:
   the ORDER button only shows success after Supabase acknowledges the insert. */

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const els = {
  view: document.getElementById("orderView"),
  typeGrid: document.getElementById("typeGrid"),
  sizeGrid: document.getElementById("sizeGrid"),
  sizeLarge: document.getElementById("sizeLarge"),
  urgent: document.getElementById("urgentChk"),
  qtyInput: document.getElementById("qtyInput"),
  qtyMinus: document.getElementById("qtyMinus"),
  qtyPlus: document.getElementById("qtyPlus"),
  orderBtn: document.getElementById("orderBtn"),
  orderMsg: document.getElementById("orderMsg"),
  myOrdersSec: document.getElementById("myOrdersSec"),
  myOrders: document.getElementById("myOrders"),
  nameBtn: document.getElementById("nameBtn"),
  nameModal: document.getElementById("nameModal"),
  nameInput: document.getElementById("nameInput"),
  nameSave: document.getElementById("nameSave"),
  nameSkip: document.getElementById("nameSkip"),
  offline: document.getElementById("offlineBanner"),
};

const DEFAULT_TYPE = "벌꿀";
const DEFAULT_SIZE = 470;
const UNDO_SECONDS = 8;
const ORDER_TIMEOUT_MS = 15000;

let products = [];
let selType = null;
let selSize = null;
let undoTimer = null;

// ---- identity: device UUID is the real key, name is display text ----
function deviceId() {
  let id = localStorage.getItem("honey_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("honey_device_id", id);
  }
  return id;
}
function getName() { return localStorage.getItem("honey_name") || ""; }
function setName(name) { localStorage.setItem("honey_name", name); renderNameChip(); }
function nameAsked() { return localStorage.getItem("honey_name_asked") === "1"; }

function renderNameChip() {
  els.nameBtn.textContent = getName() || "이름 입력";
}

function openNameModal() {
  els.nameInput.value = getName();
  els.nameModal.hidden = false;
  els.nameInput.focus();
}
function closeNameModal() {
  localStorage.setItem("honey_name_asked", "1");
  els.nameModal.hidden = true;
}
els.nameBtn.addEventListener("click", openNameModal);
els.nameSave.addEventListener("click", () => { setName(els.nameInput.value.trim()); closeNameModal(); });
els.nameSkip.addEventListener("click", closeNameModal);

// ---- product grids ----
function fmtSize(g) {
  return g >= 1000 ? (g / 1000) + "kg" : g + "g";
}

function typeActive(t) { return products.some((p) => p.honey_type === t && p.active); }
function findProduct(t, s) { return products.find((p) => p.honey_type === t && p.size_g === s); }

function renderTypes() {
  const types = [...new Map(products.map((p) => [p.honey_type, p.sort])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map((e) => e[0]);
  els.typeGrid.innerHTML = "";
  for (const t of types) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gridbtn" + (t === selType ? " sel" : "");
    b.textContent = t;
    b.disabled = !typeActive(t);
    b.addEventListener("click", () => {
      selType = t;
      if (selSize && !(findProduct(t, selSize) || {}).active) selSize = null;
      renderTypes();
      renderSizes();
      updateOrderBtn();
    });
    els.typeGrid.appendChild(b);
  }
}

function renderSizes() {
  const sizes = [...new Set(products.map((p) => p.size_g))].sort((a, b) => a - b);
  const normal = sizes.filter((s) => s < 1000);
  const large = sizes.filter((s) => s >= 1000);

  function makeBtn(s) {
    const p = selType ? findProduct(selType, s) : null;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gridbtn" + (s === selSize ? " sel" : "");
    b.textContent = fmtSize(s);
    b.disabled = !p || !p.active;
    b.addEventListener("click", () => { selSize = s; renderSizes(); updateOrderBtn(); });
    return b;
  }

  els.sizeGrid.innerHTML = "";
  for (const s of normal) els.sizeGrid.appendChild(makeBtn(s));

  els.sizeLarge.innerHTML = "";
  for (const s of large) els.sizeLarge.appendChild(makeBtn(s));
}

function updateOrderBtn() {
  const p = selType && selSize ? findProduct(selType, selSize) : null;
  els.orderBtn.disabled = !(p && p.active) || !!undoTimer;
}

// ---- quantity ----
function qty() {
  const n = parseInt(els.qtyInput.value, 10);
  return Number.isFinite(n) ? Math.min(9999, Math.max(1, n)) : 1;
}
function setQty(n) { els.qtyInput.value = Math.min(9999, Math.max(1, n)); }
els.qtyMinus.addEventListener("click", () => setQty(qty() - 1));
els.qtyPlus.addEventListener("click", () => setQty(qty() + 1));
els.qtyInput.addEventListener("focus", () => els.qtyInput.select());

// ---- ordering ----
function showMsg(text, cls) {
  els.orderMsg.textContent = text;
  els.orderMsg.className = "ordermsg " + cls;
  els.orderMsg.hidden = false;
}

async function placeOrder() {
  const p = findProduct(selType, selSize);
  if (!p || !p.active) return;

  els.orderBtn.disabled = true;
  els.orderBtn.classList.add("busy");
  els.orderBtn.textContent = "전송 중…";
  els.orderMsg.hidden = true;

  let data, error;
  try {
    const result = await Promise.race([
      sb.from("orders").insert({
        device_id: deviceId(),
        requester_name: getName() || null,
        product_id: p.id,
        quantity: qty(),
        urgent: els.urgent.checked,
      }).select().single(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ORDER_TIMEOUT_MS)),
    ]);
    data = result.data;
    error = result.error;
  } catch (_) {
    els.orderBtn.classList.remove("busy");
    els.orderBtn.textContent = "주문하기";
    updateOrderBtn();
    showMsg("⚠️ 연결 시간이 초과되었습니다. 직접 말씀해 주세요.", "err");
    return;
  }

  els.orderBtn.classList.remove("busy");

  if (error || !data) {
    els.orderBtn.textContent = "주문하기";
    updateOrderBtn();
    showMsg("⚠️ 주문이 전송되지 않았습니다. 직접 말씀해 주세요.", "err");
    return;
  }

  showMsg(`✓ 주문이 접수되었습니다: ${p.display_label} × ${qty()}개`, "ok");
  els.urgent.checked = false;
  setQty(1);
  startUndoWindow(data.id);
  loadMyOrders();
}

function startUndoWindow(orderId) {
  let left = UNDO_SECONDS;
  els.orderBtn.classList.add("undo");
  els.orderBtn.disabled = false;
  els.orderBtn.textContent = `주문 취소 (${left})`;
  els.orderBtn.onclick = async () => {
    endUndoWindow();
    const { data } = await sb.rpc("cancel_order", { p_order_id: orderId, p_device_id: deviceId() });
    showMsg(data ? "주문이 취소되었습니다." : "이미 처리된 주문입니다.", data ? "ok" : "err");
    loadMyOrders();
  };
  undoTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) endUndoWindow();
    else els.orderBtn.textContent = `주문 취소 (${left})`;
  }, 1000);
}

function endUndoWindow() {
  clearInterval(undoTimer);
  undoTimer = null;
  els.orderBtn.classList.remove("undo");
  els.orderBtn.textContent = "주문하기";
  els.orderBtn.onclick = placeOrder;
  updateOrderBtn();
}

els.orderBtn.onclick = placeOrder;

// ---- my orders today ----
const STATUS_KO = { pending: "대기", in_process: "준비 중", done: "완료", cancelled: "취소됨" };

async function loadMyOrders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data, error } = await sb
    .from("orders")
    .select("id, created_at, urgent, status, quantity, products(display_label)")
    .eq("device_id", deviceId())
    .gte("created_at", today.toISOString())
    .order("created_at", { ascending: false });
  if (error || !data) return;

  els.myOrdersSec.hidden = data.length === 0;
  els.myOrders.innerHTML = "";
  for (const o of data) {
    const li = document.createElement("li");
    if (o.status === "cancelled") li.className = "cancelled";
    const time = new Date(o.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const left = document.createElement("div");
    left.innerHTML =
      `<div class="what">${o.products.display_label}${o.quantity > 1 ? " × " + o.quantity + "개" : ""}${o.urgent ? ' <span class="badge-urgent">급함</span>' : ""}</div>` +
      `<div class="meta">${time}</div>`;
    li.appendChild(left);

    if (o.status === "pending") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "smallbtn danger";
      btn.textContent = "취소";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const { data: ok } = await sb.rpc("cancel_order", { p_order_id: o.id, p_device_id: deviceId() });
        if (!ok) showMsg("이미 처리된 주문입니다.", "err");
        loadMyOrders();
      });
      li.appendChild(btn);
    } else {
      const s = document.createElement("span");
      s.className = "status " + o.status.replace("_", "-");
      s.textContent = STATUS_KO[o.status] || o.status;
      li.appendChild(s);
    }
    els.myOrders.appendChild(li);
  }
}

// ---- init ----
async function init() {
  renderNameChip();
  deviceId();
  if (!nameAsked()) openNameModal();

  const { data, error } = await sb.from("products").select("*").order("sort");
  if (error || !data || data.length === 0) {
    els.offline.hidden = false;
    return;
  }
  products = data;
  els.offline.hidden = true;
  els.view.hidden = false;

  selType = typeActive(DEFAULT_TYPE) ? DEFAULT_TYPE : null;
  const def = selType ? findProduct(selType, DEFAULT_SIZE) : null;
  selSize = def && def.active ? DEFAULT_SIZE : null;

  renderTypes();
  renderSizes();
  updateOrderBtn();
  loadMyOrders();
  setInterval(loadMyOrders, 60000);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
init();
