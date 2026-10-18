const queryParams = new URLSearchParams(window.location.search);
const hadCredentialsInUrl = queryParams.has("email") || queryParams.has("password");
if (hadCredentialsInUrl) {
  queryParams.delete("email");
  queryParams.delete("password");
  const remainingQuery = queryParams.toString();
  const safeUrl = `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}${window.location.hash}`;
  window.history.replaceState(null, document.title, safeUrl);
}

const CONFIG = window.STORE_CONFIG || {};
const CONFIG_READY = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseUrl.startsWith("https://") && !CONFIG.supabaseUrl.includes("YOUR-PROJECT") && CONFIG.supabasePublishableKey && !CONFIG.supabasePublishableKey.includes("YOUR_SUPABASE") && window.supabase?.createClient);
// The Supabase CDN also exposes a global named `supabase`; avoid a top-level
// lexical declaration with that name because it stops this whole script from parsing.
const supabaseClient = CONFIG_READY ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey) : null;
const CATEGORY_LABELS = { classic: "CLASSIC", sweet: "A LITTLE SWEET", savory: "SAVORY" };
const CATEGORY_CLASSES = { classic: "art-yellow", sweet: "art-pink", savory: "art-green" };
let products = [];
let cart = {};
let currentFilter = "all";
let currentUser = null;
let ownerMode = false;

const productGrid = document.querySelector(".product-grid");
const managedProducts = document.querySelector(".managed-products");
const productForm = document.querySelector(".product-form");
const cartPanel = document.querySelector(".cart-panel");
const backdrop = document.querySelector(".cart-backdrop");
const cartItems = document.querySelector(".cart-items");
const cartCount = document.querySelector(".cart-count");
const cartTotal = document.querySelector(".cart-total");
const cartEmpty = document.querySelector(".cart-empty");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function price(value) { return `₹${Number(value).toLocaleString("en-IN")}`; }
function authMessage(form, message, isError = false) {
  const node = form.querySelector(".auth-message");
  node.textContent = message;
  node.classList.toggle("error", isError);
}
function setAuthForm(active) {
  document.querySelectorAll(".email-login-form, .email-signup-form, .email-confirmation").forEach((form) => { form.hidden = form !== active; });
  const signupActive = active === document.querySelector(".email-signup-form");
  const confirmationActive = active === document.querySelector(".email-confirmation");
  document.querySelector("#auth-title").textContent = signupActive ? "Create your retailer account" : confirmationActive ? "Check your email" : "Welcome back";
  document.querySelector(".auth-intro").textContent = signupActive
    ? "Add your shop and delivery details, then create your account."
    : confirmationActive
      ? "Follow the instructions shown below to finish signing up."
      : "Sign in to browse products and place retailer orders.";
  document.querySelector(".auth-fineprint").hidden = !signupActive;
}

function loadCart() {
  try { cart = JSON.parse(localStorage.getItem(`sunny-chips-cart-${currentUser.id}`) || "{}"); }
  catch { cart = {}; }
}
function saveCart() { localStorage.setItem(`sunny-chips-cart-${currentUser.id}`, JSON.stringify(cart)); }

async function showStore(session) {
  currentUser = session.user;
  document.body.classList.add("signed-in");
  document.querySelector(".signed-in-identity").textContent = currentUser.email || "Signed in";
  document.querySelector("#auth-screen").hidden = true;
  const profile = currentUser.user_metadata || {};
  const checkout = document.querySelector(".checkout-form");
  checkout.elements.name.value = profile.full_name || "";
  checkout.elements.businessName.value = profile.business_name || "";
  checkout.elements.email.value = currentUser.email || "";
  checkout.elements.phone.value = profile.phone || "";
  checkout.elements.address.value = profile.delivery_address || "";
  loadCart();
  await checkOwnerAccess();
  renderCart();
}

function showLogin(message = "") {
  currentUser = null;
  ownerMode = false;
  document.querySelector(".owner-dashboard-link").hidden = true;
  document.body.classList.remove("signed-in");
  document.querySelector(".admin-controls").hidden = true;
  document.querySelector(".product-manager").hidden = true;
  document.querySelector("#auth-screen").hidden = false;
  setAuthForm(document.querySelector(".email-login-form"));
  if (message) authMessage(document.querySelector(".email-login-form"), message);
}

async function checkOwnerAccess() {
  const { data, error } = await supabaseClient.from("store_admins").select("user_id").eq("user_id", currentUser.id).maybeSingle();
  ownerMode = !error && Boolean(data);
  document.querySelector(".owner-dashboard-link").hidden = !ownerMode;
  document.querySelector(".product-manager").hidden = !ownerMode;
  document.querySelector(".admin-controls").hidden = !ownerMode;
  await refreshProducts();
  if (ownerMode) refreshOrders();
}

async function refreshProducts() {
  productGrid.replaceChildren(el("p", "manager-help", "Loading products…"));
  let query = supabaseClient.from("products").select("id,name,description,category,price_inr,emoji,active").order("created_at");
  if (!ownerMode) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) {
    productGrid.replaceChildren(el("p", "manager-help", `Could not load products: ${error.message}`));
    return;
  }
  products = data || [];
  renderProducts();
  renderCart();
}

function renderProducts() {
  productGrid.replaceChildren();
  const visible = products.filter((p) => (currentFilter === "all" || p.category === currentFilter) && (ownerMode || p.active));
  if (!visible.length) productGrid.append(el("p", "no-products", ownerMode ? "No products yet. Add your first product below." : "No products are available right now."));
  visible.forEach((product) => {
    const card = el("article", "product-card");
    const art = el("div", `product-art ${CATEGORY_CLASSES[product.category] || "art-yellow"}`);
    art.append(el("span", "", product.emoji || "🍌"), el("small", "", CATEGORY_LABELS[product.category] || "BANANA CHIPS"));
    const info = el("div", "product-info");
    const text = el("div");
    text.append(el("h3", "", product.name), el("p", "", product.description));
    info.append(text, el("strong", "", price(product.price_inr)));
    const add = el("button", "add-button", "Add to basket +");
    add.type = "button";
    add.addEventListener("click", () => {
      cart[product.id] = (cart[product.id] || 0) + 1;
      saveCart(); renderCart();
      add.textContent = "Added to basket ✓";
      window.setTimeout(() => { add.textContent = "Add to basket +"; }, 1000);
    });
    card.append(art, info, add);
    if (!product.active) card.classList.add("inactive-product");
    productGrid.append(card);
  });
  if (ownerMode) renderManagedProducts();
}

function renderManagedProducts() {
  managedProducts.replaceChildren();
  products.forEach((product) => {
    const row = el("div", "managed-product");
    const label = el("span", "", `${product.emoji || "🍌"} ${product.name} — ${price(product.price_inr)}${product.active ? "" : " (hidden)"}`);
    const actions = el("div", "managed-actions");
    const edit = el("button", "manager-button", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      productForm.elements.id.value = product.id;
      productForm.elements.name.value = product.name;
      productForm.elements.description.value = product.description;
      productForm.elements.category.value = product.category;
      productForm.elements.price.value = product.price_inr;
      productForm.elements.emoji.value = product.emoji || "🍌";
      productForm.elements.active.checked = product.active;
      document.querySelector(".cancel-edit").hidden = false;
      productForm.elements.name.focus();
    });
    const remove = el("button", "manager-button delete-product", "Delete");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete ${product.name}?`)) return;
      const { error } = await supabaseClient.from("products").delete().eq("id", product.id);
      if (error) return window.alert(`Couldn't delete product: ${error.message}`);
      delete cart[product.id]; saveCart(); await refreshProducts();
    });
    actions.append(edit, remove); row.append(label, actions); managedProducts.append(row);
  });
}

function renderCart() {
  const entries = Object.entries(cart).filter(([id, qty]) => products.some((p) => p.id === id && p.active) && qty > 0);
  const count = entries.reduce((sum, [, qty]) => sum + qty, 0);
  const subtotal = entries.reduce((sum, [id, qty]) => sum + products.find((p) => p.id === id).price_inr * qty, 0);
  cartCount.textContent = String(count);
  cartTotal.textContent = price(subtotal);
  cartEmpty.hidden = entries.length > 0;
  cartItems.replaceChildren();
  entries.forEach(([id, qty]) => {
    const product = products.find((p) => p.id === id);
    const row = el("div", "cart-item");
    const details = el("div");
    details.append(el("strong", "", product.name), el("span", "", `${price(product.price_inr)} each`));
    const controls = el("div", "quantity-controls");
    const minus = el("button", "", "−"); minus.type = "button"; minus.setAttribute("aria-label", `Remove one ${product.name}`);
    minus.addEventListener("click", () => changeQuantity(id, -1));
    const plus = el("button", "", "+"); plus.type = "button"; plus.setAttribute("aria-label", `Add one ${product.name}`);
    plus.addEventListener("click", () => changeQuantity(id, 1));
    const remove = el("button", "", "Remove"); remove.type = "button";
    remove.addEventListener("click", () => { delete cart[id]; saveCart(); renderCart(); });
    controls.append(minus, el("span", "", String(qty)), plus, remove);
    row.append(details, controls); cartItems.append(row);
  });
  document.querySelector(".checkout-form .checkout-button").disabled = entries.length === 0;
}

function changeQuantity(id, step) {
  cart[id] = (cart[id] || 0) + step;
  if (cart[id] <= 0) delete cart[id];
  saveCart(); renderCart();
}

function setCartOpen(open) {
  cartPanel.classList.toggle("open", open);
  cartPanel.setAttribute("aria-hidden", String(!open));
  backdrop.hidden = !open;
  document.body.classList.toggle("cart-open", open);
  if (open) document.querySelector(".cart-close").focus();
}

document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active"); currentFilter = button.dataset.filter; renderProducts();
}));

document.querySelector(".email-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.elements.email.value.trim().toLowerCase();
  authMessage(form, "Signing in…");
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: form.elements.password.value });
    if (error) return authMessage(form, error.message, true);
    showStore(data.session);
  } catch (error) {
    authMessage(form, error.message || "Could not reach the sign-in service. Check your connection and try again.", true);
  }
});

document.querySelector(".email-signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.elements.email.value.trim().toLowerCase();
  if (form.elements.password.value.length < 8) return authMessage(form, "Use a password with at least 8 characters.", true);
  authMessage(form, "Creating account…");
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password: form.elements.password.value,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: form.elements.fullName.value.trim(),
          business_name: form.elements.businessName.value.trim(),
          phone: form.elements.phone.value.trim(),
          delivery_address: form.elements.deliveryAddress.value.trim(),
        },
      },
    });
    if (error) return authMessage(form, error.message, true);
    if (data.session) return showStore(data.session);
    if (data.user?.identities?.length === 0) {
      setAuthForm(document.querySelector(".email-login-form"));
      return authMessage(document.querySelector(".email-login-form"), "That email may already have an account. Sign in with the existing account instead.", true);
    }
    setAuthForm(document.querySelector(".email-confirmation"));
    authMessage(document.querySelector(".email-confirmation"), "Check your inbox and click the confirmation link. Then return here and sign in.");
  } catch (error) {
    authMessage(form, error.message || "Could not reach the account service. Check your connection and try again.", true);
  }
});

document.querySelectorAll(".auth-switch").forEach((button) => button.addEventListener("click", () => {
  const login = document.querySelector(".email-login-form");
  const next = login.hidden ? login : document.querySelector(".email-signup-form");
  setAuthForm(next);
}));

document.querySelector(".signout-button").addEventListener("click", async () => {
  await supabaseClient.auth.signOut(); showLogin();
});
document.querySelector(".cart-toggle").addEventListener("click", () => setCartOpen(true));
document.querySelector(".cart-close").addEventListener("click", () => setCartOpen(false));
backdrop.addEventListener("click", () => setCartOpen(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setCartOpen(false); });

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ownerMode) return;
  const form = new FormData(productForm);
  const id = form.get("id");
  const product = {
    name: String(form.get("name")).trim(),
    description: String(form.get("description")).trim(),
    category: form.get("category"),
    price_inr: Number(form.get("price")),
    emoji: String(form.get("emoji")).trim() || "🍌",
    active: productForm.elements.active.checked,
  };
  const response = id
    ? await supabaseClient.from("products").update(product).eq("id", id)
    : await supabaseClient.from("products").insert(product);
  if (response.error) return window.alert(`Couldn't save product: ${response.error.message}`);
  productForm.reset(); productForm.elements.emoji.value = "🍌";
  document.querySelector(".cancel-edit").hidden = true;
  await refreshProducts();
});

document.querySelector(".cancel-edit").addEventListener("click", () => {
  productForm.reset(); productForm.elements.emoji.value = "🍌";
  document.querySelector(".cancel-edit").hidden = true;
});

document.querySelector(".refresh-orders").addEventListener("click", refreshOrders);

async function refreshOrders() {
  const list = document.querySelector(".order-list");
  list.replaceChildren(el("p", "manager-help", "Loading orders…"));
  const { data, error } = await supabaseClient.from("orders").select("id,order_number,customer_name,business_name,email,phone,delivery_address,items,total_inr,status,created_at").order("created_at", { ascending: false }).limit(100);
  list.replaceChildren();
  if (error) return list.append(el("p", "manager-help", `Could not load orders: ${error.message}`));
  if (!data.length) return list.append(el("p", "manager-help", "No retailer orders yet."));
  data.forEach((order) => {
    const card = el("article", "order-card");
    const date = new Date(order.created_at).toLocaleString();
    card.append(el("h4", "", `Order #${order.order_number} · ${order.business_name}`));
    card.append(el("p", "", `${date} · ${order.customer_name} · ${order.phone} · ${order.email}`));
    card.append(el("p", "", `Delivery: ${order.delivery_address}`));
    card.append(el("p", "", order.items.map((item) => `${item.name} × ${item.quantity} (${price(item.line_total_inr)})`).join(" · ")));
    card.append(el("strong", "", `Subtotal ${price(order.total_inr)}`));
    const select = document.createElement("select");
    ["new", "contacted", "confirmed", "fulfilled", "cancelled"].forEach((status) => { const option = document.createElement("option"); option.value = status; option.textContent = status; option.selected = status === order.status; select.append(option); });
    select.addEventListener("change", async () => {
      const { error: updateError } = await supabaseClient.from("orders").update({ status: select.value }).eq("id", order.id);
      if (updateError) window.alert(`Couldn't update order: ${updateError.message}`);
    });
    card.append(select); list.append(card);
  });
}

document.querySelector(".checkout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const status = document.querySelector(".order-message");
  const entries = Object.entries(cart).filter(([id, qty]) => products.some((p) => p.id === id && p.active) && qty > 0);
  if (!entries.length) return;
  const form = new FormData(formElement);
  const button = formElement.querySelector("button[type=submit]");
  button.disabled = true; status.textContent = "Sending order request…"; status.classList.remove("error");
  const payload = {
    name: String(form.get("name")).trim(),
    businessName: String(form.get("businessName")).trim(),
    email: String(form.get("email")).trim(),
    phone: String(form.get("phone")).trim(),
    address: String(form.get("address")).trim(),
    website: String(form.get("website") || ""),
    items: entries.map(([productId, quantity]) => ({ productId, quantity })),
  };
  const { data, error } = await supabaseClient.functions.invoke("retailer-order", { body: payload });
  button.disabled = false;
  if (error || data?.error) {
    status.textContent = data?.error || "Couldn't send order. Check your connection and try again.";
    status.classList.add("error");
    return;
  }
  const { error: profileError } = await supabaseClient.auth.updateUser({
    data: {
      full_name: payload.name,
      business_name: payload.businessName,
      phone: payload.phone,
      delivery_address: payload.address,
    },
  });
  status.textContent = `Order request #${data.orderNumber} was saved.${data.emailSent ? " The shop was emailed." : " The shop can see it in the owner dashboard; email notification is not configured yet."}`;
  if (!profileError) status.textContent += " Your retailer details were saved for next time.";
  cart = {}; saveCart(); renderCart(); formElement.reset();
});

document.querySelector(".product-manager").hidden = true;
if (!CONFIG_READY || !window.supabase) {
  showLogin("The store is not connected yet. Follow the setup steps in SETUP.md to add your Supabase project settings.");
  document.querySelectorAll(".email-login-form button[type=submit], .email-signup-form button[type=submit]").forEach((button) => { button.disabled = true; });
} else {
  supabaseClient.auth.getSession().then(({ data }) => data.session ? showStore(data.session) : showLogin(hadCredentialsInUrl ? "For your security, enter email and password in the form, not in the web address." : ""));
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session && !currentUser) showStore(session);
    else if (!session && currentUser) showLogin();
  });
}
