const OWNER_CONFIG = window.STORE_CONFIG || {};
const OWNER_CONFIG_READY = Boolean(
  OWNER_CONFIG.supabaseUrl?.startsWith("https://") &&
  !OWNER_CONFIG.supabaseUrl.includes("YOUR-PROJECT") &&
  OWNER_CONFIG.supabasePublishableKey &&
  !OWNER_CONFIG.supabasePublishableKey.includes("YOUR_SUPABASE") &&
  window.supabase?.createClient
);
const ownerSupabase = OWNER_CONFIG_READY
  ? window.supabase.createClient(OWNER_CONFIG.supabaseUrl, OWNER_CONFIG.supabasePublishableKey)
  : null;

const ownerLoginPanel = document.querySelector("#owner-login-panel");
const ownerDashboardPanel = document.querySelector("#owner-dashboard-panel");
const ownerLoginForm = document.querySelector("#owner-login-form");
const ownerLoginMessage = document.querySelector("#owner-login-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const productForm = document.querySelector("#product-form");
const productMessage = document.querySelector("#product-message");
const productList = document.querySelector("#product-list");
const orderList = document.querySelector("#order-list");
const orderStatuses = ["new", "contacted", "confirmed", "fulfilled", "cancelled"];
let ownerUser = null;
let products = [];
let orders = [];

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setMessage(element, text = "", isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function inr(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function showLogin(message = "", isError = false, canSwitch = false) {
  ownerDashboardPanel.hidden = true;
  ownerLoginPanel.hidden = false;
  document.querySelector("#switch-account").hidden = !canSwitch;
  setMessage(ownerLoginMessage, message, isError);
}

function showDashboard(user) {
  ownerUser = user;
  ownerLoginPanel.hidden = true;
  ownerDashboardPanel.hidden = false;
  document.querySelector("#owner-identity").textContent = user.email || "Owner account";
}

async function verifyOwnerSession(session) {
  if (!session?.user) {
    ownerUser = null;
    showLogin();
    return;
  }

  setMessage(ownerLoginMessage, "Checking owner access…");
  const { data, error } = await ownerSupabase
    .from("store_admins")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    ownerUser = null;
    showLogin(`Couldn't check owner access: ${error.message}`, true, true);
    return;
  }
  if (!data) {
    ownerUser = null;
    showLogin("This account is not an owner yet. Add it to public.store_admins in Supabase, then sign out and sign in again.", true, true);
    return;
  }

  showDashboard(session.user);
  await refreshDashboard();
}

function updateStats() {
  document.querySelector("#stat-products").textContent = String(products.length);
  document.querySelector("#stat-active").textContent = String(products.filter((product) => product.active).length);
  document.querySelector("#stat-orders").textContent = String(orders.length);
  document.querySelector("#stat-new-orders").textContent = String(orders.filter((order) => order.status === "new").length);
  document.querySelector("#product-count-label").textContent = `${products.length} total`;
}

async function refreshDashboard() {
  if (!ownerUser) return;
  setMessage(dashboardMessage, "Refreshing products and orders…");
  const [productResult, orderResult] = await Promise.all([
    ownerSupabase.from("products").select("id,name,description,category,price_inr,emoji,active,created_at").order("created_at", { ascending: false }),
    ownerSupabase.from("orders").select("id,order_number,customer_name,business_name,email,phone,delivery_address,items,total_inr,status,created_at").order("created_at", { ascending: false }).limit(100),
  ]);

  if (productResult.error) {
    products = [];
    productList.replaceChildren(makeElement("p", "empty-state", `Could not load products: ${productResult.error.message}`));
  } else {
    products = productResult.data || [];
    renderProducts();
  }
  if (orderResult.error) {
    orders = [];
    orderList.replaceChildren(makeElement("p", "empty-state", `Could not load orders: ${orderResult.error.message}`));
  } else {
    orders = orderResult.data || [];
    renderOrders();
  }
  updateStats();
  const errors = [productResult.error, orderResult.error].filter(Boolean);
  setMessage(dashboardMessage, errors.length ? "Some dashboard information could not be loaded. See the message in that section." : "Dashboard is up to date.", errors.length > 0);
}

function renderProducts() {
  productList.replaceChildren();
  if (!products.length) {
    productList.append(makeElement("p", "empty-state", "No products yet. Add your first product above."));
    return;
  }

  products.forEach((product) => {
    const row = makeElement("article", "product-row");
    const main = makeElement("div", "product-main");
    const emoji = makeElement("span", "product-emoji", product.emoji || "🍌");
    const details = makeElement("div", "product-details");
    details.append(makeElement("h4", "", product.name));
    details.append(makeElement("p", "", `${product.description} · ${product.category}`));
    details.append(makeElement("strong", "product-price", inr(product.price_inr)));
    details.append(makeElement("span", `product-state${product.active ? "" : " inactive"}`, product.active ? "Shown in shop" : "Hidden from shop"));
    main.append(emoji, details);

    const actions = makeElement("div", "row-actions");
    const edit = makeElement("button", "", "Edit details");
    edit.type = "button";
    edit.addEventListener("click", () => beginEditProduct(product));
    const visibility = makeElement("button", "", product.active ? "Hide" : "Show");
    visibility.type = "button";
    visibility.addEventListener("click", () => setProductVisibility(product));
    const remove = makeElement("button", "danger-button", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => deleteProduct(product));
    actions.append(edit, visibility, remove);
    row.append(main, actions);
    productList.append(row);
  });
}

function renderOrders() {
  orderList.replaceChildren();
  if (!orders.length) {
    orderList.append(makeElement("p", "empty-state", "No retailer orders yet."));
    return;
  }

  orders.forEach((order) => {
    const card = makeElement("article", "order-card");
    const titleRow = makeElement("div", "order-title-row");
    const title = makeElement("h3", "", `Order #${order.order_number} · ${order.business_name}`);
    titleRow.append(title, makeElement("strong", "order-total", inr(order.total_inr)));
    const date = new Date(order.created_at).toLocaleString();
    card.append(titleRow);
    card.append(makeElement("p", "", `${date} · ${order.customer_name} · ${order.phone}`));
    card.append(makeElement("p", "", order.email));
    card.append(makeElement("p", "", `Delivery: ${order.delivery_address}`));

    const items = makeElement("ul", "order-items");
    (Array.isArray(order.items) ? order.items : []).forEach((item) => {
      items.append(makeElement("li", "", `${item.name || "Product"} × ${item.quantity || 0}${item.line_total_inr ? ` · ${inr(item.line_total_inr)}` : ""}`));
    });
    card.append(items);

    const actions = makeElement("div", "order-actions");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Status for order ${order.order_number}`);
    orderStatuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status[0].toUpperCase() + status.slice(1);
      option.selected = status === order.status;
      select.append(option);
    });
    const saveStatus = makeElement("button", "", "Save status");
    saveStatus.type = "button";
    saveStatus.addEventListener("click", async () => {
      saveStatus.disabled = true;
      try {
        const { error } = await ownerSupabase.from("orders").update({ status: select.value }).eq("id", order.id);
        if (error) throw error;
        order.status = select.value;
        updateStats();
        setMessage(dashboardMessage, `Order #${order.order_number} status saved.`);
      } catch (error) {
        setMessage(dashboardMessage, `Could not update the order: ${error.message}`, true);
      } finally {
        saveStatus.disabled = false;
      }
    });
    actions.append(select, saveStatus);
    card.append(actions);
    orderList.append(card);
  });
}

function beginEditProduct(product) {
  productForm.elements.id.value = product.id;
  productForm.elements.name.value = product.name;
  productForm.elements.description.value = product.description;
  productForm.elements.category.value = product.category;
  productForm.elements.price.value = product.price_inr;
  productForm.elements.emoji.value = product.emoji || "🍌";
  productForm.elements.active.checked = product.active;
  document.querySelector("#product-form-title").textContent = "Edit product details";
  document.querySelector("#save-product").textContent = "Save changes";
  document.querySelector("#cancel-product-edit").hidden = false;
  setMessage(productMessage);
  productForm.scrollIntoView({ behavior: "smooth", block: "center" });
  productForm.elements.name.focus();
}

function resetProductForm() {
  productForm.reset();
  productForm.elements.id.value = "";
  productForm.elements.emoji.value = "🍌";
  productForm.elements.active.checked = true;
  document.querySelector("#product-form-title").textContent = "Add a product";
  document.querySelector("#save-product").textContent = "Add product";
  document.querySelector("#cancel-product-edit").hidden = true;
  setMessage(productMessage);
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ownerUser) return;
  const saveButton = document.querySelector("#save-product");
  const id = productForm.elements.id.value;
  const product = {
    name: productForm.elements.name.value.trim(),
    description: productForm.elements.description.value.trim(),
    category: productForm.elements.category.value,
    price_inr: Number(productForm.elements.price.value),
    emoji: productForm.elements.emoji.value.trim() || "🍌",
    active: productForm.elements.active.checked,
  };
  saveButton.disabled = true;
  setMessage(productMessage, id ? "Saving product changes…" : "Adding product…");
  try {
    const result = id
      ? await ownerSupabase.from("products").update(product).eq("id", id)
      : await ownerSupabase.from("products").insert(product);
    if (result.error) throw result.error;
    resetProductForm();
    setMessage(productMessage, id ? "Product details and price updated." : "Product added to the catalog.");
    await refreshDashboard();
  } catch (error) {
    setMessage(productMessage, `Could not save the product: ${error.message}`, true);
  } finally {
    saveButton.disabled = false;
  }
});

async function setProductVisibility(product) {
  try {
    const { error } = await ownerSupabase.from("products").update({ active: !product.active }).eq("id", product.id);
    if (error) throw error;
    setMessage(dashboardMessage, `${product.name} is now ${product.active ? "hidden" : "shown"} in the shop.`);
    await refreshDashboard();
  } catch (error) {
    setMessage(dashboardMessage, `Could not change product visibility: ${error.message}`, true);
  }
}

async function deleteProduct(product) {
  if (!window.confirm(`Delete “${product.name}” permanently?`)) return;
  try {
    const { error } = await ownerSupabase.from("products").delete().eq("id", product.id);
    if (error) throw error;
    setMessage(dashboardMessage, `${product.name} was deleted.`);
    await refreshDashboard();
  } catch (error) {
    setMessage(dashboardMessage, `Could not delete the product: ${error.message}`, true);
  }
}

ownerLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ownerSupabase) return setMessage(ownerLoginMessage, "Supabase is not connected. Check config.js and reload this page.", true);
  const submit = ownerLoginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  setMessage(ownerLoginMessage, "Signing in…");
  try {
    const { data, error } = await ownerSupabase.auth.signInWithPassword({
      email: ownerLoginForm.elements.email.value.trim().toLowerCase(),
      password: ownerLoginForm.elements.password.value,
    });
    if (error) throw error;
    await verifyOwnerSession(data.session);
  } catch (error) {
    setMessage(ownerLoginMessage, error.message || "Could not reach Supabase. Check your connection and try again.", true);
  } finally {
    submit.disabled = false;
  }
});

async function signOutOwner() {
  if (!ownerSupabase) return showLogin();
  const { error } = await ownerSupabase.auth.signOut();
  ownerUser = null;
  showLogin(error ? `Signed out locally. ${error.message}` : "You are signed out.", Boolean(error));
}

document.querySelector("#owner-signout").addEventListener("click", signOutOwner);
document.querySelector("#switch-account").addEventListener("click", signOutOwner);
document.querySelector("#refresh-dashboard").addEventListener("click", refreshDashboard);
document.querySelector("#cancel-product-edit").addEventListener("click", resetProductForm);

if (!OWNER_CONFIG_READY) {
  showLogin("Supabase is not connected. Check config.js and reload this page.", true);
  ownerLoginForm.querySelector("button[type=submit]").disabled = true;
} else {
  ownerSupabase.auth.getSession().then(({ data, error }) => {
    if (error) showLogin(`Couldn't restore your session: ${error.message}`, true);
    else if (data.session) verifyOwnerSession(data.session);
    else showLogin();
  }).catch((error) => showLogin(error.message || "Could not reach Supabase.", true));
  ownerSupabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      ownerUser = null;
      showLogin("You are signed out.");
    }
  });
}
