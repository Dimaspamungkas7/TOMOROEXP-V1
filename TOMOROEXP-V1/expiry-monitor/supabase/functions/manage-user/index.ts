// Supabase Edge Function: create store users and area managers securely.
// Deploy with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured as function secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const admin = createClient(url, serviceKey);
  const callerClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return json({ error: "Unauthorized" }, 401);

  const { data: caller, error: profileError } = await admin
    .from("profiles").select("*").eq("id", callerData.user.id).eq("active", true).single();
  if (profileError || !caller) return json({ error: "Profil pemanggil tidak ditemukan" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON tidak valid" }, 400); }
  const action = body.action;
  const code = String(body.code || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return json({ error: "Kode harus 3-32 karakter: A-Z, angka, _ atau -" }, 400);
  if (name.length < 2) return json({ error: "Nama minimal 2 karakter" }, 400);
  if (password.length < 8) return json({ error: "Password minimal 8 karakter" }, 400);

  let role: "store_user" | "area_manager";
  let areaId: string | null = null;
  let storeId: string | null = null;

  if (action === "create_store") {
    if (!["area_manager", "super_admin"].includes(caller.role)) return json({ error: "Tidak memiliki izin membuat akun toko" }, 403);
    let area = caller.area_id;
    if (caller.role === "super_admin") {
      const requestedArea = String(body.areaId || "");
      if (requestedArea) area = requestedArea;
      if (!area) return json({ error: "Super Admin harus memilih area untuk toko" }, 400);
    }
    role = "store_user"; areaId = area;
    const { data: store, error: storeError } = await admin.from("stores")
      .insert({ code, name, area_id: areaId }).select().single();
    if (storeError) return json({ error: storeError.message }, 400);
    storeId = store.id;
  } else if (action === "create_manager") {
    if (caller.role !== "super_admin") return json({ error: "Hanya Super Admin yang dapat membuat Area Manager" }, 403);
    const areaName = String(body.areaName || "").trim();
    if (areaName.length < 2) return json({ error: "Nama area wajib diisi" }, 400);
    const { data: area, error: areaError } = await admin.from("areas").insert({ name: areaName }).select().single();
    if (areaError) return json({ error: areaError.message }, 400);
    role = "area_manager"; areaId = area.id;
  } else {
    return json({ error: "Action tidak dikenal" }, 400);
  }

  const email = `${code.toLowerCase()}@expiry.local`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { login_code: code, display_name: name },
  });
  if (createError) {
    if (storeId) await admin.from("stores").delete().eq("id", storeId);
    if (action === "create_manager" && areaId) await admin.from("areas").delete().eq("id", areaId);
    return json({ error: createError.message }, 400);
  }
  const { error: insertProfileError } = await admin.from("profiles").insert({
    id: created.user.id, login_code: code, display_name: name, role, area_id: areaId, store_id: storeId, active: true,
  });
  if (insertProfileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (storeId) await admin.from("stores").delete().eq("id", storeId);
    if (action === "create_manager" && areaId) await admin.from("areas").delete().eq("id", areaId);
    return json({ error: insertProfileError.message }, 400);
  }
  return json({ success: true, code, role, storeId, areaId });
});
