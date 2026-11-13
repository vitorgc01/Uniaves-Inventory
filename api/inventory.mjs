
const endpoint = "https://rgwglwafpzxekxwadedn.supabase.co";
const apiKey = "sb_publishable_yo_UaXHtQHX_hMF2SCsF-w_JKtAVIau";
const adminId = "97c1060e-0c1e-498a-adbe-03e0e29d8d59";
const cookie = "uniaves_supabase";
const reply = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers }
});
const sessionCookie = (token, age) => `${cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function supabase(path, {token, body} = {}) {
  const headers = {apikey:apiKey};
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  return fetch(endpoint + path, {headers, cache:"no-store", method:body ? "POST" : "GET", body:body ? JSON.stringify(body) : undefined});
}
async function readJson(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("Corpo ausente");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw Error("Corpo excede o limite"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function validRecords(records) {
  if (!Array.isArray(records) || records.length > 2000) return false;
  const ids = new Set(), hosts = new Set();
  for (const row of records) {
    if (!row || typeof row.review !== "boolean" || !["active", "off"].includes(row.activity)) return false;
    for (const [field, limit] of Object.entries({id: 150, host: 120, person: 200, sector: 120, provider: 120, notes: 4000, source: 10000})) {
      if (typeof row[field] !== "string" || row[field].length > limit) return false;
    }
    const host = row.host.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
    if (!host || !row.id || ids.has(row.id) || hosts.has(host)) return false;
    ids.add(row.id);
    hosts.add(host);
  }
  return true;
}

export default {
  async fetch(request) {
    const method = request.method;
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) return reply({error:"Método inválido."},405);
    if (method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) {
      return reply({error:"Origem inválida."},403);
    }
    try {
      const token = request.headers.get("cookie")?.match(/(?:^|;\s*)uniaves_supabase=([A-Za-z0-9._-]+)(?:;|$)/)?.[1];
      if (method === "DELETE") return reply({canEdit:false},200,{"Set-Cookie":sessionCookie("",0)});
      if (method === "POST") {
        let input;
        try { input = await readJson(request, 4096); } catch { return reply({error:"Login inválido."},400); }
        const {email, password} = input || {};
        if (typeof email !== "string" || typeof password !== "string" || password.length > 256) {
          return reply({error:"Login inválido."},400);
        }
        const auth = await supabase("/auth/v1/token?grant_type=password", {body:{email:email.trim(),password}});
        const result = await auth.json();
        if (result.error_code === "email_not_confirmed") return reply({error:"Confirme seu e-mail no Supabase para entrar."},401);
        if (auth.status === 429) return reply({error:"Muitas tentativas. Tente novamente mais tarde."},429);
        if (!auth.ok || result.user?.id !== adminId) return reply({error:"E-mail ou senha inválidos."},401);
        return reply({canEdit:true},200,{"Set-Cookie":sessionCookie(result.access_token,result.expires_in)});
      }
      let canEdit = false;
      if (token) {
        const auth = await supabase("/auth/v1/user",{token});
        if (auth.ok) canEdit = (await auth.json()).id === adminId;
      }
      if (method === "GET") {
        const audience = canEdit ? "admin" : "public";
        const result = await supabase("/rest/v1/uniaves_inventory?select=revision,records&audience=eq." + audience, {token:canEdit ? token : undefined});
        if (!result.ok) throw Error("Falha de consulta");
        const [inventory] = await result.json();
        if (!inventory) throw Error("Inventário ausente");
        if (!canEdit) inventory.records = inventory.records.map(row => ({...row, notes:"", source:""}));
        return reply({...inventory,canEdit});
      }
      if (!canEdit) return reply({error:"Entre com a conta de administrador para salvar."},403);
      let data;
      try { data = await readJson(request, 1000000); } catch { return reply({error:"Arquivo inválido ou grande demais."},400); }
      if (!Number.isSafeInteger(data?.revision) || data.revision < 0 || !validRecords(data.records)) return reply({error:"Inventário inválido."},400);
      const records = data.records.map(({id,host,person,sector,provider,notes,source,review,activity}) => ({id,host,person,sector,provider,notes,source,review,activity}));
      const result = await supabase("/rest/v1/rpc/uniaves_save_inventory",{token,body:{expected:data.revision,full_records:records}});
      if (!result.ok) throw Error("Falha de gravação");
      const revision = await result.json();
      return revision === null ? reply({error:"O inventário mudou. Recarregue a página e tente novamente."},409) : reply({revision});
    } catch {
      return reply({error:"Não foi possível acessar o inventário compartilhado."},503);
    }
  }
};

