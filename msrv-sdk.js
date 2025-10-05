/* MinecraftServers.ru Server API SDK v.1.1.2 */

(function () {
  // =========================
  // Global configuration
  // =========================
  const GLOBAL_CONFIG = {
    // When false (default): if cache is fresh => do NOT revalidate in background.
    // When true: always revalidate (SWR).
    swr: false,
  };

  // =========================
  // Constants / Utilities
  // =========================
  const DEFAULT_TTL = 60 * 1000; // 1 minute
  const KEY = (t) => `msrv:${t}`;
  const API = (t) => `https://minecraftservers.ru/web/json-${encodeURIComponent(t)}.json`;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));

  const prefersDark = () => !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const STR = {
    ru: {
      online: "Онлайн",
      offline: "Выключен",
      players: "Онлайн",
      version: "Версия",
      ping: "Пинг",
      updated: "Обновлено",
      rating: "Рейтинг",
      vote: "Голосовать за сервер",
      location: "Локация",
      justNow: "только что",
    },
    en: {
      online: "Online",
      offline: "Offline",
      players: "Players",
      version: "Version",
      ping: "Ping",
      updated: "Updated",
      rating: "Rating",
      vote: "Vote for server",
      location: "Location",
      justNow: "just now",
    },
  };

  function tr(key, el) {
    const lang =
      el?.getAttribute?.("data-lang") ||
      window.MSRV?.locale ||
      navigator.language?.slice(0, 2) ||
      "ru";
    return (STR[lang] || STR.ru)[key] || key;
  }

  const rtf = (() => {
    try {
      return new Intl.RelativeTimeFormat(navigator.language, { numeric: "auto" });
    } catch {
      return null;
    }
  })();

  function fmtRel(ts, el) {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    const diffSec = Math.round((Date.now() - d.getTime()) / 1000);

    if (Math.abs(diffSec) < 45) return tr("justNow", el);

    if (rtf) {
      const abs = Math.abs(diffSec);
      if (abs < 60) return rtf.format(-diffSec, "second");
      if (abs < 3600) return rtf.format(-Math.round(diffSec / 60), "minute");
      if (abs < 86400) return rtf.format(-Math.round(diffSec / 3600), "hour");
    }
    return d.toLocaleString();
  }

  function palette(mode) {
    const dark = mode === "dark" || (mode === "auto" && prefersDark());
    return dark
      ? {
          bg: "#0b0f14",
          card: "#0f1620",
          line: "#1f2a37",
          text: "#e5e7eb",
          sub: "#9ca3af",
          goodBg: "#0a2e22",
          good: "#34d399",
          badBg: "#2a0f12",
          bad: "#f87171",
          chip: "#111827",
          chipBorder: "#2b3644",
          btn: "#1f2937",
          btnText: "#e5e7eb",
        }
      : {
          bg: "#fafafa",
          card: "#fafafa",
          line: "#e5e7eb",
          text: "#111827",
          sub: "#6b7280",
          goodBg: "#e7f9ef",
          good: "#065f46",
          badBg: "#fde8e8",
          bad: "#991b1b",
          chip: "#fff",
          chipBorder: "#e5e7eb",
          btn: "#111827",
          btnText: "#fff",
        };
  }

  function wantsDark(el) {
    const v = (el.getAttribute?.("data-dark-theme") || "").toLowerCase();
    if (v === "true" || v === "1" || v === "dark") return "dark";
    if (v === "auto") return "auto";
    return "light";
  }

  function safeHttpsUrl(u) {
    if (!u || /^\s*$/.test(u)) return null;
    try {
      const x = new URL(u, location.href);
      return x.protocol === "https:" ? x.href : null;
    } catch {
      return null;
    }
  }

  // =========================
  // Network: timeout + retry
  // =========================
  async function fetchJSON(url, { timeout = 6000, retries = 1 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), timeout);
      try {
        //await new Promise((res) => setTimeout(res, 1000)); // 1s delay
        const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        clearTimeout(tid);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) {
        clearTimeout(tid);
        if (attempt === retries) throw e;
        await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
      }
    }
  }

  // =========================
  // Cache + request coalescing
  // =========================
  const memCache = new Map();
  const inflight = new Map(); 

  function readLocal(token) {
    if (memCache.has(token)) return memCache.get(token);
    try {
      const raw = localStorage.getItem(KEY(token));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      memCache.set(token, obj);
      return obj;
    } catch {
      return null;
    }
  }

  function writeLocal(token, obj) {
    memCache.set(token, obj);
    try {
      localStorage.setItem(KEY(token), JSON.stringify(obj));
    } catch {
    }
  }

  async function requestOnce(token) {
    if (inflight.has(token)) return inflight.get(token);
    const p = (async () => await fetchJSON(API(token), { timeout: 7000, retries: 1 }))().finally(() => inflight.delete(token));
    inflight.set(token, p);
    return p;
  }

  // =========================
  // Token state
  // =========================
  // token -> { status: 'idle'|'pending'|'ready'|'error', data?, err? }
  const tokenState = new Map();

  /**
   * SWR-aware getter.
   * - If cache is fresh and swr=false => render from cache and DO NOT hit network.
   * - If cache stale or missing => fetch.
   * - If swr=true => revalidate even when cache is fresh (background).
   */
  async function getDataSWR(token, ttl, onUpdate, opts = {}) {
    const swr =
      opts.swr ||
      (window.MSRV && MSRV.config && MSRV.config.swr) ||
      GLOBAL_CONFIG.swr ||
      false;

    const cachedObj = readLocal(token);
    const isFresh = !!(cachedObj && Date.now() - cachedObj.t < ttl);

    // fresh cache: emit and early-return if SWR is disabled
    if (isFresh) {
      tokenState.set(token, { status: "ready", data: cachedObj.d });
      onUpdate?.(cachedObj.d, { from: "cache" });
      if (!swr) return;
    }

    // if already pending, await same promise
    const st = tokenState.get(token);
    if (st?.status === "pending") {
      try {
        const d = await inflight.get(token);
        tokenState.set(token, { status: "ready", data: d });
        onUpdate?.(d, { from: "pending" });
        return;
      } catch {
        // fall through to normal fetch
      }
    }

    // fetch if no fresh cache OR swr revalidation requested
    tokenState.set(token, { status: "pending" });
    try {
      const fresh = await requestOnce(token);
      writeLocal(token, { t: Date.now(), d: fresh });
      tokenState.set(token, { status: "ready", data: fresh });
      onUpdate?.(fresh, { from: isFresh ? "network(revalidate)" : "network" });
    } catch (e) {
      tokenState.set(token, { status: "error", err: e });
      if (!isFresh) throw e; // no fresh cache to fall back on
    }
  }

  // =========================
  // MC-format
  // =========================
  function mcToHtml(input) {
    if (!input) return "";
    let s = String(input).replace(/&([0-9A-FK-ORX#])/gi, "§$1");
    const COLORS = {
      0: "#000000",
      1: "#0000AA",
      2: "#00AA00",
      3: "#00AAAA",
      4: "#AA0000",
      5: "#AA00AA",
      6: "#FFAA00",
      7: "#AAAAAA",
      8: "#555555",
      9: "#5555FF",
      a: "#55FF55",
      b: "#55FFFF",
      c: "#FF5555",
      d: "#FF55FF",
      e: "#FFFF55",
      f: "#FFFFFF",
    };
    let cur = { color: null, b: false, i: false, u: false, s: false },
      out = [],
      buf = "";

    const flush = () => {
      if (!buf) return;
      const st = [];
      if (cur.color) st.push(`color:${cur.color}`);
      if (cur.b) st.push("font-weight:700");
      if (cur.i) st.push("font-style:italic");
      if (cur.u) st.push(`text-decoration:underline${cur.s ? " line-through" : ""}`);
      else if (cur.s) st.push("text-decoration:line-through");
      const open = st.length ? `<span style="${st.join(";")}">` : "";
      const close = st.length ? `</span>` : "";
      out.push(open + esc(buf).replace(/\n/g, "<br>") + close);
      buf = "";
    };

    const apply = (c) => {
      c = c.toLowerCase();
      if (c in COLORS) {
        flush();
        cur.color = COLORS[c];
        return;
      }
      if (c === "l") {
        flush();
        cur.b = true;
        return;
      }
      if (c === "m") {
        flush();
        cur.s = true;
        return;
      }
      if (c === "n") {
        flush();
        cur.u = true;
        return;
      }
      if (c === "o") {
        flush();
        cur.i = true;
        return;
      }
      if (c === "r") {
        flush();
        cur = { color: null, b: false, i: false, u: false, s: false };
        return;
      }
    };

    const tryHexAt = (i) => {
      if (s[i + 1]?.toLowerCase() === "x") {
        const seq = s.slice(i, i + 14);
        if (/^§x(§[0-9A-Fa-f]){6}/.test(seq)) {
          const hex = seq.match(/[0-9A-Fa-f]/g).join("");
          flush();
          cur.color = "#" + hex;
          return 14;
        }
      }
      if (s[i + 1] === "#") {
        const hex = s.slice(i + 2, i + 8);
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
          flush();
          cur.color = "#" + hex;
          return 8;
        }
      }
      return 0;
    };

    for (let i = 0; i < s.length; i++) {
      if (s[i] === "§") {
        const used = tryHexAt(i);
        if (used) {
          i += used - 1;
          continue;
        }
        const n = s[i + 1];
        if (n) {
          apply(n);
          i++;
          continue;
        }
      }
      buf += s[i];
    }
    flush();
    return out.join("");
  }

  // =========================
  // Icons / placeholders
  // =========================
  function svgPlaceholder(size, P) {
    const s = size || 48;
    const bg = P.card;
    const br = P.line;
    const tx = P.sub;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="0.5" y="0.5" width="47" height="47" rx="10" ry="10" fill="${bg}" stroke="${br}" />
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="system-ui,Segoe UI,Roboto" font-size="14" font-weight="700" fill="${tx}">MS</text>
    </svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function iconSrc(d, P, size) {
    const url = (d.icon || "").trim();
    const safe = safeHttpsUrl(url);
    return safe || svgPlaceholder(size, P);
  }

  // =========================
  // Widget helpers
  // =========================
  function wrapIfLink(el, inner, d) {
    if (!el.hasAttribute("data-url-enabled")) return inner;
    const sid = d.serverid ?? d.server_id ?? d.id;
    if (!sid) return inner;
    const href = `https://minecraftservers.ru/server/${encodeURIComponent(String(sid))}`;
    return `<a href="${href}" style="text-decoration:none;color:inherit;display:block" tabindex="0" rel="noopener noreferrer">${inner}</a>`;
  }

  function voteUrl(el, d) {
    const o = el.getAttribute("data-vote-url");
    if (o) return safeHttpsUrl(o);
    const sid = d.serverid ?? d.server_id ?? d.id;
    return sid ? `https://minecraftservers.ru/server/${encodeURIComponent(String(sid))}#vote` : null;
  }

  // === Skeletons (dark-aware, per-widget height, error overlay) ===
  function getSkeletonHeight(el, sel) {
    const a = el.getAttribute("data-height");
    if (a && +a > 0) return +a;

    switch (sel) {
      case ".msrv-card":
        return 196; 
      case ".msrv-banner":
        return 120; 
      case ".msrv-row":
        return 60; 
      case ".msrv-badge":
        return 32; 
      case ".msrv-vote":
        return 96;
      default:
        return 72;
    }
  }

  function setSkeleton(el, P, height) {
    const dark = wantsDark(el) === "dark" || (wantsDark(el) === "auto" && prefersDark());
    const shine = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)";

    el.innerHTML = `
    <div class="msrv-skel" style="
         position:relative; height:${height}px;
         border:1px solid ${P.line}; border-radius:12px; overflow:hidden;
         background:${P.card};">
      <div class="msrv-skel-shimmer"
           role="status" aria-busy="true"
           style="position:absolute; inset:0;
                  background:linear-gradient(90deg, transparent, ${shine}, transparent);
                  background-size:200% 100%; animation:msrv-skel 1.2s infinite;"></div>
      <div class="msrv-skel-msg"
           aria-live="polite"
           style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                  padding:0 12px; text-align:center;
                  font:600 14px/1.4 system-ui, Segoe UI, Roboto;
                  color:${P.text}; opacity:0; transition:opacity .2s ease;"></div>
    </div>`;
    injectSkeletonKeyframes();
  }

  function injectSkeletonKeyframes() {
    if (document.getElementById("msrv-skel-style")) return;
    const st = document.createElement("style");
    st.id = "msrv-skel-style";
    st.textContent = `
    @keyframes msrv-skel { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
    .msrv-skel--error .msrv-skel-msg { opacity: 1; }
	@media (prefers-reduced-motion: reduce){
	  .msrv-skel, .msrv-skel * { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; }
	}`;
    document.head.appendChild(st);
  }

  function showError(el, P, text = "failed to load") {
    if (!el.querySelector(".msrv-skel")) {
      setSkeleton(el, P, 72);
    }
    const wrap = el.querySelector(".msrv-skel");
    const msg = el.querySelector(".msrv-skel-msg");
    if (wrap && msg) {
      msg.textContent = text;
      msg.style.color = P.bad ?? "#ef4444";
      wrap.classList.add("msrv-skel--error");
    } else {
      el.innerHTML = `<div style="height:72px;display:flex;align-items:center;justify-content:center;
                            border:1px solid ${P.line};border-radius:12px;color:${P.bad ?? "#ef4444"}">
                      ${text}
                    </div>`;
    }
  }

  // =========================
  // Renderers
  // =========================
  async function renderBadge(el, d) {
    const P = palette(wantsDark(el));
    const online = d.status == 1 || d.status === "1";
    const html = `<span role="status" aria-live="polite" style="display:inline-flex;align-items:center;gap:.5em;padding:.35em .6em;border-radius:999px;
      background:${online ? P.goodBg : P.badBg};color:${online ? P.good : P.bad};font:600 14px/1 system-ui,Segoe UI,Roboto;">
      <span aria-hidden="true" style="width:.6em;height:.6em;border-radius:50%;background:${online ? "#10b981" : "#ef4444"}"></span>${online ? esc(tr("online", el)) : esc(tr("offline", el))}</span>`;
    el.innerHTML = wrapIfLink(el, html, d);
  }

  async function renderCard(el, d) {
    const P = palette(wantsDark(el));
    const online = d.status == 1 || d.status === "1";
    const players = `${d.players}/${d.maxplayers}`;
    const versionText = d.version_from ? `${d.version_from}–${d.version}` : d.version || "";
    const motd = d.motd ? mcToHtml(d.motd) : "";
    const ping = d.ping ? `${d.ping} ms` : "—";
    const updated = fmtRel(d.last_info_update, el);

    const html = `
    <div role="group" aria-label="${esc(d.servername || "Server Card")}"
         style="border:1px solid ${P.line};border-radius:12px;padding:16px;font:14px/1.5 system-ui,Segoe UI,Roboto;background:${P.card};color:${P.text};max-width:600px">
      <div style="display:flex;gap:12px;align-items:center;">
        <img src="${iconSrc(d, P, 48)}" loading="lazy" width="48" height="48" alt="Server icon"
             style="border-radius:8px;object-fit:cover;background:#f3f4f6">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.servername || "Сервер")}</div>
          <div style="color:${P.sub}">${esc(d.ip)}:${esc(d.port)}</div>
        </div>
        <span role="status" aria-live="polite"
              style="display:inline-flex;gap:.5em;padding:.2em .5em;border-radius:999px;background:${online ? P.goodBg : P.badBg};color:${online ? P.good : P.bad};font-weight:600">
              ${online ? esc(tr("online", el)) : esc(tr("offline", el))}</span>
      </div>

      ${d.raw_name ? `<div style="margin-top:10px">${mcToHtml(d.raw_name)}</div>` : d.short_description ? `<div style="margin-top:10px">${esc(d.short_description)}</div>` : ""}
      ${motd ? `<div style="margin-top:8px;color:${P.sub};font-size:13px">${motd}</div>` : ""}

      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px">
        <div style="padding:10px;border:1px solid ${P.line};border-radius:10px">
          <div style="color:${P.sub}">${esc(tr("players", el))}</div>
          <div style="font-weight:700">${players}</div>
        </div>
        <div style="padding:10px;border:1px solid ${P.line};border-radius:10px">
          <div style="color:${P.sub}">${esc(tr("version", el))}</div>
          <div style="font-weight:700">${versionText ? esc(versionText) : "—"}</div>
        </div>
        <div style="padding:10px;border:1px solid ${P.line};border-radius:10px">
          <div style="color:${P.sub}">${esc(tr("ping", el))}</div>
          <div style="font-weight:700">${ping}</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;color:${P.sub};font-size:12px">
        <div>${esc(tr("rating", el))}: <b style="color:${P.text}">${d.votes ?? "—"}</b></div>
        <div>${esc(tr("updated", el))}: <b style="color:${P.text}" title="${new Date((d.last_info_update || 0) * 1000).toLocaleString()}">${updated}</b></div>
        <div>${esc(tr("location", el))}: <b style="color:${P.text}"><img alt="Country" width="16" height="12" style="vertical-align:-2px"
             src="https://minecraftservers.ru/images/flags/svg/${esc((d.location_code || "ru").toUpperCase())}.svg"></b></div>
      </div>
    </div>`;
    el.innerHTML = wrapIfLink(el, html, d);
  }

  async function renderBanner(el, d) {
    const P = palette(wantsDark(el));
    const online = d.status == 1 || d.status === "1";
    const vRange = d.version_from ? `${d.version_from}–${d.version}` : d.version || "";
    const vFancy = d.version_name ? mcToHtml(d.version_name) : esc(vRange);

    const html = `
    <div role="group" aria-label="${esc(d.servername || "Server Banner")}"
         style="display:flex;gap:16px;align-items:center;border:1px solid ${P.line};border-radius:14px;padding:14px 16px;background:${P.card};color:${P.text}">
      <img src="${iconSrc(d, P, 56)}" loading="lazy" width="56" height="56" alt="Server icon"
           style="border-radius:12px;object-fit:cover;background:#f3f4f6">
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="font-weight:800;font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.servername || "Сервер")}</div>
          <span role="status" aria-live="polite"
                style="padding:.15em .5em;border-radius:999px;background:${online ? P.goodBg : P.badBg};color:${online ? P.good : P.bad};font-weight:700">
                ${online ? esc(tr("online", el)) : esc(tr("offline", el))}</span>
        </div>
        <div>${esc(d.ip)}:${esc(d.port)}</div>
        <div style="color:${P.sub};font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vFancy}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:800;font-size:20px">${d.players ?? 0}<span style="color:${P.sub}"> / ${d.maxplayers ?? 0}</span></div>
        <div style="color:${P.sub};font-size:12px">${esc(vRange)}</div>
      </div>
    </div>`;
    el.innerHTML = wrapIfLink(el, html, d);
  }

  async function renderRow(el, d) {
    const P = palette(wantsDark(el));
    const online = d.status == 1 || d.status === "1";
    const vRange = d.version_from ? `${d.version_from}–${d.version}` : d.version || "";

    const html = `
    <div role="row" style="display:grid;grid-template-columns:28px 1fr 110px 120px 140px;gap:10px;align-items:center;padding:8px 0;color:${P.text}">
      <img src="${iconSrc(d, P, 28)}" loading="lazy" width="28" height="28" alt="Server icon"
           style="border-radius:6px;object-fit:cover;background:#f3f4f6">
      <div role="gridcell" style="min-width:0">
        <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.servername || "Сервер")}</div>
        <div style="color:${P.sub};font-size:12px">${esc(d.ip)}:${esc(d.port)}</div>
      </div>
      <div role="gridcell">${online ? `<b style="color:${palette("light").good}">${esc(tr("online", el))}</b>` : `<b style="color:${palette("light").bad}">${esc(tr("offline", el))}</b>`}</div>
      <div role="gridcell">${d.players ?? 0} / ${d.maxplayers ?? 0}</div>
      <div role="gridcell">${esc(vRange)}</div>
    </div>`;
    el.innerHTML = wrapIfLink(el, html, d);
  }

  async function renderVote(el, d) {
    const P = palette(wantsDark(el));
    const url = voteUrl(el, d);
    const html = `
    <div role="group" aria-label="Vote"
         style="border:1px solid ${P.line};border-radius:12px;padding:14px;background:${P.card};color:${P.text};max-width:600px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-weight:800">${esc(d.servername || "Сервер")}</div>
          <div style="color:${P.sub};font-size:12px">${esc(tr("rating", el))}: <b style="color:${P.text}">${d.votes ?? "—"}</b></div>
        </div>
        ${url ? `<a href="${esc(url)}" role="button" tabindex="0"
                  style="display:inline-block;padding:.55em 1em;border-radius:10px;background:${P.btn};color:${P.btnText};text-decoration:none;font-weight:700"
                  rel="noopener noreferrer">${esc(tr("vote", el))}</a>` : ""}
      </div>
    </div>`;
    el.innerHTML = html;
  }

  const widgets = {
    ".msrv-badge": renderBadge,
    ".msrv-card": renderCard,
    ".msrv-banner": renderBanner,
    ".msrv-row": renderRow,
    ".msrv-vote": renderVote,
  };

  // =========================
  // Boot: IntersectionObserver + MutationObserver
  // With token state to render late elements immediately
  // =========================
  const groups = new Map(); // token -> [{ el, fn, ttl }]
  let io = null;

  function ensureIO() {
    if (io) return io;
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((ent) => {
          if (!ent.isIntersecting) return;
          const el = ent.target;
          io.unobserve(el);
          const token = el.getAttribute("data-token");
          if (!token) return;
          renderGroupForToken(token);
        });
      },
      { rootMargin: "200px" }
    );
    return io;
  }

  function attachElement(el, sel, fn) {
    el.dataset.msrvBound = "1";
    const token = el.getAttribute("data-token");
    if (!token) return;

    const ttlAttr = Number(el.getAttribute("data-ttl")) || DEFAULT_TTL;
    if (!groups.has(token)) groups.set(token, []);
    groups.get(token).push({ el, fn, ttl: ttlAttr });

    // Draw skeleton immediately
    const P = palette(wantsDark(el));
    setSkeleton(el, P, getSkeletonHeight(el, sel));

    // If token already ready, render immediately (no IO / no fetch)
    const st = tokenState.get(token);
    if (st?.status === "ready" && st.data) {
      try {
        fn(el, st.data);
      } catch (e) {
        const P2 = palette(wantsDark(el));
        showError(el, P2, "failed to render");
        console.error(e);
      }
      return;
    }

    // Otherwise: eager or IO-observed
    const eager = el.hasAttribute("data-eager");
    if (eager) {
      renderGroupForToken(token);
    } else {
      ensureIO().observe(el);
    }
  }

  function boot() {
    Object.entries(widgets).forEach(([sel, fn]) => {
      document.querySelectorAll(`${sel}[data-token]`).forEach((el) => {
        if (el.dataset.msrvBound === "1") return;
        attachElement(el, sel, fn);
      });
    });
  }

  function renderGroupForToken(token) {
    const items = groups.get(token);
    if (!items || !items.length) return;

    const ttl = Math.min(...items.map((x) => x.ttl)) || DEFAULT_TTL;

    // SWR: global or element-level
    const swrFlag =
      items.some(({ el }) => el.hasAttribute("data-swr")) ||
      !!GLOBAL_CONFIG.swr ||
      !!(window.MSRV && MSRV.config && MSRV.config.swr);

    getDataSWR(
      token,
      ttl,
      (data) => {
        (items || []).forEach(({ el, fn }) => {
          try {
            fn(el, data);
          } catch (e) {
            const P = palette(wantsDark(el));
            showError(el, P, "failed to render");
            console.error(e);
          }
        });
        // Do NOT delete token state; just clear the element list for this batch.
        groups.set(token, []);
      },
      { swr: swrFlag }
    ).catch((e) => {
      (items || []).forEach(({ el }) => {
        const P = palette(wantsDark(el));
        showError(el, P, "failed to load");
      });
      console.error(e);
      groups.set(token, []);
    });
  }

  // Re-render on system theme change (from cached data)
  function rerenderAll() {
    const selectors = Object.keys(widgets)
      .map((s) => `${s}[data-token]`)
      .join(",");
    document.querySelectorAll(selectors).forEach((el) => {
      const token = el.getAttribute("data-token");
      if (!token) return;
      const data = tokenState.get(token)?.data || readLocal(token)?.d;
      if (!data) return;
      const entry = Object.entries(widgets).find(([s]) => el.matches(s));
      if (!entry) return;
      const fn = entry[1];
      try {
        fn(el, data);
      } catch {
        /* noop */
      }
    });
  }

  const mo = new MutationObserver(() => queueMicrotask(boot));
  mo.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", rerenderAll);
    else if (mq.addListener) mq.addListener(rerenderAll);
  }

  // =========================
  // Export
  // =========================
  window.MSRV = Object.assign(window.MSRV || {}, {
    fetch: (token) => requestOnce(token), // manual fetch
    mcToHtml,
    esc,
    locale: "ru",
    version: "1.1.2",
    config: GLOBAL_CONFIG, // allow MSRV.config = { swr: true }
  });
})();
