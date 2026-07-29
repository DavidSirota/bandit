// deskpet — a gentle Tamagotchi that lives on your Dock.
// Runs inside Tauri (context comes from Rust) AND standalone in a browser
// (context synthesized from the mouse + keys) so the whole feel is testable.
(() => {
  "use strict";

  const IS_TAURI = !!(window.__TAURI__ && window.__TAURI__.event);
  const invoke = IS_TAURI ? window.__TAURI__.core.invoke : null;

  // ---- canvas ----------------------------------------------------------
  const canvas = document.getElementById("pet");
  const cctx = canvas.getContext("2d");
  const W = 280, H = 340;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = W * dpr; canvas.height = H * dpr;
  cctx.scale(dpr, dpr);
  const CX = 140, GROUND = 300, BW = 86, BH = 98;
  const creatureCenterY = GROUND - BH / 2;

  const $ = (id) => document.getElementById(id);
  const bubbleEl = $("bubble"), menuEl = $("menu"), editEl = $("edit");

  // ---- persisted pet ---------------------------------------------------
  const DEFAULT = {
    name: "deskpet",
    born: Date.now(),
    bodyColor: "#2b2f3d",
    hairColor: "#7bbf6a",
    scale: 1,
    hunger: 20, // 0 full .. 100 starving
    thirst: 20,
    hair: 10, // 0 bald .. 100 lush
    happy: 80,
    lastTick: Date.now(),
    stats: { feeds: 0, waters: 0, pets: 0, lateNights: 0, lastLateNight: 0 },
  };
  let pet = { ...DEFAULT };

  async function loadPet() {
    try {
      let raw = IS_TAURI ? await invoke("load_pet") : localStorage.getItem("deskpet");
      if (raw) pet = { ...DEFAULT, ...JSON.parse(raw), stats: { ...DEFAULT.stats, ...(JSON.parse(raw).stats || {}) } };
    } catch (e) { /* first run */ }
    applyEditInputs();
  }
  let savePending = false;
  function savePet() {
    if (savePending) return;
    savePending = true;
    setTimeout(async () => {
      savePending = false;
      const json = JSON.stringify(pet);
      try {
        if (IS_TAURI) await invoke("save_pet", { json });
        else localStorage.setItem("deskpet", json);
      } catch (e) { /* ignore */ }
    }, 400);
  }

  // ---- live context ----------------------------------------------------
  const ctx = {
    look: { x: 0, y: 0 }, // -1..1 direction to cursor
    hovering: false,
    app: "other",
    appName: "",
    hour: new Date().getHours(),
    claude: "", // idle/thinking/working/celebrate/alert from Claude Code hooks
    sameAppSince: Date.now(),
  };

  if (IS_TAURI) {
    window.__TAURI__.event.listen("ctx", (e) => {
      const p = e.payload || {};
      // cursor relative to creature centre, in window-logical px
      const curX = (p.cursorX - p.winX) / (p.scale || 1);
      const curY = (p.cursorY - p.winY) / (p.scale || 1);
      setLook(curX, curY);
      ctx.hovering = !!p.hovering;
      if (p.app && p.app !== ctx.app) { ctx.app = p.app; ctx.sameAppSince = Date.now(); onContextChange(); }
      ctx.appName = p.appName || "";
      ctx.hour = typeof p.hour === "number" ? p.hour : ctx.hour;
    });
    window.__TAURI__.event.listen("claude", (e) => { ctx.claude = String(e.payload || ""); reactClaude(); });
  } else {
    // browser: cursor + hover from the mouse, contexts from keys (for testing)
    window.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setLook(mx, my);
      // hover zone covers the creature AND the menu row above it, so moving up
      // to a button doesn't dismiss the menu.
      ctx.hovering = Math.abs(mx - CX) < 95 && my > 82 && my < 330;
    });
    window.addEventListener("keydown", (e) => {
      const m = { c: "coding", b: "browsing", t: "terminal", d: "design", w: "writing" };
      if (m[e.key]) { ctx.app = m[e.key]; ctx.sameAppSince = Date.now(); onContextChange(); }
      if (e.key === "n") ctx.hour = ctx.hour < 5 || ctx.hour >= 23 ? 14 : 2; // toggle late night
      if (e.key === "f") action("food");
      if (e.key === "g") action("water");
      if (e.key === "1") { pet.hunger = 85; pet.thirst = 80; }
    });
  }

  function setLook(px, py) {
    const dx = px - CX, dy = py - creatureCenterY;
    const d = Math.hypot(dx, dy) || 1;
    ctx.look.x = Math.max(-1, Math.min(1, dx / Math.max(60, d)));
    ctx.look.y = Math.max(-1, Math.min(1, dy / Math.max(60, d)));
  }

  // ---- mood ------------------------------------------------------------
  function mood() {
    if (transient.until > now()) return transient.mood;
    if (ctx.claude === "working" || ctx.claude === "thinking") return "watching";
    const bad = Math.max(pet.hunger, pet.thirst);
    if (bad > 78) return "sad";
    if (bad > 55) return "meh";
    if (pet.happy > 88 && pet.hair > 40) return "great";
    return "content";
  }
  const transient = { mood: "", until: 0, kind: "" };
  function flash(m, ms, kind) { transient.mood = m; transient.until = now() + ms; transient.kind = kind || ""; }

  // ---- actions ---------------------------------------------------------
  function action(kind) {
    if (kind === "food") { pet.hunger = 0; pet.happy = Math.min(100, pet.happy + 8); pet.stats.feeds++; flash("great", 1500, "eat"); say(pick(LINES.fed)); }
    else if (kind === "water") { pet.thirst = 0; pet.happy = Math.min(100, pet.happy + 6); pet.stats.waters++; flash("great", 1400, "drink"); say(pick(LINES.watered)); }
    else if (kind === "pet") { pet.happy = Math.min(100, pet.happy + 12); pet.stats.pets++; flash("great", 1300, "pet"); say(pick(LINES.pet)); }
    else if (kind === "edit") { openEdit(); return; }
    savePet();
  }

  // ---- talking ---------------------------------------------------------
  const LINES = {
    coding: ["ooh we're building something", "lock in. i'm watching.", "clean commit incoming?", "ship it ✶", "you + me = unstoppable"],
    browsing: ["research... or a rabbit hole?", "just one more tab, huh", "whatcha lookin at", "ok but are we working"],
    terminal: ["command line hours 🖤", "type type type", "what does this flag do again"],
    design: ["make it pretty", "ooh colors", "pixels look good today"],
    writing: ["words words words", "you've got this paragraph", "delete that comma"],
    lateNight: ["it's late... you good?", "the code will be there tomorrow", "one more thing then bed?", "i'm sleepy but i'm here"],
    marathon: ["you've been at this a while", "stretch break? for me?", "hydrate, human", "eyes off the screen for a sec"],
    hungry: ["getting a little peckish...", "*tummy rumble*", "feed me? 🍎"],
    thirsty: ["kinda thirsty down here", "a lil water?"],
    fed: ["nom nom", "yesss thank you", "delicious", "you're the best"],
    watered: ["ahh refreshing", "glug glug", "hydrated & happy"],
    pet: ["hehe", "*happy wiggle*", "more please", "♡"],
    ambient: ["hi", "just vibin", "*blink*", "good to see you"],
  };
  const pick = (a) => a[Math.floor(seed() * a.length)];
  let seedN = 0.5;
  function seed() { seedN = (seedN * 9301 + 49297) % 233280 / 233280; return seedN; } // deterministic-ish, no Math.random dependence issues
  let bubbleUntil = 0;
  function say(text, ms = 3200) {
    if (!text) return;
    bubbleEl.textContent = text;
    bubbleEl.classList.remove("hidden");
    bubbleUntil = now() + ms;
  }
  function onContextChange() { if (seed() < 0.6) say(pick(LINES[ctx.app] || LINES.ambient)); }
  function reactClaude() {
    if (ctx.claude === "celebrate") { flash("celebrate", 1500, "jump"); say(pick(["nailed it!", "yesss", "we did it", "🎉"])); }
    else if (ctx.claude === "alert") { flash("watching", 3000, ""); say(pick(["it needs you", "psst, your turn", "waiting on you"])); }
  }

  let lastAmbient = 0;
  function maybeTalk() {
    const t = now();
    if (t < bubbleUntil) return;
    if (t - lastAmbient < 26000) return;
    lastAmbient = t;
    if (seed() < 0.55) return; // stay quiet often
    const late = ctx.hour < 5 || ctx.hour >= 23;
    const grind = (t - ctx.sameAppSince) > 45 * 60 * 1000;
    let line;
    if (pet.hunger > 70) line = pick(LINES.hungry);
    else if (pet.thirst > 70) line = pick(LINES.thirsty);
    else if (late) line = pick(LINES.lateNight);
    else if (grind && (ctx.app === "coding" || ctx.app === "terminal")) line = pick(LINES.marathon);
    else line = pick(LINES[ctx.app] || LINES.ambient);
    say(line);
  }

  // ---- sim tick --------------------------------------------------------
  function now() { return performance.now(); }
  let wall = Date.now();
  function simTick() {
    const nowMs = Date.now();
    const dtH = Math.min(0.2, (nowMs - pet.lastTick) / 3600000); // hours, clamped
    pet.lastTick = nowMs;
    // gentle hunger/thirst: ~full to starving over ~7h
    pet.hunger = Math.min(100, pet.hunger + dtH * 14);
    pet.thirst = Math.min(100, pet.thirst + dtH * 16);
    const bad = Math.max(pet.hunger, pet.thirst);
    // happiness drifts toward how well-kept it is
    const target = 100 - bad * 0.9;
    pet.happy += (target - pet.happy) * Math.min(1, dtH * 3);
    // hair grows when cared for, gently wilts when neglected. never dies.
    if (bad < 45) pet.hair = Math.min(100, pet.hair + dtH * 6);
    else if (bad > 70) pet.hair = Math.max(0, pet.hair - dtH * 4);
    // late-night tally (once per night)
    const late = ctx.hour < 5;
    if (late && nowMs - (pet.stats.lastLateNight || 0) > 6 * 3600000) {
      pet.stats.lateNights++; pet.stats.lastLateNight = nowMs;
    }
    savePet();
  }
  setInterval(simTick, 5000);

  // ---- menu + edit -----------------------------------------------------
  menuEl.querySelectorAll(".mbtn").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); action(b.dataset.act); })
  );
  function openEdit() { menuEl.classList.add("hidden"); editEl.classList.remove("hidden"); editMode = true; }
  function closeEdit() { editEl.classList.add("hidden"); editMode = false; }
  let editMode = false;
  function applyEditInputs() { $("bodyc").value = pet.bodyColor; $("hairc").value = pet.hairColor; }
  $("bodyc").addEventListener("input", (e) => { pet.bodyColor = e.target.value; savePet(); });
  $("hairc").addEventListener("input", (e) => { pet.hairColor = e.target.value; savePet(); });
  $("sizeUp").addEventListener("click", () => { pet.scale = Math.min(1.5, pet.scale + 0.1); savePet(); });
  $("sizeDown").addEventListener("click", () => { pet.scale = Math.max(0.7, pet.scale - 0.1); savePet(); });
  $("editDone").addEventListener("click", closeEdit);

  function syncUI() {
    const showMenu = ctx.hovering && !editMode;
    menuEl.classList.toggle("hidden", !showMenu);
    if (!ctx.hovering && editMode) closeEdit();
    if (now() > bubbleUntil) bubbleEl.classList.add("hidden");
  }

  // ---- drawing ---------------------------------------------------------
  function rr(x, y, w, h, r) {
    cctx.beginPath();
    cctx.moveTo(x + r, y);
    cctx.arcTo(x + w, y, x + w, y + h, r);
    cctx.arcTo(x + w, y + h, x, y + h, r);
    cctx.arcTo(x, y + h, x, y, r);
    cctx.arcTo(x, y, x + w, y, r);
    cctx.closePath();
  }

  function drawHair(topY, m) {
    const n = 9;
    const lvl = pet.hair / 100;
    if (lvl < 0.02) return;
    const droop = m === "sad" ? 1 : m === "meh" ? 0.5 : 0;
    cctx.strokeStyle = pet.hairColor;
    cctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const f = (i / (n - 1)) * 2 - 1; // -1..1
      const x = f * 26; // local to the creature origin (already translated)
      const len = (10 + lvl * 30) * (1 - Math.abs(f) * 0.25);
      const sway = Math.sin(now() / 700 + i) * (2 + lvl * 3) * (1 - droop * 0.5);
      const tipX = x + sway + droop * f * 10;
      const tipY = topY - len + droop * len * 0.9;
      cctx.lineWidth = 2 + lvl * 1.5;
      cctx.beginPath();
      cctx.moveTo(x, topY + 2);
      cctx.quadraticCurveTo(x + sway * 0.5, topY - len * 0.5, tipX, tipY);
      cctx.stroke();
    }
  }

  function eye(x, y, open, look) {
    cctx.fillStyle = "#f4efe6";
    const w = 13, h = 16 * open;
    rr(x - w / 2, y - h / 2, w, h, Math.min(6, h / 2));
    cctx.fill();
    if (open > 0.35) {
      cctx.fillStyle = "#1b1e27";
      cctx.beginPath();
      cctx.arc(x + look.x * 3.2, y + look.y * 3.6, 3.2, 0, 7);
      cctx.fill();
      cctx.fillStyle = "rgba(255,255,255,.9)";
      cctx.beginPath();
      cctx.arc(x + look.x * 3.2 - 1, y + look.y * 3.6 - 1.3, 1, 0, 7);
      cctx.fill();
    }
  }
  function arcEye(x, y, up) {
    cctx.strokeStyle = "#f4efe6"; cctx.lineWidth = 3; cctx.lineCap = "round";
    cctx.beginPath();
    if (up) { cctx.moveTo(x - 6, y + 1); cctx.lineTo(x, y - 4); cctx.lineTo(x + 6, y + 1); }
    else cctx.arc(x, y - 2, 6, 0.15 * Math.PI, 0.85 * Math.PI);
    cctx.stroke();
  }

  let blinkAt = 2000;
  function draw() {
    cctx.clearRect(0, 0, W, H);
    const t = now();
    const m = mood();
    const s = pet.scale;

    let bob = Math.sin(t / 560) * 2.4, lift = 0, squash = 0;
    let openL = 1, openR = 1, style = "normal";
    if (m === "watching") { bob = Math.sin(t / 900) * 1.4; }
    if (m === "great") { bob = Math.sin(t / 380) * 3; style = "happy"; }
    if (m === "sad") { bob = Math.sin(t / 900) * 1.2; lift = -4; }
    if (m === "meh") { bob = Math.sin(t / 800) * 1.6; }
    if (m === "celebrate") {
      const p = Math.min(1, (t - (transient.until - 1500)) / 1500);
      lift = Math.abs(Math.sin(p * Math.PI * 2)) * 40 * (1 - p * 0.3);
      style = "happy";
    }
    if (transient.kind === "eat" || transient.kind === "drink" || transient.kind === "pet") style = "happy";

    if (style === "normal") {
      if (t > blinkAt) { const bt = t - blinkAt; if (bt < 130) openL = openR = 1 - Math.sin((bt / 130) * Math.PI); else blinkAt = t + 1800 + seed() * 3600; }
    }

    const cx = CX, cy = creatureCenterY - bob - lift;

    // shadow
    cctx.save();
    cctx.fillStyle = "rgba(0,0,0,.30)";
    const sh = 1 - Math.min(0.55, lift / 70);
    cctx.beginPath(); cctx.ellipse(cx, GROUND + 6, 38 * s * sh, 8 * s * sh, 0, 0, 7); cctx.fill();
    cctx.restore();

    cctx.save();
    cctx.translate(cx, cy);
    cctx.scale(s, s);
    const w = BW * (1 - squash), h = BH * (1 + squash);

    // hair (behind/above body top)
    drawHair(-h / 2, m);

    // body
    const g = cctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(pet.bodyColor, 12));
    g.addColorStop(0.5, pet.bodyColor);
    g.addColorStop(1, shade(pet.bodyColor, -14));
    cctx.fillStyle = g;
    rr(-w / 2, -h / 2, w, h, 28); cctx.fill();

    cctx.save(); cctx.globalAlpha = 0.1; cctx.fillStyle = "#fff"; rr(-w / 2 + 9, -h / 2 + 8, w - 18, 16, 10); cctx.fill(); cctx.restore();

    // feet
    cctx.fillStyle = shade(pet.bodyColor, -22);
    const shuffle = m === "watching" ? Math.sin(t / 90) * 2.5 : 0;
    rr(-20, h / 2 - 6 + shuffle, 15, 9, 5); cctx.fill();
    rr(6, h / 2 - 6 - shuffle, 15, 9, 5); cctx.fill();

    // eyes
    const ex = 17, ey = -7;
    if (style === "happy") { arcEye(-ex, ey, true); arcEye(ex, ey, true); }
    else if (m === "sad") { arcEye(-ex, ey + 2, false); arcEye(ex, ey + 2, false); }
    else { eye(-ex, ey, openL, ctx.look); eye(ex, ey, openR, ctx.look); }

    // mouth
    cctx.strokeStyle = "rgba(244,239,230,.6)"; cctx.lineWidth = 2; cctx.lineCap = "round"; cctx.beginPath();
    if (style === "happy") cctx.arc(0, 9, 7, 0.1 * Math.PI, 0.9 * Math.PI);
    else if (m === "sad") cctx.arc(0, 16, 6, 1.15 * Math.PI, 1.85 * Math.PI);
    else if (m === "meh") { cctx.moveTo(-5, 11); cctx.lineTo(5, 11); }
    else cctx.arc(0, 10, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    cctx.stroke();

    // cheeks when happy
    if (style === "happy") {
      cctx.fillStyle = "rgba(240,150,120,.35)";
      cctx.beginPath(); cctx.arc(-26, 4, 5, 0, 7); cctx.arc(26, 4, 5, 0, 7); cctx.fill();
    }
    cctx.restore();

    // eat/drink motes
    if (transient.kind === "eat" && t < transient.until) motes(cx, cy, "#e6a24a");
    if (transient.kind === "drink" && t < transient.until) motes(cx, cy, "#6db6e6");
    if (transient.kind === "pet" && t < transient.until) hearts(cx, cy - 40);

    syncUI();
    requestAnimationFrame(draw);
  }

  function motes(x, y, c) {
    cctx.fillStyle = c;
    for (let i = 0; i < 3; i++) {
      const a = now() / 300 + i * 2;
      cctx.globalAlpha = 0.6;
      cctx.beginPath(); cctx.arc(x + Math.cos(a) * 20, y + 6 + Math.sin(a) * 6, 2.4, 0, 7); cctx.fill();
    }
    cctx.globalAlpha = 1;
  }
  function hearts(x, y) {
    const p = (now() / 900) % 1;
    cctx.save(); cctx.globalAlpha = 1 - p; cctx.fillStyle = "#ef8f8f";
    cctx.translate(x, y - p * 24); cctx.scale(0.5, 0.5);
    cctx.beginPath(); cctx.moveTo(0, 4); cctx.bezierCurveTo(-6, -4, -12, 4, 0, 12); cctx.bezierCurveTo(12, 4, 6, -4, 0, 4); cctx.fill();
    cctx.restore();
  }

  // lighten/darken a hex color
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  setInterval(maybeTalk, 3000);
  setInterval(() => { ctx.hour = new Date().getHours(); }, 60000);
  loadPet().then(() => requestAnimationFrame(draw));
})();
