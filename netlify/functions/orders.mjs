
import { getStore } from "@netlify/blobs";

// Vendor prices (already 50% off the board). Keep in step with index.html.
const MENU = {
  burger:  1.75,
  chicken: 2.50,
  wings:   1.25,
  chips:   1.25,
  can:     0.50,
  meal:    0.75
};

const NAMES = {
  burger:  "Lamb burger",
  chicken: "Fillet chicken",
  wings:   "Wings (4)",
  chips:   "Chips",
  can:     "Can of drink",
  meal:    "Make it a meal"
};

const store = () => getStore({ name: "bbq-orders", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

async function readAll(s) {
  const { blobs } = await s.list();
  const orders = await Promise.all(
    blobs.map(b => s.get(b.key, { type: "json" }).catch(() => null))
  );
  return orders.filter(Boolean).sort((a, b) => b.at - a.at);
}

export default async (req) => {
  const s = store();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      return json(await readAll(s));
    }

    if (req.method === "POST") {
      const body = await req.json();
      const vendor = String(body.vendor || "").trim().slice(0, 60);
      if (!vendor) return json({ error: "Stall name is missing" }, 400);

      // Rebuild the order server-side so prices cannot be edited in the browser.
      const items = [];
      let total = 0;
      for (const [id, rawQty] of Object.entries(body.qty || {})) {
        const price = MENU[id];
        const qty = Math.min(99, Math.max(0, parseInt(rawQty, 10) || 0));
        if (!price || !qty) continue;
        items.push({ name: NAMES[id], qty, line: +(qty * price).toFixed(2) });
        total += qty * price;
      }
      if (!items.length) return json({ error: "Order is empty" }, 400);

      const order = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        at: Date.now(),
        vendor,
        items,
        total: +total.toFixed(2),
        msg: String(body.msg || "").trim().slice(0, 200),
        status: "waiting"
      };
      await s.setJSON(order.id, order);
      return json(order, 201);
    }

    if (req.method === "PATCH") {
      const { id, status } = await req.json();
      if (!id || !["waiting", "done"].includes(status)) {
        return json({ error: "Bad update" }, 400);
      }
      const order = await s.get(id, { type: "json" });
      if (!order) return json({ error: "Order not found" }, 404);
      order.status = status;
      await s.setJSON(id, order);
      return json(order);
    }

    if (req.method === "DELETE") {
      if (url.searchParams.get("all") === "yes") {
        const { blobs } = await s.list();
        await Promise.all(blobs.map(b => s.delete(b.key)));
        return json({ deleted: blobs.length });
      }
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "No order id" }, 400);
      await s.delete(id);
      return json({ deleted: 1 });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    return json({ error: "Store unavailable", detail: String(err) }, 500);
  }
};

export const config = { path: "/api/orders" };
