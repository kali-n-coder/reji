import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0
});

const hasFirebaseConfig = !Object.values(firebaseConfig).some((value) => String(value).startsWith("YOUR_"));
const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
const db = app ? getFirestore(app) : null;
const auth = app ? getAuth(app) : null;

const state = {
  products: [],
  cart: new Map(),
  isAdmin: false,
  todayOrders: []
};

const $ = (selector) => document.querySelector(selector);
const productGrid = $("#productGrid");
const productSearch = $("#productSearch");
const productTemplate = $("#productCardTemplate");
const cartList = $("#cartList");
const cartCount = $("#cartCount");
const cartTotal = $("#cartTotal");
const cashReceived = $("#cashReceived");
const cashReceivedField = $("#cashReceivedField");
const changeDue = $("#changeDue");
const changeDueRow = $("#changeDueRow");
const checkoutButton = $("#checkoutButton");
const checkoutMessage = $("#checkoutMessage");
const connectionStatus = $("#connectionStatus");
const adminLogin = $("#adminLogin");
const adminDashboard = $("#adminDashboard");
const logoutButton = $("#logoutButton");
const adminProducts = $("#adminProducts");
const adminProductSearch = $("#adminProductSearch");
const adminProductFilter = $("#adminProductFilter");
const recentOrders = $("#recentOrders");
const orderSearch = $("#orderSearch");
const salesRanking = $("#salesRanking");
const downloadCsvButton = $("#downloadCsvButton");
const resetDataMessage = $("#resetDataMessage");

connectionStatus.textContent = hasFirebaseConfig ? "Firebase接続中" : "Firebase未設定";

let unsubscribeProducts = null;
if (hasFirebaseConfig) {
  subscribeProducts(false);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.isAdmin = false;
      subscribeProducts(false);
      if (unsubscribeOrders) {
        unsubscribeOrders();
        unsubscribeOrders = null;
      }
      adminLogin.classList.remove("hidden");
      adminDashboard.classList.add("hidden");
      logoutButton.classList.add("hidden");
      return;
    }

    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    state.isAdmin = adminDoc.exists();
    adminLogin.classList.toggle("hidden", state.isAdmin);
    adminDashboard.classList.toggle("hidden", !state.isAdmin);
    logoutButton.classList.toggle("hidden", !state.isAdmin);

    if (!state.isAdmin) {
      showMessage($("#loginMessage"), "管理者として登録されていないアカウントです。", "error");
      await signOut(auth);
      return;
    }

    subscribeProducts(true);
    subscribeOrders();
  });
} else {
  state.products = [
    { id: "demo-keychain", name: "キーホルダー", price: 300, stock: 12, color: "#0f766e", description: "名前入りにしやすい定番", active: true },
    { id: "demo-stand", name: "スマホスタンド", price: 500, stock: 8, color: "#2563eb", description: "机で使える実用品", active: true },
    { id: "demo-figure", name: "ミニフィギュア", price: 400, stock: 10, color: "#c2410c", description: "文化祭限定カラー", active: true }
  ];
  renderProducts();
  renderCart();
  checkoutButton.disabled = true;
  showMessage(checkoutMessage, "Firebase設定を入れると会計を保存できます。", "error");
  showMessage($("#loginMessage"), "firebase-config.js を設定すると管理者ログインできます。", "error");
}

function subscribeProducts(includeInactive) {
  if (unsubscribeProducts) unsubscribeProducts();

  unsubscribeProducts = onSnapshot(collection(db, "products"), (snapshot) => {
    state.products = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((product) => includeInactive || product.active === true)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ja"));
    renderProducts();
    renderCart();
    renderAdminProducts();
    connectionStatus.textContent = "Firebase接続済み";
    connectionStatus.classList.add("ready");
  }, (error) => {
    connectionStatus.textContent = "Firebase設定を確認";
    showMessage(checkoutMessage, error.message, "error");
  });
}

function renderProducts() {
  const term = normalizeText(productSearch.value);
  const sellable = state.products.filter((product) => {
    if (product.active === false) return false;
    if (!term) return true;
    return normalizeText(`${product.name || ""} ${product.description || ""}`).includes(term);
  });
  productGrid.innerHTML = "";

  if (sellable.length === 0) {
    productGrid.innerHTML = '<p class="muted">販売中の商品がありません。管理者画面から追加してください。</p>';
    return;
  }

  sellable.forEach((product) => {
    const card = productTemplate.content.firstElementChild.cloneNode(true);
    const stock = Number(product.stock ?? 0);
    const isSoldOut = stock <= 0;
    const isLowStock = stock > 0 && stock <= 3;
    card.classList.toggle("sold-out", isSoldOut);
    card.classList.toggle("low-stock", isLowStock);
    card.querySelector(".product-color").style.background = product.color || "#0f766e";
    const badge = card.querySelector(".stock-badge");
    badge.textContent = isSoldOut ? "売り切れ" : isLowStock ? `残り${stock}個` : "販売中";
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent = `${product.description || "3Dプリンター作品"} / 在庫 ${stock}`;
    card.querySelector("strong").textContent = yen.format(product.price || 0);
    const button = card.querySelector("button");
    button.disabled = isSoldOut;
    button.textContent = isSoldOut ? "売り切れ" : "追加";
    button.addEventListener("click", () => addToCart(product.id));
    productGrid.append(card);
  });
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const current = state.cart.get(productId) || 0;
  if (current >= Number(product.stock ?? 0)) {
    showMessage(checkoutMessage, "在庫数を超えて追加できません。", "error");
    return;
  }

  state.cart.set(productId, current + 1);
  renderCart();
}

function renderCart() {
  cartList.innerHTML = "";
  let totalItems = 0;
  let totalPrice = 0;

  if (state.cart.size === 0) {
    cartList.innerHTML = '<p class="muted">商品をタップするとここに入ります。</p>';
  }

  state.cart.forEach((quantity, productId) => {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;
    totalItems += quantity;
    totalPrice += quantity * Number(product.price || 0);

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <p class="muted">${yen.format(product.price || 0)} x ${quantity}</p>
      </div>
      <div class="quantity-tools">
        <button type="button" aria-label="${escapeHtml(product.name)}を減らす">-</button>
        <span>${quantity}</span>
        <button type="button" aria-label="${escapeHtml(product.name)}を増やす">+</button>
      </div>
    `;

    const [decreaseButton, increaseButton] = row.querySelectorAll("button");
    decreaseButton.addEventListener("click", () => updateQuantity(productId, quantity - 1));
    increaseButton.addEventListener("click", () => updateQuantity(productId, quantity + 1));
    cartList.append(row);
  });

  cartCount.textContent = `${totalItems}点`;
  cartTotal.textContent = yen.format(totalPrice);
  updateChangeDue(totalPrice);
  checkoutButton.disabled = totalItems === 0 || !hasFirebaseConfig;
}

function updateQuantity(productId, quantity) {
  if (quantity <= 0) {
    state.cart.delete(productId);
  } else {
    const product = state.products.find((item) => item.id === productId);
    state.cart.set(productId, Math.min(quantity, Number(product?.stock ?? quantity)));
  }
  renderCart();
}

checkoutButton.addEventListener("click", async () => {
  if (!hasFirebaseConfig) return;
  if (state.cart.size === 0) return;
  if (!confirm(`${cartCount.textContent}、合計 ${cartTotal.textContent} で会計を保存しますか？`)) return;
  checkoutButton.disabled = true;

  try {
    const orderItems = [];
    let total = 0;

    const orderRef = doc(collection(db, "orders"));

    await runTransaction(db, async (transaction) => {
      for (const [productId, quantity] of state.cart.entries()) {
        const ref = doc(db, "products", productId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error("商品が見つかりません。");

        const product = snapshot.data();
        if (Number(product.stock ?? 0) < quantity) {
          throw new Error(`${product.name} の在庫が足りません。`);
        }

        const price = Number(product.price || 0);
        orderItems.push({ productId, name: product.name, price, quantity, subtotal: price * quantity });
        total += price * quantity;
        transaction.update(ref, { stock: increment(-quantity) });
      }

      transaction.set(orderRef, {
        items: orderItems,
        total,
        paymentMethod: $("#paymentMethod").value,
        note: $("#orderNote").value.trim(),
        createdAt: serverTimestamp()
      });
    });

    state.cart.clear();
    cashReceived.value = "";
    $("#orderNote").value = "";
    renderCart();
    showMessage(checkoutMessage, "会計を保存しました。", "success");
  } catch (error) {
    showMessage(checkoutMessage, friendlyError(error), "error");
  } finally {
    checkoutButton.disabled = state.cart.size === 0 || !hasFirebaseConfig;
  }
});

cashReceived.addEventListener("input", () => renderCart());
$("#paymentMethod").addEventListener("change", updatePaymentFields);
updatePaymentFields();
productSearch.addEventListener("input", renderProducts);
adminProductSearch.addEventListener("input", renderAdminProducts);
adminProductFilter.addEventListener("change", renderAdminProducts);
orderSearch.addEventListener("input", renderOrders);
downloadCsvButton.addEventListener("click", downloadOrdersCsv);

$("#clearCartButton").addEventListener("click", () => {
  state.cart.clear();
  renderCart();
});

$("#loginButton").addEventListener("click", async () => {
  if (!hasFirebaseConfig) return;
  try {
    await signInWithEmailAndPassword(auth, $("#adminEmail").value.trim(), $("#adminPassword").value);
    showMessage($("#loginMessage"), "", "");
  } catch (error) {
    showMessage($("#loginMessage"), error.message, "error");
  }
});

logoutButton.addEventListener("click", () => signOut(auth));

$("#productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.isAdmin) return;

  const id = $("#productId").value;
  const payload = {
    name: $("#productName").value.trim(),
    price: Number($("#productPrice").value),
    stock: Number($("#productStock").value),
    color: $("#productColor").value,
    description: $("#productDescription").value.trim(),
    active: $("#productActive").checked,
    updatedAt: serverTimestamp()
  };

  if (!payload.name) return;
  const ref = id ? doc(db, "products", id) : doc(collection(db, "products"));
  await setDoc(ref, id ? payload : { ...payload, createdAt: serverTimestamp() }, { merge: true });
  resetProductForm();
});

$("#resetProductFormButton").addEventListener("click", resetProductForm);
$("#resetAllDataButton").addEventListener("click", resetAllData);

function renderAdminProducts() {
  if (!state.isAdmin) return;
  adminProducts.innerHTML = "";

  const term = normalizeText(adminProductSearch.value);
  const filter = adminProductFilter.value;
  const products = state.products.filter((product) => {
    if (term && !normalizeText(product.name || "").includes(term)) return false;
    if (filter === "active") return product.active !== false;
    if (filter === "inactive") return product.active === false;
    if (filter === "soldout") return Number(product.stock || 0) <= 0;
    return true;
  });

  if (products.length === 0) {
    adminProducts.innerHTML = '<tr><td colspan="5" class="muted">表示できる商品がありません。</td></tr>';
    return;
  }

  products.forEach((product) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(product.name)}</td>
      <td>${yen.format(product.price || 0)}</td>
      <td>${product.stock ?? 0}</td>
      <td>${product.active === false ? "停止中" : "販売中"}</td>
      <td>
        <button class="ghost-button" type="button" data-action="edit">編集</button>
        <button class="ghost-button" type="button" data-action="copy">コピー</button>
        <button class="ghost-button" type="button" data-action="delete">削除</button>
      </td>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => editProduct(product));
    row.querySelector('[data-action="copy"]').addEventListener("click", () => copyProduct(product));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => removeProduct(product.id));
    adminProducts.append(row);
  });
}

function editProduct(product) {
  $("#productId").value = product.id;
  $("#productName").value = product.name || "";
  $("#productPrice").value = product.price || 0;
  $("#productStock").value = product.stock || 0;
  $("#productColor").value = product.color || "#0f766e";
  $("#productDescription").value = product.description || "";
  $("#productActive").checked = product.active !== false;
  $("#productName").focus();
}

function copyProduct(product) {
  editProduct({ ...product, id: "", name: `${product.name || ""} コピー`, stock: 0, active: false });
}

async function removeProduct(productId) {
  if (!confirm("この商品を削除しますか？")) return;
  await deleteDoc(doc(db, "products", productId));
}

async function resetAllData() {
  if (!state.isAdmin) return;

  const button = $("#resetAllDataButton");
  button.disabled = true;
  showMessage(resetDataMessage, "削除するデータ数を確認中です...", "");

  try {
    const [productsSnapshot, ordersSnapshot] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "orders"))
    ]);
    const typed = prompt(`商品 ${productsSnapshot.size} 件、購入データ ${ordersSnapshot.size} 件を削除します。実行するには「削除」と入力してください。`);

    if (typed !== "削除") {
      showMessage(resetDataMessage, "初期化をキャンセルしました。", "");
      return;
    }

    showMessage(resetDataMessage, "削除中です...", "");
    await deleteSnapshotDocs(productsSnapshot);
    await deleteSnapshotDocs(ordersSnapshot);
    state.cart.clear();
    renderCart();
    resetProductForm();
    showMessage(resetDataMessage, "商品データと購入データを削除しました。", "success");
  } catch (error) {
    showMessage(resetDataMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteSnapshotDocs(snapshot) {
  let batch = writeBatch(db);
  let operationCount = 0;

  for (const item of snapshot.docs) {
    batch.delete(item.ref);
    operationCount += 1;

    if (operationCount === 450) {
      await batch.commit();
      batch = writeBatch(db);
      operationCount = 0;
    }
  }

  if (operationCount > 0) {
    await batch.commit();
  }
}

function resetProductForm() {
  $("#productForm").reset();
  $("#productId").value = "";
  $("#productColor").value = "#0f766e";
  $("#productActive").checked = true;
}

let unsubscribeOrders = null;
function subscribeOrders() {
  if (unsubscribeOrders) return;

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  unsubscribeOrders = onSnapshot(collection(db, "orders"), (snapshot) => {
    state.todayOrders = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((order) => order.createdAt?.toDate && order.createdAt.toDate() >= start)
      .sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate());
    renderOrders();
  });
}

function renderOrders() {
  if (!state.isAdmin) return;

  const orders = state.todayOrders;
  const term = normalizeText(orderSearch.value);
  const visibleOrders = orders.filter((order) => {
    if (!term) return true;
    const items = (order.items || []).map((item) => item.name).join(" ");
    return normalizeText(`${items} ${order.note || ""} ${paymentLabel(order.paymentMethod)}`).includes(term);
  });

    const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    $("#todayRevenue").textContent = yen.format(total);
    $("#todayOrders").textContent = `${orders.length}件`;
    renderSalesRanking(orders);

    recentOrders.innerHTML = visibleOrders.slice(0, 30).map((order) => {
      const time = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "--:--";
      const items = (order.items || []).map((item) => `${escapeHtml(item.name)} x ${item.quantity}`).join("、");
      return `
        <article class="order-card">
          <p><strong>${yen.format(order.total || 0)}</strong> <span class="muted">${time}</span></p>
          <p>${items}</p>
          <p class="muted">${paymentLabel(order.paymentMethod)} ${escapeHtml(order.note || "")}</p>
        </article>
      `;
    }).join("") || '<p class="muted">表示できる注文がありません。</p>';
}

function renderSalesRanking(orders) {
  const totals = new Map();

  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const current = totals.get(item.name) || { quantity: 0, revenue: 0 };
      current.quantity += Number(item.quantity || 0);
      current.revenue += Number(item.subtotal || 0);
      totals.set(item.name, current);
    });
  });

  const ranking = [...totals.entries()]
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 5);

  salesRanking.innerHTML = ranking.map(([name, item], index) => `
    <div class="ranking-item">
      <span>${index + 1}</span>
      <strong>${escapeHtml(name)}</strong>
      <small>${item.quantity}個 / ${yen.format(item.revenue)}</small>
    </div>
  `).join("") || '<p class="muted">商品別ランキングはまだありません。</p>';
}

function paymentLabel(value) {
  return {
    cash: "現金",
    other: "その他"
  }[value] || value;
}

function downloadOrdersCsv() {
  if (state.todayOrders.length === 0) {
    showMessage(resetDataMessage, "保存できる購入データがまだありません。", "");
    return;
  }

  const rows = [["時間", "商品", "数量", "小計", "支払い方法", "メモ", "注文合計"]];
  state.todayOrders.forEach((order) => {
    const time = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString("ja-JP") : "";
    (order.items || []).forEach((item) => {
      rows.push([
        time,
        item.name || "",
        item.quantity || 0,
        item.subtotal || 0,
        paymentLabel(order.paymentMethod),
        order.note || "",
        order.total || 0
      ]);
    });
  });

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeText(value) {
  return String(value).trim().toLowerCase();
}

function updateChangeDue(totalPrice) {
  const received = Number(cashReceived.value || 0);
  const change = Math.max(received - totalPrice, 0);
  changeDue.textContent = yen.format(change);
  changeDue.classList.toggle("short", received > 0 && received < totalPrice);
}

function updatePaymentFields() {
  const isCash = $("#paymentMethod").value === "cash";
  cashReceivedField.classList.toggle("hidden", !isCash);
  changeDueRow.classList.toggle("hidden", !isCash);
  if (!isCash) {
    cashReceived.value = "";
    updateChangeDue(0);
  }
}

function showMessage(element, text, type) {
  element.textContent = text;
  element.className = `message ${type || ""}`.trim();
}

function friendlyError(error) {
  const message = error?.message || "";
  if (message.includes("permission") || message.includes("Missing or insufficient permissions")) {
    return "保存できませんでした。ログイン状態やFirebaseルールを確認してください。";
  }
  if (message.includes("在庫が足りません")) {
    return message;
  }
  if (message.includes("offline") || message.includes("network")) {
    return "ネット接続が不安定です。接続を確認してもう一度試してください。";
  }
  return message || "うまく保存できませんでした。もう一度試してください。";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
