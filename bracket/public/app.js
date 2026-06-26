/* =====================================================================
   Wayne Manor World Cup Bracket — front-end app
   Talks to the Worker API; falls back to a localStorage "demo mode" when
   the API isn't reachable (e.g. opened as a file, or not deployed yet).
   ===================================================================== */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const enc = encodeURIComponent;
  const TW_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/";
  function parseEmoji(node) {
    if (!node || !window.twemoji) return;
    try { window.twemoji.parse(node, { folder: "svg", ext: ".svg", className: "emoji", base: TW_BASE }); } catch (e) {}
  }
  const getJSON = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const setJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const ME_KEY = "wm_me";

  const state = {
    me: null,
    picks: {},
    people: [],
    teams: DEFAULT_TEAMS.map((t) => ({ ...t })),
    stats: { voters: 0, matches: {} },
    locked: false,
    custom: false,
    showCrowd: false,
    demo: false,
  };
  let pendingPick = null;
  let saveTimer = null;
  let backend = "remote";
  let justWon = false;

  /* ----------------------------- confetti 🎉 ----------------------------- */
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CCOLORS = ["#fbbf24", "#ec4899", "#2dd4bf", "#a3e635", "#38bdf8", "#fb7185", "#ffffff", "#a78bfa"];
  let cvs, cctx, parts = [], raf = null;
  function sizeCanvas() {
    if (!cvs) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = innerWidth * dpr; cvs.height = innerHeight * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function burst(x, y, n, power) {
    if (reduced || !cctx) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = power * (0.3 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.5,
        g: 0.16 + Math.random() * 0.12, life: 55 + Math.random() * 45, t: 0,
        size: 5 + Math.random() * 7, rot: Math.random() * 6, vr: (Math.random() - .5) * .5,
        color: CCOLORS[(Math.random() * CCOLORS.length) | 0], shape: Math.random() < .5 ? "r" : "c" });
    }
    if (!raf) loop();
  }
  function loop() {
    cctx.clearRect(0, 0, cvs.width, cvs.height);
    parts = parts.filter((p) => p.t < p.life && p.y < innerHeight + 40);
    for (const p of parts) {
      p.t++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      cctx.save(); cctx.globalAlpha = Math.max(0, 1 - p.t / p.life); cctx.translate(p.x, p.y); cctx.rotate(p.rot); cctx.fillStyle = p.color;
      if (p.shape === "r") cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      else { cctx.beginPath(); cctx.arc(0, 0, p.size / 2, 0, 7); cctx.fill(); }
      cctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(loop);
    else { raf = null; cctx.clearRect(0, 0, cvs.width, cvs.height); }
  }
  function celebrate() {
    const w = innerWidth, h = innerHeight;
    burst(w * 0.5, h * 0.34, 120, 13);
    setTimeout(() => burst(w * 0.18, h * 0.42, 70, 11), 140);
    setTimeout(() => burst(w * 0.82, h * 0.42, 70, 11), 260);
  }

  /* ----------------------------- data layer ----------------------------- */
  const post = (obj) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });

  async function callRemote(path, opts) {
    const res = await fetch("/api" + path, opts);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("non-json " + res.status);
    const data = await res.json();
    if (res.status >= 500) throw new Error(data.detail || ("http " + res.status));
    return data;
  }

  async function run(remoteFn, localFn) {
    if (backend === "local") return localFn();
    try { return await remoteFn(); }
    catch (e) {
      console.warn("[Wayne Manor] API unreachable — switching to demo mode.", e.message);
      backend = "local"; state.demo = true; updateDemoUI();
      return localFn();
    }
  }

  const local = {
    bootstrap(id) {
      const people = getJSON("wm_people", []);
      const config = getJSON("wm_config", null);
      const stats = local.stats();
      let me = null, picks = {};
      if (id) { const p = people.find((x) => x.id === id); if (p) { me = { id: p.id, name: p.name }; picks = getJSON("wm_pred_" + id, {}); } }
      return { people, config, stats, me, picks };
    },
    login(name) {
      name = (name || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!name) return { error: "Please enter a name." };
      const people = getJSON("wm_people", []);
      const ex = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (ex) return { person: ex, picks: getJSON("wm_pred_" + ex.id, {}), returning: true };
      const id = "loc-" + Math.random().toString(36).slice(2, 9);
      const person = { id, name }; people.push(person); setJSON("wm_people", people);
      return { person, picks: {}, returning: false };
    },
    savePicks(id, picks) { setJSON("wm_pred_" + id, picks); return { ok: true }; },
    saveConfig(code, payload) { const cur = getJSON("wm_config", {}) || {}; const next = { ...cur, ...payload }; setJSON("wm_config", next); return { ok: true, config: next }; },
    stats() {
      const matches = {}; let voters = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("wm_pred_") === 0) {
          const picks = getJSON(k, {});
          if (picks && Object.keys(picks).length) {
            voters++;
            for (const [mid, tid] of Object.entries(picks)) { (matches[mid] || (matches[mid] = {})); matches[mid][tid] = (matches[mid][tid] || 0) + 1; }
          }
        }
      }
      return { voters, matches };
    },
  };

  const store = {
    bootstrap: (id) => run(() => callRemote("/bootstrap" + (id ? "?id=" + enc(id) : "")), () => local.bootstrap(id)),
    login: (name) => run(() => callRemote("/people", post({ name })), () => local.login(name)),
    savePicks: (id, picks) => run(() => callRemote("/picks", post({ id, picks })), () => local.savePicks(id, picks)),
    saveConfig: (code, payload) => run(() => callRemote("/config", post({ code, ...payload })), () => local.saveConfig(code, payload)),
    stats: () => run(() => callRemote("/stats"), () => local.stats()),
  };

  /* ----------------------------- teams / config ----------------------------- */
  function applyConfig(config) {
    const valid = config && Array.isArray(config.teams) && config.teams.filter((t) => t && t.name).length >= 2;
    if (valid) {
      const t = config.teams.slice(0, 32);
      while (t.length < 32) t.push(null);
      state.teams = t.map((x, i) => ({ name: (x && x.name) || DEFAULT_TEAMS[i].name, flag: (x && x.flag) || DEFAULT_TEAMS[i].flag }));
      state.custom = true;
    } else {
      state.teams = DEFAULT_TEAMS.map((x) => ({ ...x }));
      state.custom = false;
    }
    state.locked = !!(config && config.locked);
  }
  const teamObj = (id) => state.teams[id] || { name: "?", flag: "🏳️" };
  function feederLabel(feederId) {
    const [r, i] = feederId.split("-");
    const rd = ROUNDS.find((x) => x.id === r);
    return "Winner " + (rd ? rd.short : r) + " " + i;
  }

  /* ----------------------------- rendering ----------------------------- */
  function renderMatch(m) {
    const card = el("div", "match" + (m.id === FINAL_ID ? " final-match" : ""));
    const votes = state.stats.matches[m.id] || {};
    const total = Object.values(votes).reduce((a, b) => a + b, 0);
    ["A", "B"].forEach((slot) => {
      const tid = slotTeam(m, slot, state.picks);
      const row = el("button", "team");
      row.type = "button";
      if (tid === null) {
        row.classList.add("empty");
        row.innerHTML = `<span class="flag">·</span><span class="tname">${esc(feederLabel(slot === "A" ? m.feedA : m.feedB))}</span>`;
      } else {
        const t = teamObj(tid);
        const isPick = state.picks[m.id] === tid;
        const hasPick = m.id in state.picks;
        if (isPick) row.classList.add("picked");
        else if (hasPick) row.classList.add("dimmed");
        const c = votes[tid] || 0;
        const pct = total ? Math.round((c / total) * 100) : 0;
        row.title = total ? `${c} of ${total} picked ${t.name} (${pct}%)` : t.name;
        row.innerHTML =
          `<span class="flag">${t.flag || "🏳️"}</span>` +
          `<span class="tname">${esc(t.name)}</span>` +
          `<span class="votes"><span class="vbar"><span style="width:${pct}%"></span></span><span class="vpct">${c}</span></span>`;
        if (state.locked) row.classList.add("locked");
        else row.addEventListener("click", () => pick(m.id, tid, row));
      }
      card.appendChild(row);
    });
    return card;
  }

  function buildSide(container, defs, flow) {
    defs.forEach((d) => {
      const col = el("div", "round " + flow + (d.first ? " r-first" : "") + (d.last ? " r-last" : ""));
      const label = el("div", "round-label");
      label.textContent = (ROUNDS.find((r) => r.id === d.round) || {}).name || d.round;
      col.appendChild(label);
      d.matches.forEach((m) => { const cell = el("div", "cell"); cell.appendChild(renderMatch(m)); col.appendChild(cell); });
      container.appendChild(col);
    });
  }

  function renderChampion() {
    const tid = state.picks[FINAL_ID];
    const hasChamp = tid === 0 || tid;
    const wrap = el("div", "champion" + (hasChamp ? "" : " empty") + (justWon ? " win" : ""));
    justWon = false;
    const votes = state.stats.matches[FINAL_ID] || {};
    let crowd = "";
    const entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      const [topId, topN] = entries[0];
      const tt = teamObj(Number(topId));
      crowd = `<div class="ch-crowd">House favorite: <b>${esc(tt.name)}</b> · ${topN} vote${topN === 1 ? "" : "s"}</div>`;
    }
    if (hasChamp) {
      const t = teamObj(tid);
      wrap.innerHTML = `<div class="ch-label">🏆 Your Champion</div><div class="ch-team"><span class="flag">${t.flag || "🏳️"}</span>${esc(t.name)}</div>${crowd}`;
    } else {
      wrap.innerHTML = `<div class="ch-label">Your Champion</div><div class="ch-empty">complete the bracket…</div>${crowd}`;
    }
    return wrap;
  }

  function render() {
    renderWho();
    const scroller = $(".bracket-scroll");
    const keepLeft = scroller ? scroller.scrollLeft : 0;

    const r32 = TREE.byRound.r32, r16 = TREE.byRound.r16, qf = TREE.byRound.qf, sf = TREE.byRound.sf, fin = TREE.byRound.final[0];
    const root = $("#bracket");
    root.innerHTML = "";

    const left = el("div", "side side-left");
    buildSide(left, [
      { round: "r32", matches: r32.slice(0, 8), first: true },
      { round: "r16", matches: r16.slice(0, 4) },
      { round: "qf", matches: qf.slice(0, 2) },
      { round: "sf", matches: [sf[0]], last: true },
    ], "flow-right");

    const center = el("div", "center");
    const fw = el("div", "final-wrap");
    fw.innerHTML = `<div class="cup">🏆</div><div class="final-label">The Final</div>`;
    fw.appendChild(renderMatch(fin));
    fw.appendChild(renderChampion());
    center.appendChild(fw);

    const right = el("div", "side side-right");
    buildSide(right, [
      { round: "sf", matches: [sf[1]], last: true },
      { round: "qf", matches: qf.slice(2, 4) },
      { round: "r16", matches: r16.slice(4, 8) },
      { round: "r32", matches: r32.slice(8, 16), first: true },
    ], "flow-left");

    root.appendChild(left);
    root.appendChild(center);
    root.appendChild(right);

    $("#placeholderBanner").hidden = state.custom;
    updateProgress();
    parseEmoji(document.body);
    fitBracket();
    if (scroller) scroller.scrollLeft = keepLeft;
  }

  function updateProgress() {
    const n = Object.keys(state.picks).length, max = 31;
    const bar = $("#progressBar"), txt = $("#progressTxt");
    if (bar) bar.style.width = Math.round((n / max) * 100) + "%";
    if (txt) txt.textContent = n >= max ? "Complete! 🎉" : n + " / " + max;
  }

  // Scale the whole diagram so it fits the screen like a tournament poster.
  // Falls back to horizontal scrolling on very small screens.
  function fitBracket() {
    const sc = $(".bracket-scroll"), br = $("#bracket");
    if (!sc || !br) return;
    br.style.zoom = "1";
    const avail = sc.clientWidth - 40; // account for scroll padding
    const natW = br.scrollWidth;
    const s = Math.max(0.4, Math.min(1, avail / natW));
    br.style.zoom = String(s);
  }

  function renderWho() {
    const w = $("#whoami");
    if (state.me) {
      const initial = (state.me.name.trim()[0] || "?").toUpperCase();
      w.innerHTML = `<span class="name"><span class="av">${esc(initial)}</span>${esc(state.me.name)}</span><button class="btn ghost small" id="switchBtn">Switch player</button>`;
      $("#switchBtn").addEventListener("click", switchUser);
    } else {
      w.innerHTML = `<button class="btn gold small" id="loginBtn">Log in / Join</button>`;
      $("#loginBtn").addEventListener("click", openLogin);
    }
  }

  function setSaveState(kind, text) {
    const s = $("#saveState");
    s.className = "savestate " + kind;
    s.textContent = text;
  }
  function updateDemoUI() {
    if (state.demo) setSaveState("dirty", "Demo mode · picks saved on this device only");
  }

  /* ----------------------------- interactions ----------------------------- */
  function pick(matchId, teamId, originEl) {
    if (state.locked) return;
    if (!state.me) { pendingPick = { matchId, teamId }; openLogin(); return; }
    const wasChamp = state.picks[FINAL_ID];
    const unpick = state.picks[matchId] === teamId;
    if (unpick) delete state.picks[matchId];
    else state.picks[matchId] = teamId;
    state.picks = sanitizePicks(state.picks);
    // celebrate: big party when a NEW champion is crowned, small pop otherwise
    if (!unpick) {
      if (matchId === FINAL_ID && state.picks[FINAL_ID] !== wasChamp) { justWon = true; celebrate(); }
      else if (originEl) { const r = originEl.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, 16, 7); }
    }
    render();
    scheduleSave();
  }

  function scheduleSave() {
    if (!state.me) return;
    setSaveState("dirty", "Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 600);
  }
  async function doSave() {
    if (!state.me) return;
    const r = await store.savePicks(state.me.id, state.picks);
    if (r && r.error) { setSaveState("dirty", r.error); return; }
    setSaveState("saved", state.demo ? "Saved on this device" : "Saved ✓");
    refreshStats();
  }
  async function refreshStats() {
    const s = await store.stats();
    if (s && s.matches) { state.stats = s; render(); }
  }

  /* ----------------------------- login modal ----------------------------- */
  function openLogin() {
    $("#loginErr").textContent = "";
    $("#nameInput").value = "";
    $("#loginModal").hidden = false;
    renderResults("");
    setTimeout(() => $("#nameInput").focus(), 30);
  }
  function closeLogin() { $("#loginModal").hidden = true; }

  function renderResults(q) {
    const box = $("#nameResults");
    const query = q.trim().toLowerCase();
    let list = state.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (query) list = list.filter((p) => p.name.toLowerCase().includes(query));
    box.innerHTML = "";
    const exact = state.people.some((p) => p.name.toLowerCase() === query);
    if (query && !exact) {
      const row = el("div", "row new");
      row.innerHTML = `<span>🦇</span> Create new player “${esc(q.trim())}”`;
      row.addEventListener("click", () => submitName(q.trim()));
      box.appendChild(row);
    }
    list.slice(0, 30).forEach((p) => {
      const row = el("div", "row");
      row.innerHTML = `<span>👤</span> ${esc(p.name)} <span class="badge">log in</span>`;
      row.addEventListener("click", () => submitName(p.name));
      box.appendChild(row);
    });
    parseEmoji(box);
  }

  async function submitName(name) {
    name = (name || "").trim();
    if (!name) { $("#loginErr").textContent = "Please type your name."; return; }
    $("#loginErr").textContent = "";
    const r = await store.login(name);
    if (r && r.error) { $("#loginErr").textContent = r.error; return; }
    state.me = { id: r.person.id, name: r.person.name };
    setJSON(ME_KEY, state.me);
    if (!state.people.some((p) => p.id === state.me.id)) state.people.push({ id: state.me.id, name: state.me.name });
    // Returning players load their saved bracket; new players keep what they've clicked so far.
    const server = r.picks || {};
    if (r.returning && Object.keys(server).length) state.picks = sanitizePicks(server);
    if (pendingPick) { state.picks[pendingPick.matchId] = pendingPick.teamId; state.picks = sanitizePicks(state.picks); pendingPick = null; }
    closeLogin();
    render();
    setSaveState("dirty", "Saving…");
    await doSave();
  }

  function switchUser() {
    localStorage.removeItem(ME_KEY);
    state.me = null; state.picks = {};
    setSaveState("", "");
    render();
    openLogin();
  }

  /* ----------------------------- commissioner modal ----------------------------- */
  function openComm() {
    $("#commErr").textContent = "";
    $("#commCode").value = "";
    $("#commLock").checked = state.locked;
    buildCommGrid(state.teams);
    $("#commModal").hidden = false;
    setTimeout(() => $("#commCode").focus(), 30);
  }
  function closeComm() { $("#commModal").hidden = true; }

  function buildCommGrid(teams) {
    const grid = $("#commGrid");
    grid.innerHTML = "";
    for (let i = 0; i < 16; i++) {
      const half = i < 8 ? "Left half" : "Right half";
      const box = el("div", "comm-match");
      box.innerHTML = `<div class="cm-h">Round-of-32 · Match ${i + 1} <span style="color:var(--faint)">(${half})</span></div>`;
      [0, 1].forEach((s) => {
        const idx = i * 2 + s;
        const t = teams[idx] || { name: "", flag: "" };
        const row = el("div", "comm-row");
        row.innerHTML =
          `<input class="input flag-in" data-flag="${idx}" maxlength="8" value="${esc(t.flag || "")}" placeholder="🏳️" />` +
          `<input class="input name-in" data-name="${idx}" maxlength="40" value="${esc(t.name || "")}" placeholder="Team ${idx + 1}" />`;
        box.appendChild(row);
      });
      grid.appendChild(box);
    }
  }

  async function commSave() {
    const teams = [];
    for (let i = 0; i < 32; i++) {
      const name = ($(`[data-name="${i}"]`).value || "").trim();
      const flag = ($(`[data-flag="${i}"]`).value || "").trim();
      teams.push({ name, flag });
    }
    if (teams.filter((t) => t.name).length < 2) { $("#commErr").textContent = "Fill in at least a couple of teams."; return; }
    const code = $("#commCode").value;
    const locked = $("#commLock").checked;
    $("#commErr").textContent = "Saving…";
    const r = await store.saveConfig(code, { teams, locked });
    if (r && r.error) { $("#commErr").textContent = r.error; return; }
    applyConfig(r.config || { teams, locked });
    state.picks = sanitizePicks(state.picks);
    closeComm();
    render();
    if (state.me) doSave(); else refreshStats();
  }

  /* ----------------------------- events / init ----------------------------- */
  function bindEvents() {
    $("#crestBtn").addEventListener("click", openComm);
    $("#loginClose").addEventListener("click", closeLogin);
    $("#commClose").addEventListener("click", closeComm);
    $("#loginGo").addEventListener("click", () => submitName($("#nameInput").value));
    $("#commSave").addEventListener("click", commSave);
    $("#commReset").addEventListener("click", () => buildCommGrid(DEFAULT_TEAMS));
    $("#nameInput").addEventListener("input", (e) => renderResults(e.target.value));
    $("#nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitName($("#nameInput").value); });
    $("#crowdToggle").addEventListener("click", () => {
      state.showCrowd = !state.showCrowd;
      $("#crowdToggle").setAttribute("aria-pressed", String(state.showCrowd));
      document.body.classList.toggle("show-crowd", state.showCrowd);
      if (state.showCrowd) refreshStats();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLogin(); closeComm(); } });
    let rsz; window.addEventListener("resize", () => { clearTimeout(rsz); rsz = setTimeout(fitBracket, 150); });
    [$("#loginModal"), $("#commModal")].forEach((ov) =>
      ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; }));
  }

  function applyBootstrap(data) {
    data = data || {};
    state.people = data.people || [];
    applyConfig(data.config);
    if (data.stats && data.stats.matches) state.stats = data.stats;
    if (data.me) {
      state.me = data.me; setJSON(ME_KEY, state.me);
      state.picks = sanitizePicks(data.picks || {});
    } else if (state.me) {
      // stored id no longer recognised by the server
      localStorage.removeItem(ME_KEY); state.me = null; state.picks = {};
    }
  }

  async function init() {
    cvs = $("#confetti"); if (cvs) { cctx = cvs.getContext("2d"); sizeCanvas(); window.addEventListener("resize", sizeCanvas); }
    state.me = getJSON(ME_KEY, null);
    bindEvents();
    const data = await store.bootstrap(state.me && state.me.id);
    applyBootstrap(data);
    render();
    if (state.demo) updateDemoUI();
    if (!state.me) openLogin();
    else if (!state.demo) setSaveState("saved", "Saved ✓");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
