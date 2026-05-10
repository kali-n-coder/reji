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
  getFirestore,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where
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
  isAdmin: false
};

const $ = (selector) => document.querySelector(selector);
const productGrid = $("#productGrid");
const productTemplate = $("#productCardTemplate");
const cartList = $("#cartList");
const cartCount = $("#cartCount");
const cartTotal = $("#cartTotal");
const checkoutButton = $("#checkoutButton");
const checkoutMessage = $("#checkoutMessage");
const connectionStatus = $("#connectionStatus");
const adminLogin = $("#adminLogin");
const adminDashboard = $("#adminDashboard");
const logoutButton = $("#logoutButton");
const adminProducts = $("#adminProducts");
const recentOrders = $("#recentOrders");

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

  const productsQuery = includeInactive
    ? collection(db, "products")
    : query(collection(db, "products"), where("active", "==", true));

  unsubscribeProducts = onSnapshot(productsQuery, (snapshot) => {
    state.products = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
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
  const sellable = state.products.filter((product) => product.active !== false);
  productGrid.innerHTML = "";

  if (sellable.length === 0) {
    productGrid.innerHTML = '<p class="muted">販売中の商品がありません。管理者画面から追加してください。</p>';
    return;
  }

  sellable.forEach((product) => {
    const card = productTemplate.content.firstElementChild.cloneNode(true);
    const isSoldOut = Number(product.stock ?? 0) <= 0;
    card.classList.toggle("sold-out", isSoldOut);
    card.querySelector(".product-color").style.background = product.color || "#0f766e";
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent = `${product.description || "3Dプリンター作品"} / 在庫 ${product.stock ?? 0}`;
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
    $("#orderNote").value = "";
    renderCart();
    showMessage(checkoutMessage, "会計を保存しました。", "success");
  } catch (error) {
    showMessage(checkoutMessage, error.message, "error");
  } finally {
    checkoutButton.disabled = state.cart.size === 0;
  }
});

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

function renderAdminProducts() {
  if (!state.isAdmin) return;
  adminProducts.innerHTML = "";

  state.products.forEach((product) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(product.name)}</td>
      <td>${yen.format(product.price || 0)}</td>
      <td>${product.stock ?? 0}</td>
      <td>${product.active === false ? "停止中" : "販売中"}</td>
      <td>
        <button class="ghost-button" type="button" data-action="edit">編集</button>
        <button class="ghost-button" type="button" data-action="delete">削除</button>
      </td>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => editProduct(product));
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

async function removeProduct(productId) {
  if (!confirm("この商品を削除しますか？")) return;
  await deleteDoc(doc(db, "products", productId));
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
    const orders = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((order) => order.createdAt?.toDate && order.createdAt.toDate() >= start)
      .sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate());
    const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    $("#todayRevenue").textContent = yen.format(total);
    $("#todayOrders").textContent = `${orders.length}件`;

    recentOrders.innerHTML = orders.slice(0, 20).map((order) => {
      const time = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "--:--";
      const items = (order.items || []).map((item) => `${escapeHtml(item.name)} x ${item.quantity}`).join("、");
      return `
        <article class="order-card">
          <p><strong>${yen.format(order.total || 0)}</strong> <span class="muted">${time}</span></p>
          <p>${items}</p>
          <p class="muted">${paymentLabel(order.paymentMethod)} ${escapeHtml(order.note || "")}</p>
        </article>
      `;
    }).join("") || '<p class="muted">今日の注文はまだありません。</p>';
  });
}

function paymentLabel(value) {
  return {
    cash: "現金",
    paypay: "PayPay",
    other: "その他"
  }[value] || value;
}

function showMessage(element, text, type) {
  element.textContent = text;
  element.className = `message ${type || ""}`.trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
