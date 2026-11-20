"use strict";
(() => {
  const API = "https://aaa-stars.hancockcommune.org";
  const DAYS = [
    ["2026-11-18", "Wed", "Nov 18"], ["2026-11-19", "Thu", "Nov 19"], ["2026-11-20", "Fri", "Nov 20"],
    ["2026-11-21", "Sat", "Nov 21"], ["2026-11-22", "Sun", "Nov 22"],
  ];
  const DAY_LONG = { "2026-11-18": "Wednesday, Nov 18", "2026-11-19": "Thursday, Nov 19", "2026-11-20": "Friday, Nov 20", "2026-11-21": "Saturday, Nov 21", "2026-11-22": "Sunday, Nov 22" };
  const RESULT_PAGE = 150;
  const NOTE = `Unofficial copy of the <a href="https://americananthro.secure-platform.com/annualmeeting/solicitations/103006/sessiongallery/schedule" rel="noopener">AAA program</a> · copied Nov 20, 2026`;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // ---------- storage (every access guarded) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let device = store.get("aaa26.device", null);
  if (!device) {
    device = (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
    store.set("aaa26.device", device);
  }
  const starred = new Set(store.get("aaa26.starred", []));
  let pending = store.get("aaa26.pending", {}); // sid -> bool
  let counts = store.get("aaa26.counts", {});

  // ---------- state ----------
  let S = [];             // sessions
  const byId = new Map();
  let abstracts = null;   // loaded later
  let types = [], sections = [];
  const st = { view: "program", day: null, q: "", type: "", sec: "", sel: null, list: null, showEarlier: false, limit: RESULT_PAGE };

  // ---------- time in St. Louis ----------
  function chicagoNow() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) };
  }
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  function fmt(hhmm) {
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")}`;
  }
  const ampm = (hhmm) => (+hhmm.slice(0, 2) >= 12 ? "pm" : "am");
  const isLong = (x) => toMin(x.e) - toMin(x.s) >= 240;
  function fmtAP(hhmm) {
    const h = +hhmm.slice(0, 2);
    return fmt(hhmm) + (h >= 12 ? " pm" : " am");
  }
  function slotState(day, s, e) {
    const now = chicagoNow();
    if (now.date < DAYS[0][0] || now.date > DAYS[DAYS.length - 1][0]) return "later";
    if (day < now.date) return "past";
    if (day > now.date) return "later";
    if (toMin(e) <= now.min) return "past";
    if (toMin(s) <= now.min) return "now";
    return "later";
  }

  // ---------- search index ----------
  function secShort(sec) { return sec ? sec.split(" - ")[0] : ""; }
  function people(x) { return [...(x.org || []), ...(x.co || []), ...(x.chair || []), ...(x.disc || []), ...(x.pres || [])]; }
  function buildIndex(x) {
    const parts = [x.t, x.ty, x.loc, x.sec, (x.cat || []).join(" "), x.spon, people(x).join(" ")];
    for (const p of x.papers || []) parts.push(p.t, (p.p || []).join(" "), (p.ca || []).join(" "));
    x._h = norm(parts.join(" \u0001 "));
    x._ht = norm(x.t);
  }
  function addAbstractsToIndex() {
    for (const x of S) {
      const a = abstracts[x.id];
      if (a) x._ha = norm([a.d, ...(a.p || [])].join(" "));
    }
  }
  function terms(q) { return norm(q).split(/\s+/).filter(Boolean); }
  function matches(x, ts) {
    for (const t of ts) {
      if (!x._h.includes(t) && !(x._ha && x._ha.includes(t))) return false;
    }
    return true;
  }
  function score(x, ts) {
    let s = 0;
    for (const t of ts) { if (x._ht.includes(t)) s += 5; else if (x._h.includes(t)) s += 2; else s += 0.5; }
    return s;
  }
  function hl(text, ts) {
    let out = esc(text);
    if (!ts.length) return out;
    // highlight on the escaped text, accent-insensitive approximation
    const src = norm(text);
    const marks = [];
    for (const t of ts) {
      if (t.length < 2) continue;
      let i = 0;
      while ((i = src.indexOf(t, i)) !== -1) { marks.push([i, i + t.length]); i += t.length; }
    }
    if (!marks.length) return out;
    marks.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const m of marks) { const l = merged[merged.length - 1]; if (l && m[0] <= l[1]) l[1] = Math.max(l[1], m[1]); else merged.push(m.slice()); }
    let res = "", pos = 0;
    // norm() keeps string length for most Latin text (NFD + strip combining marks can shift); guard by falling back
    if (src.length !== text.length) return out;
    for (const [a, b] of merged) { res += esc(text.slice(pos, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>"; pos = b; }
    return res + esc(text.slice(pos));
  }
  function firstHit(x, ts) {
    // show a paper or person that matched when the title did not
    if (!ts.length || ts.every((t) => x._ht.includes(t))) return "";
    let best = null, bestN = 0;
    for (const p of x.papers || []) {
      const h = norm([p.t, ...(p.p || []), ...(p.ca || [])].join(" "));
      const n = ts.filter((t) => h.includes(t)).length;
      if (n > bestN) { best = p; bestN = n; }
    }
    if (best) return `<span class="hit"><b>Paper</b>${hl(best.t, ts)}${best.p && best.p.length ? " · " + hl(best.p.map(nameOnly).join(", "), ts) : ""}</span>`;
    const who = people(x).find((n) => ts.some((t) => norm(n).includes(t)));
    if (who) return `<span class="hit"><b>Person</b>${hl(who, ts)}</span>`;
    const a = abstracts && abstracts[x.id];
    if (a) {
      for (const txt of [a.d, ...(a.p || [])]) {
        const n = norm(txt || "");
        const t = ts.find((t) => n.includes(t));
        if (!t) continue;
        const i = n.indexOf(t);
        const from = Math.max(0, txt.lastIndexOf(" ", Math.max(0, i - 60)) + 1);
        const to = Math.min(txt.length, i + t.length + 90);
        const cut = txt.slice(from, to).replace(/\s+/g, " ");
        return `<span class="excerpt">${from > 0 ? "…" : ""}${hl(cut, ts)}${to < txt.length ? "…" : ""}</span>`;
      }
    }
    return "";
  }
  const nameOnly = (s) => s.split(",")[0];

  // ---------- rendering ----------
  function rowHTML(x, ts, extra = "") {
    const on = starred.has(x.id);
    const n = counts[x.id] || 0;
    const meta = [secShort(x.sec) ? `<span class="sec">${esc(secShort(x.sec))}</span>` : "", esc(x.ty), esc(x.loc)].filter(Boolean).join(" · ");
    return `<article class="row${on ? " starred" : ""}${st.sel === x.id ? " sel" : ""}" data-id="${x.id}">
      <button type="button" class="open" data-open="${x.id}"><span class="t">${hl(x.t, ts)}</span><span class="m">${meta}</span>${firstHit(x, ts)}${extra}</button>
      <button type="button" class="star" data-star="${x.id}" aria-pressed="${on}" aria-label="${on ? "Unstar" : "Star"}: ${esc(x.t)}"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg><span class="c">${n || ""}</span></button>
    </article>`;
  }
  function slotHTML(day, s, e, rows, opts = {}) {
    const state = opts.noState ? "" : slotState(day, s, e);
    const label = state === "now" ? "now" : state === "past" ? "" : opts.next ? "next" : "";
    return `<section class="slot ${state}" aria-label="${fmtAP(s)} to ${fmtAP(e)}">
      <div class="key"><div class="kk"><span class="k-start">${fmt(s)}${ampm(s) !== ampm(e) ? `<small>${ampm(s)}</small>` : ""}</span><span class="k-end">${fmt(e)}<small>${ampm(e)}</small></span>${label ? `<span class="k-state">${label}</span>` : ""}</div></div>
      <div class="rows">${rows}</div></section>`;
  }
  function groupSlots(list) {
    const g = new Map();
    for (const x of list) {
      const k = `${x.d}|${x.s}|${x.e}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(x);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }
  function filtered() {
    return S.filter((x) => (!st.type || x.ty === st.type) && (!st.sec || secShort(x.sec) === st.sec));
  }

  function renderProgram() {
    const ts = terms(st.q);
    let list = filtered();
    let html = "";
    let status = "";
    if (ts.length) {
      list = list.filter((x) => matches(x, ts));
      const total = list.length;
      // stay in time order, but pull title hits forward inside the result set? keep time order; it's a program.
      const spent = list.filter((x) => slotState(x.d, x.s, x.e) === "past");
      const live = list.filter((x) => slotState(x.d, x.s, x.e) !== "past");
      const ordered = st.showEarlier ? [...live, ...spent] : live;
      const shown = ordered.slice(0, st.limit);
      status = total ? `${total} ${total === 1 ? "session" : "sessions"}` : "";
      const render = (arr) => {
        let out = "", lastDay = "";
        for (const [k, rows] of groupSlots(arr)) {
          const [d, s, e] = k.split("|");
          if (d !== lastDay) { out += `<h2 class="day-head">${DAY_LONG[d] || d}</h2>`; lastDay = d; }
          rows.sort((a, b) => score(b, ts) - score(a, ts));
          out += slotHTML(d, s, e, rows.map((x) => rowHTML(x, ts)).join(""));
        }
        return out;
      };
      html += render(shown.filter((x) => !spent.includes(x)));
      if (spent.length && !st.showEarlier) html += `<button type="button" class="earlier" data-earlier>Earlier · <span>${spent.length} sessions</span></button>`;
      if (st.showEarlier) html += render(shown.filter((x) => spent.includes(x)));
      if (!live.length && !st.showEarlier && spent.length) html = `<button type="button" class="earlier" data-earlier>Earlier · <span>${spent.length} sessions</span></button>`;
      if (ordered.length > shown.length) html += `<button type="button" class="more" data-more>Show ${Math.min(RESULT_PAGE, ordered.length - shown.length)} more</button>`;
      if (!total) html = emptyHTML("No matches");
    } else {
      list = list.filter((x) => x.d === st.day);
      const long = list.filter(isLong);
      const groups = groupSlots(list.filter((x) => !isLong(x)));
      const now = chicagoNow();
      const isToday = st.day === now.date;
      let pastCount = 0, nextMarked = false;
      const parts = [];
      for (const [k, rows] of groups) {
        const [d, s, e] = k.split("|");
        const state = slotState(d, s, e);
        if (isToday && state === "past" && !st.showEarlier) { pastCount += rows.length; continue; }
        let next = false;
        if (isToday && state === "later" && !nextMarked) { next = true; nextMarked = true; }
        parts.push(slotHTML(d, s, e, rows.map((x) => rowHTML(x, ts)).join(""), { next }));
      }
      if (pastCount) html += `<button type="button" class="earlier" data-earlier>Earlier today · <span>${pastCount} sessions</span></button>`;
      html += parts.join("");
      if (long.length) {
        html += `<h2 class="day-head">All day and evening</h2>`;
        html += long.map((x) => slotHTML(x.d, x.s, x.e, rowHTML(x, ts))).join("");
      }
      status = `${list.length} sessions`;
      if (!list.length) html = emptyHTML("Nothing on this day");
    }
    $("#status").textContent = status;
    $("#list").innerHTML = html;
  }

  function clashes(list) {
    const out = new Set();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.d !== b.d) continue;
      if (toMin(a.s) < toMin(b.e) && toMin(b.s) < toMin(a.e)) { out.add(a.id); out.add(b.id); }
    }
    return out;
  }
  function renderList(ids, title, shared) {
    const list = ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (a.d + a.s + a.e).localeCompare(b.d + b.s + b.e));
    const cl = clashes(list);
    let html = `<div class="bar"><h2>${esc(title)} · ${list.length}</h2>`;
    if (shared) {
      const missing = list.filter((x) => !starred.has(x.id)).length;
      html += missing ? `<button type="button" class="btn primary" data-starall>Star all ${missing}</button>` : "";
    } else if (list.length) {
      html += `<button type="button" class="btn" data-share>Share list</button><button type="button" class="btn" data-ics>Add to calendar</button>`;
    }
    html += `</div>`;
    if (!list.length) {
      html += emptyHTML(shared ? "Empty list" : "No stars yet");
    }
    let lastDay = "";
    for (const [k, rows] of groupSlots(list)) {
      const [d, s, e] = k.split("|");
      if (d !== lastDay) { html += `<h2 class="day-head">${DAY_LONG[d] || d}</h2>`; lastDay = d; }
      html += slotHTML(d, s, e, rows.map((x) => rowHTML(x, [], cl.has(x.id) ? `<span class="clash">Clash</span>` : "")).join(""));
    }
    html += `<p class="list-note">${NOTE}</p>`;
    $("#status").textContent = "";
    $("#list").innerHTML = html;
  }
  function emptyHTML(head) { return `<div class="empty"><b>${esc(head)}</b></div>`; }

  function paras(text) { return String(text || "").split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""); }
  function whoList(arr) { return (arr || []).map((n) => `<button type="button" class="who" data-person="${esc(nameOnly(n))}">${esc(n)}</button>`).join(""); }

  function renderDetail() {
    const el = $("#detail");
    const x = st.sel && byId.get(st.sel);
    if (!x) { el.hidden = true; el.innerHTML = ""; document.body.style.overflow = ""; return; }
    const on = starred.has(x.id), n = counts[x.id] || 0;
    const a = abstracts && abstracts[x.id];
    const facts = [];
    const add = (k, v) => { if (v && (Array.isArray(v) ? v.length : true)) facts.push(`<dt>${k}</dt><dd>${Array.isArray(v) ? whoList(v) : esc(v)}</dd>`); };
    add((x.org || []).length > 1 ? "Organizers" : "Organizer", x.org);
    add("Co-organizers", x.co);
    add((x.chair || []).length > 1 ? "Chairs" : "Chair", x.chair);
    add((x.disc || []).length > 1 ? "Discussants" : "Discussant", x.disc);
    if (!(x.papers || []).length) add("Presenters", x.pres);
    add("Section", x.sec);
    add("Topic", (x.cat || []).join("; "));
    add("Sponsor", x.spon);
    let papers = "";
    if ((x.papers || []).length) {
      papers = `<h3 class="d-sec">Papers</h3><ol class="papers">` + x.papers.map((p, i) => {
        const ab = a && a.p && a.p[i];
        const who = [...(p.p || [])];
        return `<li><div><div class="p-t">${esc(p.t)}</div>
          ${who.length ? `<div class="p-who">${whoList(who)}</div>` : ""}
          ${(p.ca || []).length ? `<div class="p-who">With ${whoList(p.ca)}</div>` : ""}
          ${ab ? `<details><summary>Abstract</summary><div class="prose">${paras(ab)}</div></details>` : ""}</div></li>`;
      }).join("") + `</ol>`;
    }
    const desc = a ? (a.d ? `<h3 class="d-sec">${x.papers && x.papers.length ? "Description" : "Abstract"}</h3><div class="prose">${paras(a.d)}</div>` : "")
      : `<p class="loading">Loading abstract…</p>`;
    el.innerHTML = `<div class="d-top">
        <button type="button" class="x" data-close aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg></button>
        <div class="when">${DAY_LONG[x.d]} · ${fmtAP(x.s)}–${fmtAP(x.e)}<span>${esc(x.loc)} · ${esc(x.ty)}</span></div>
      </div>
      <div class="d-body">
        <h2 class="d-title" id="d-title" tabindex="-1">${esc(x.t)}</h2>
        <div class="d-actions">
          <button type="button" class="btn" data-star="${x.id}" aria-pressed="${on}"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg>${on ? "Starred" : "Star"}${n ? ` · ${n}` : ""}</button>
          <button type="button" class="btn" data-ics1="${x.id}">Add to calendar</button>
          <button type="button" class="btn" data-copy="${x.id}">Copy link</button>
        </div>
        ${facts.length ? `<dl class="d-facts">${facts.join("")}</dl>` : ""}
        ${desc}${papers}
        <p class="d-note">${NOTE}</p>
      </div>`;
    el.hidden = false;
    if (!matchMedia("(min-width: 1100px)").matches) document.body.style.overflow = "hidden";
    el.scrollTop = 0;
  }

  function renderChrome() {
    $("#days").innerHTML = DAYS.map(([d, short, date]) => {
      const cur = !st.q && st.view === "program" && st.day === d;
      const today = chicagoNow().date === d;
      return `<a href="#day=${d}" data-day="${d}" aria-current="${cur}"${today ? ' class="today"' : ""}>${short}<small>${date.split(" ")[1]}</small></a>`;
    }).join("");
    for (const a of $$("[data-view]")) a.classList.toggle("on", a.dataset.view === (st.view === "shared" ? "starred" : st.view));
    for (const el of $$(".starred-n")) el.textContent = starred.size || "";
    $("#clear").hidden = !st.q;
    $("#f-type").classList.toggle("set", !!st.type);
    $("#f-sec").classList.toggle("set", !!st.sec);
    $(".filters").hidden = st.view !== "program";
  }

  function render() {
    renderChrome();
    if (st.view === "starred") renderList([...starred], "Starred", false);
    else if (st.view === "shared") renderList(st.list || [], "Shared list", true);
    else renderProgram();
    renderDetail();
  }

  // ---------- routing (hash holds view, day, query, selection) ----------
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    st.view = h.get("v") === "starred" ? "starred" : h.get("list") ? "shared" : "program";
    st.list = h.get("list") ? h.get("list").split(",").map(Number).filter(Boolean) : null;
    st.day = h.get("day") || st.day || defaultDay();
    st.q = h.get("q") || "";
    st.sel = h.get("s") ? Number(h.get("s")) : null;
    st.limit = RESULT_PAGE;
    $("#q").value = st.q;
  }
  function writeHash(push = true) {
    const h = new URLSearchParams();
    if (st.view === "starred") h.set("v", "starred");
    if (st.view === "shared" && st.list) h.set("list", st.list.join(","));
    if (st.view === "program" && st.day !== defaultDay()) h.set("day", st.day);
    if (st.q) h.set("q", st.q);
    if (st.sel) h.set("s", st.sel);
    const str = h.toString().replace(/%2C/g, ",");
    const url = location.pathname + location.search + (str ? "#" + str : "");
    if (url === location.pathname + location.search + location.hash) return;
    history[push ? "pushState" : "replaceState"](null, "", url);
  }
  function defaultDay() {
    const d = chicagoNow().date;
    return DAYS.some(([x]) => x === d) ? d : DAYS[0][0];
  }

  // ---------- stars and counts ----------
  function saveStars() { store.set("aaa26.starred", [...starred]); }
  function toggleStar(id, force) {
    const on = force ?? !starred.has(id);
    if (on === starred.has(id)) return;
    if (on) starred.add(id); else starred.delete(id);
    counts[id] = Math.max(0, (counts[id] || 0) + (on ? 1 : -1));
    saveStars();
    pending[id] = on; store.set("aaa26.pending", pending);
    flush();
    // update in place rather than re-render, so scroll and focus stay put
    for (const b of $$(`[data-star="${id}"]`)) {
      b.setAttribute("aria-pressed", on);
      if (b.classList.contains("star")) {
        b.querySelector(".c").textContent = counts[id] || "";
        b.setAttribute("aria-label", `${on ? "Unstar" : "Star"}: ${byId.get(id).t}`);
        b.closest(".row").classList.toggle("starred", on);
      } else {
        b.lastChild.textContent = `${on ? "Starred" : "Star"}${counts[id] ? ` · ${counts[id]}` : ""}`;
      }
    }
    for (const el of $$(".starred-n")) el.textContent = starred.size || "";
    if (st.view !== "program") renderList(st.view === "starred" ? [...starred] : st.list || [], st.view === "starred" ? "Starred" : "Shared list", st.view === "shared");
  }
  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      for (const [sid, on] of Object.entries(pending)) {
        const r = await fetch(API + "/star", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device, sid: Number(sid), on }) });
        if (r.ok || r.status === 400 || r.status === 429) {
          if (r.ok) { const j = await r.json(); counts[j.sid] = j.n; }
          if (pending[sid] === on) delete pending[sid];
        } else break;
      }
    } catch {}
    store.set("aaa26.pending", pending);
    store.set("aaa26.counts", counts);
    flushing = false;
  }
  async function loadCounts() {
    try {
      const r = await fetch(API + "/counts", { cache: "no-store" });
      if (!r.ok) return;
      const c = await r.json();
      counts = {};
      for (const [k, v] of Object.entries(c)) counts[k] = v;
      // keep this device's unsent changes visible
      for (const [sid, on] of Object.entries(pending)) counts[sid] = Math.max(0, (counts[sid] || 0) + (on ? 1 : -1));
      store.set("aaa26.counts", counts);
      for (const b of $$(".star[data-star]")) b.querySelector(".c").textContent = counts[b.dataset.star] || "";
    } catch {}
  }

  // ---------- calendar ----------
  function icsFor(list) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const dt = (d, t) => d.replace(/-/g, "") + "T" + t.replace(":", "") + "00";
    const fold = (s) => s.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//aaa2026-program//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VTIMEZONE", "TZID:America/Chicago", "BEGIN:STANDARD", "DTSTART:20261101T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600", "TZNAME:CST", "END:STANDARD", "END:VTIMEZONE"];
    for (const x of list) {
      lines.push("BEGIN:VEVENT", `UID:aaa2026-${x.id}@program`, `DTSTAMP:${stamp}`,
        `DTSTART;TZID=America/Chicago:${dt(x.d, x.s)}`, `DTEND;TZID=America/Chicago:${dt(x.d, x.e)}`,
        `SUMMARY:${fold(x.t)}`, `LOCATION:${fold(x.loc)}`, `DESCRIPTION:${fold(x.ty + (x.sec ? " · " + x.sec : ""))}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = list.length === 1 ? `aaa2026-${list[0].id}.ics` : "aaa2026-starred.ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  async function copy(text, msg) {
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ url: text }); return; }
      await navigator.clipboard.writeText(text); toast(msg);
    } catch { prompt("Copy this link", text); }
  }
  const baseURL = () => location.origin + location.pathname;

  // ---------- events ----------
  let qTimer;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      st.q = e.target.value.trim(); st.limit = RESULT_PAGE; st.showEarlier = false;
      if (st.view !== "program") st.view = "program";
      writeHash(false); render(); window.scrollTo(0, 0);
    }, 90);
  });
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; e.target.dispatchEvent(new Event("input")); } });
  $("#clear").addEventListener("click", () => { $("#q").value = ""; st.q = ""; writeHash(false); render(); $("#q").focus(); });
  $("#f-type").addEventListener("change", (e) => { st.type = e.target.value; render(); });
  $("#f-sec").addEventListener("change", (e) => { st.sec = e.target.value; render(); });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;
    if (d.star) { e.preventDefault(); toggleStar(Number(d.star)); return; }
    if (d.open) { st.sel = Number(d.open); writeHash(true); renderDetail(); markSel(); focusDetail(); return; }
    if ("close" in d) { closeDetail(); return; }
    if (d.day) { e.preventDefault(); st.view = "program"; st.day = d.day; st.q = ""; $("#q").value = ""; st.sel = null; st.showEarlier = false; writeHash(true); render(); window.scrollTo(0, 0); scrollToNow(); return; }
    if (d.view) { e.preventDefault(); st.view = d.view; st.sel = null; if (d.view === "program") { st.q = ""; $("#q").value = ""; } writeHash(true); render(); window.scrollTo(0, 0); if (d.view === "program") scrollToNow(); return; }
    if ("home" in d) { e.preventDefault(); st.view = "program"; st.day = defaultDay(); st.q = ""; $("#q").value = ""; st.sel = null; writeHash(true); render(); window.scrollTo(0, 0); scrollToNow(); return; }
    if ("earlier" in d) { st.showEarlier = true; render(); return; }
    if ("more" in d) { st.limit += RESULT_PAGE; render(); return; }
    if (d.person) { st.q = d.person; $("#q").value = st.q; st.view = "program"; st.sel = null; writeHash(true); render(); window.scrollTo(0, 0); return; }
    if ("share" in d) { copy(`${baseURL()}#list=${[...starred].join(",")}`, "Link copied"); return; }
    if ("starall" in d) { for (const id of st.list || []) if (byId.has(id)) toggleStar(id, true); return; }
    if ("ics" in d) { icsFor([...starred].map((id) => byId.get(id)).filter(Boolean)); return; }
    if (d.ics1) { icsFor([byId.get(Number(d.ics1))]); return; }
    if (d.copy) { copy(`${baseURL()}#s=${d.copy}`, "Link copied"); return; }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.sel) closeDetail(); });
  window.addEventListener("popstate", () => { readHash(); render(); });
  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadCounts(); if (st.view === "program" && !st.q) renderProgram(); } });

  let lastOpener = null;
  function focusDetail() { lastOpener = document.activeElement; const h = $("#d-title"); if (h) h.focus({ preventScroll: true }); }
  function closeDetail() {
    const id = st.sel; st.sel = null; writeHash(true); renderDetail(); markSel();
    const b = id && $(`.open[data-open="${id}"]`); if (b) b.focus({ preventScroll: true });
  }
  function markSel() { for (const r of $$(".row")) r.classList.toggle("sel", Number(r.dataset.id) === st.sel); }
  function scrollToNow() {
    if (st.view !== "program" || st.q || st.day !== chicagoNow().date) return;
    const el = $(".slot.now") || $(".slot.later");
    if (el && $(".earlier") == null && el.previousElementSibling) el.scrollIntoView({ block: "start" });
  }

  // ---------- boot ----------
  async function boot() {
    readHash();
    try {
      const r = await fetch("data/core.json");
      const data = await r.json();
      S = data.sessions;
    } catch {
      $("#status").innerHTML = `Couldn't load · <button type="button" onclick="location.reload()">Try again</button>`;
      return;
    }
    for (const x of S) { byId.set(x.id, x); buildIndex(x); }
    types = [...new Set(S.map((x) => x.ty))].sort();
    sections = [...new Set(S.map((x) => secShort(x.sec)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const fullSec = Object.fromEntries(S.filter((x) => x.sec).map((x) => [secShort(x.sec), x.sec]));
    $("#f-type").insertAdjacentHTML("beforeend", types.map((t) => `<option>${esc(t)}</option>`).join(""));
    $("#f-sec").insertAdjacentHTML("beforeend", sections.map((s) => `<option value="${esc(s)}">${esc(fullSec[s] || s)}</option>`).join(""));
    render();
    scrollToNow();
    loadCounts(); flush();
    setInterval(() => { if (!document.hidden) loadCounts(); }, 120000);
    setInterval(() => { if (!document.hidden && st.view === "program" && !st.q) { const y = scrollY; renderProgram(); scrollTo(0, y); } }, 60000);
    const loadAbstracts = async () => {
      try {
        abstracts = await (await fetch("data/abstracts.json")).json();
        addAbstractsToIndex();
        if (st.q) renderProgram();
        if (st.sel) renderDetail();
      } catch {}
    };
    setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(loadAbstracts, { timeout: 2000 }) : loadAbstracts()), 300);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  boot();
})();
