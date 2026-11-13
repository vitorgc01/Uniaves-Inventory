import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const admin = "vitor.cogo@uniaves.com.br";
const key = "uniaves:inventory:v1";
const cookie = "uniaves_session";
const ttl = 8 * 60 * 60;
const hash = value => createHash("sha256").update(value).digest("hex");
const reply = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers }
});
const sessionCookie = (token, age) => `${cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function redis(...args) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw Error("Redis indisponível");
  return data.result;
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
const limitLogin = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n";
const compareAndSave = "local old=redis.call('GET',KEYS[1]); local rev=old and cjson.decode(old).revision or 0; if rev~=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1";
export default {
  async fetch(request) {
    const method = request.method;
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) return reply({error:"Método inválido."},405);
    if (method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin !== new URL(request.url).origin) return reply({error:"Origem inválida."},403);
    }
    try {
      const token = request.headers.get("cookie")?.match(/(?:^|;\s*)uniaves_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const session = token && `uniaves:session:${hash(token)}`;
      const config = process.env.UNIAVES_ADMIN_PASSWORD_HASH?.match(/^([a-f0-9]{32}):([a-f0-9]{128})$/i);
      const account = config ? hash(config[0]) : "";
      if (method === "POST") {
        if (!config) return reply({error:"Login ainda não configurado."},503);
        let input;
        try { input = await readJson(request, 4096); } catch { return reply({error:"Login inválido."},400); }
        const ip = (request.headers.get("x-vercel-forwarded-for") || "unknown").split(",")[0].trim();
        if (await redis("EVAL", limitLogin, 1, `uniaves:attempt:${hash(ip)}`) > 10) return reply({error:"Muitas tentativas. Aguarde 15 minutos."},429);
        const { email, password } = input || {};
        if (typeof password !== "string" || password.length > 256 || typeof email !== "string" || email.trim().toLowerCase() !== admin ||
            !timingSafeEqual(scryptSync(password, config[1], 64), Buffer.from(config[2], "hex"))) {
          return reply({error:"E-mail ou senha inválidos."},401);
        }
        const next = randomBytes(32).toString("hex");
        await redis("SET", `uniaves:session:${hash(next)}`, account, "EX", ttl);
        return reply({canEdit:true},200,{"Set-Cookie":sessionCookie(next,ttl)});
      }
      const canEdit = Boolean(account && session && await redis("GET", session) === account);
      if (method === "DELETE") {
        if (canEdit) await redis("DEL", session);
        return reply({canEdit:false},200,{"Set-Cookie":sessionCookie("",0)});
      }
      if (method === "GET") {
        const saved = await redis("GET", key);
        const inventory = saved ? JSON.parse(saved) : { revision:0, records:[] };
        if (!canEdit) inventory.records = inventory.records.map(({source, notes, ...row}) => ({...row, source:"", notes:""}));
        return reply({...inventory, canEdit});
      }
      if (!canEdit) return reply({error:"Entre com a conta de administrador para salvar."},403);
      let data;
      try { data = await readJson(request, 1000000); } catch { return reply({error:"Arquivo inválido ou grande demais."},400); }
      if (!Number.isSafeInteger(data?.revision) || data.revision < 0 || !validRecords(data.records)) return reply({error:"Inventário inválido."},400);
      const revision = data.revision + 1;
      const records = data.records.map(({id,host,person,sector,provider,notes,source,review,activity}) => ({id,host,person,sector,provider,notes,source,review,activity}));
      const saved = await redis("EVAL", compareAndSave, 1, key, data.revision, JSON.stringify({revision, records}));
      return saved ? reply({revision}) : reply({error:"O inventário mudou. Recarregue a página e tente novamente."},409);
    } catch {
      return reply({error:"Não foi possível acessar o inventário compartilhado."},503);
    }
  }
};
