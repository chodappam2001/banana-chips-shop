import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const body = await request.json();
    if (clean(body.website, 200)) return json({ ok: true, orderNumber: null, emailSent: false });
    const customerName = clean(body.name, 100);
    const businessName = clean(body.businessName, 120);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 40);
    const address = clean(body.address, 1000);
    if (!customerName || !businessName || !address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 6) {
      return json({ error: "Enter your name, business, valid email, phone, and delivery address." }, 400);
    }
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40) {
      return json({ error: "Your basket is empty or has too many different products." }, 400);
    }
    const quantities = new Map<string, number>();
    for (const item of body.items) {
      if (typeof item.productId !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
        return json({ error: "One of the product quantities is invalid." }, 400);
      }
      quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: products, error: productError } = await supabase
      .from("products").select("id,name,price_inr,active").in("id", [...quantities.keys()]).eq("active", true);
    if (productError || !products || products.length !== quantities.size) return json({ error: "A product is no longer available. Refresh the shop and try again." }, 400);

    const items = products.map((product) => ({
      product_id: product.id,
      name: product.name,
      quantity: quantities.get(product.id)!,
      unit_price_inr: product.price_inr,
      line_total_inr: product.price_inr * quantities.get(product.id)!,
    }));
    const total = items.reduce((sum, item) => sum + item.line_total_inr, 0);
    if (!Number.isSafeInteger(total) || total <= 0 || total > 100_000_000) return json({ error: "Order total is outside the allowed range." }, 400);

    const { data: order, error: orderError } = await supabase.from("orders").insert({
      customer_name: customerName,
      business_name: businessName,
      email,
      phone,
      delivery_address: address,
      items,
      total_inr: total,
    }).select("id,order_number").single();
    if (orderError || !order) {
      console.error("Order save failed", orderError);
      return json({ error: "We couldn't save the order. Please try again or contact the shop." }, 500);
    }

    let emailSent = false;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const notifyEmail = Deno.env.get("ORDER_NOTIFICATION_EMAIL");
    const fromEmail = Deno.env.get("ORDER_FROM_EMAIL");
    if (resendKey && notifyEmail && fromEmail) {
      const lineText = items.map((item) => `${item.name} × ${item.quantity} — ₹${item.line_total_inr}`).join("\n");
      const message = [
        `New retailer order #${order.order_number}`,
        "",
        `Business: ${businessName}`,
        `Contact: ${customerName}`,
        `Email: ${email}`,
        `Phone: ${phone}`,
        `Delivery address: ${address}`,
        "",
        "Products:",
        lineText,
        "",
        `Subtotal: ₹${total}`,
        "Please confirm stock, delivery charges, and payment with the retailer.",
      ].join("\n");
      try {
        const mailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: fromEmail, to: [notifyEmail], subject: `New retailer order #${order.order_number}`, text: message }),
        });
        emailSent = mailResponse.ok;
        if (!mailResponse.ok) console.error("Order saved but notification failed", await mailResponse.text());
      } catch (mailError) {
        console.error("Order saved but notification failed", mailError);
      }
    }
    return json({ ok: true, orderNumber: order.order_number, emailSent });
  } catch (error) {
    console.error("Retailer order error", error);
    return json({ error: "We couldn't submit the order. Please try again." }, 500);
  }
});
