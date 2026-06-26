/* =====================================================================
   Wayne Manor World Cup Bracket — Cloudflare Worker (API + static host)
   ---------------------------------------------------------------------
   Serves the static front-end (./public) and a tiny JSON API backed by
   Workers KV so every friend's picks are stored in the cloud and shared.

   KV layout:
     person:<id>   -> { id, name, createdAt }   (name also in metadata)
     pred:<id>     -> { picks: {matchId: teamId}, updatedAt }
     config        -> { teams:[{name,flag}], locked, title, updatedAt }

   No passwords: identity is just a name you pick / search for. The only
   gated action is Commissioner edits, protected by COMMISSIONER_CODE.
   ===================================================================== */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const slug = (s) =>
  (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);

function newId() {
  // crypto.randomUUID is available in the Workers runtime.
  return (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function listPeople(env) {
  const out = [];
  let cursor;
  do {
    const res = await env.BRACKET_KV.list({ prefix: "person:", cursor });
    for (const k of res.keys) {
      const name = k.metadata && k.metadata.name;
      out.push({ id: k.name.slice("person:".length), name: name || "(unknown)" });
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function getConfig(env) {
  const raw = await env.BRACKET_KV.get("config", "json");
  return raw || null;
}

/* Aggregate every saved bracket into per-match, per-team vote counts. */
async function buildStats(env) {
  const matches = {};
  let voters = 0;
  let cursor;
  do {
    const res = await env.BRACKET_KV.list({ prefix: "pred:", cursor });
    for (const k of res.keys) {
      const rec = await env.BRACKET_KV.get(k.name, "json");
      if (!rec || !rec.picks) continue;
      const picks = rec.picks;
      const hasAny = Object.keys(picks).length > 0;
      if (hasAny) voters++;
      for (const [matchId, teamId] of Object.entries(picks)) {
        (matches[matchId] || (matches[matchId] = {}));
        const key = String(teamId);
        matches[matchId][key] = (matches[matchId][key] || 0) + 1;
      }
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return { voters, matches };
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;

  // --- People (login / signup / search) ---
  if (path === "/people" && method === "GET") {
    return json({ people: await listPeople(env) });
  }

  if (path === "/people" && method === "POST") {
    const body = await readBody(request);
    const name = (body.name || "").toString().trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return json({ error: "Please enter a name." }, 400);
    // Treat an exact (case-insensitive) name match as logging back in.
    const people = await listPeople(env);
    const existing = people.find((p) => slug(p.name) === slug(name));
    if (existing) {
      const rec = await env.BRACKET_KV.get(`pred:${existing.id}`, "json");
      return json({ person: existing, picks: (rec && rec.picks) || {}, returning: true });
    }
    const id = newId();
    const person = { id, name, createdAt: Date.now() };
    await env.BRACKET_KV.put(`person:${id}`, JSON.stringify(person), { metadata: { name } });
    return json({ person: { id, name }, picks: {}, returning: false });
  }

  // --- A single person's saved bracket ---
  if (path === "/me" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "missing id" }, 400);
    const person = await env.BRACKET_KV.get(`person:${id}`, "json");
    if (!person) return json({ error: "not found" }, 404);
    const rec = await env.BRACKET_KV.get(`pred:${id}`, "json");
    return json({ person: { id: person.id, name: person.name }, picks: (rec && rec.picks) || {} });
  }

  // --- Save picks ---
  if (path === "/picks" && method === "POST") {
    const body = await readBody(request);
    const id = body.id;
    if (!id) return json({ error: "missing id" }, 400);
    const person = await env.BRACKET_KV.get(`person:${id}`, "json");
    if (!person) return json({ error: "unknown player — please log in again" }, 401);
    const cfg = await getConfig(env);
    if (cfg && cfg.locked) return json({ error: "Picks are locked by the Commissioner." }, 423);
    const picks = (body.picks && typeof body.picks === "object") ? body.picks : {};
    // Keep it small + clean: numeric team ids keyed by match id.
    const clean = {};
    for (const [k, v] of Object.entries(picks)) {
      if (typeof v === "number" && v >= 0 && v < 64) clean[k] = v;
    }
    await env.BRACKET_KV.put(`pred:${id}`, JSON.stringify({ picks: clean, updatedAt: Date.now() }));
    return json({ ok: true });
  }

  // --- Bracket config (teams / locked) ---
  if (path === "/config" && method === "GET") {
    return json({ config: await getConfig(env) });
  }

  if (path === "/config" && method === "POST") {
    const body = await readBody(request);
    const code = (body.code || "").toString();
    const expected = (env.COMMISSIONER_CODE || "wayne-manor").toString();
    if (code !== expected) return json({ error: "Wrong Commissioner code." }, 403);
    const prev = (await getConfig(env)) || {};
    const next = { ...prev, updatedAt: Date.now() };
    if (Array.isArray(body.teams)) {
      next.teams = body.teams.slice(0, 32).map((t) => ({
        name: (t && t.name ? String(t.name) : "").slice(0, 40),
        flag: (t && t.flag ? String(t.flag) : "").slice(0, 8),
      }));
    }
    if (typeof body.locked === "boolean") next.locked = body.locked;
    if (typeof body.title === "string") next.title = body.title.slice(0, 80);
    await env.BRACKET_KV.put("config", JSON.stringify(next));
    return json({ ok: true, config: next });
  }

  // --- Everything needed to render, in one shot ---
  if (path === "/bootstrap" && method === "GET") {
    const id = url.searchParams.get("id");
    const [people, config, stats] = await Promise.all([
      listPeople(env), getConfig(env), buildStats(env),
    ]);
    let me = null, picks = {};
    if (id) {
      const person = await env.BRACKET_KV.get(`person:${id}`, "json");
      if (person) {
        me = { id: person.id, name: person.name };
        const rec = await env.BRACKET_KV.get(`pred:${id}`, "json");
        picks = (rec && rec.picks) || {};
      }
    }
    return json({ people, config, stats, me, picks });
  }

  // --- Vote tallies only ---
  if (path === "/stats" && method === "GET") {
    return json(await buildStats(env));
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: "server error", detail: String(err && err.message || err) }, 500);
      }
    }
    // Static assets (index.html, css, js). With wrangler's `assets` config
    // these are normally served before the Worker runs; this is a safety net.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
