// deskpet — a gentle raccoon Tamagotchi that lives on your Dock.
// Original character (not based on anyone's IP). Reacts to real local signals:
// which app you're in, CPU load, battery, time of day, and coding agent.
// Runs in Tauri (context from Rust) and standalone in a browser (mouse + keys).
(() => {
  "use strict";
  const IS_TAURI = !!(window.__TAURI__ && window.__TAURI__.event);
  const invoke = IS_TAURI ? window.__TAURI__.core.invoke : null;

  const canvas = document.getElementById("pet");
  const g = canvas.getContext("2d");
  const W = 280, H = 340;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = W * dpr; canvas.height = H * dpr; g.scale(dpr, dpr);
  const CX = 140, GROUND = 300, BW = 84, BH = 92;
  const centerY = GROUND - BH / 2;
  const $ = (id) => document.getElementById(id);
  const bubbleEl = $("bubble"), menuEl = $("menu"), editEl = $("edit");
  const permEl = $("perm"), permToolEl = $("permTool"), permDetailEl = $("permDetail");
  const nowp = () => performance.now();

  // ---- persisted pet ---------------------------------------------------
  const DEFAULT = {
    name: "Bandit", born: Date.now(),
    bodyColor: "#2a2d38", hairColor: "#7bbf6a", scale: 1, theme: "os", chatter: true, coatAuto: true, dnd: false, roamMode: "dock",
    hunger: 20, thirst: 20, hair: 12, happy: 82,
    lastTick: Date.now(),
    stats: { feeds: 0, waters: 0, pets: 0, lateNights: 0, lastLateNight: 0 },
  };
  let pet = { ...DEFAULT };
  async function loadPet() {
    try {
      const raw = IS_TAURI ? await invoke("load_pet") : localStorage.getItem("deskpet");
      if (raw) { const o = JSON.parse(raw); pet = { ...DEFAULT, ...o, stats: { ...DEFAULT.stats, ...(o.stats || {}) } }; }
    } catch (e) {}
    // away-decay: come back to a slightly needy critter (capped, never dire)
    const awayH = Math.max(0, (Date.now() - pet.lastTick) / 3600000);
    pet.hunger = Math.min(92, pet.hunger + awayH * 5);
    pet.thirst = Math.min(92, pet.thirst + awayH * 6);
    pet.happy = Math.max(15, pet.happy - awayH * 3);
    pet.lastTick = Date.now();
    $("bodyc").value = coatColor(); $("hairc").value = pet.hairColor;
    applyTheme(); updateChatter(); updateDnd(); updateRoamSeg();
  }
  function applyTheme() {
    if (pet.theme && pet.theme !== "os") document.body.dataset.theme = pet.theme;
    else delete document.body.dataset.theme;
    document.querySelectorAll("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === (pet.theme || "os")));
  }
  let saveT = 0;
  function savePet() {
    if (saveT) return;
    saveT = setTimeout(async () => {
      saveT = 0;
      const json = JSON.stringify(pet);
      try { if (IS_TAURI) await invoke("save_pet", { json }); else localStorage.setItem("deskpet", json); } catch (e) {}
    }, 500);
  }

  // ---- live context ----------------------------------------------------
  const ctx = {
    look: { x: 0, y: 0 }, hovering: false,
    app: "other", appName: "", hour: new Date().getHours(),
    cpu: 0, batt: 100, charging: true, task: "", roam: "",
    sameAppSince: Date.now(), vel: { x: 0 },
  };
  let prevWin = null, prevWt = 0;

  if (IS_TAURI) {
    window.__TAURI__.event.listen("ctx", (e) => {
      const p = e.payload || {};
      setLook((p.cursorX - p.winX) / (p.scale || 1), (p.cursorY - p.winY) / (p.scale || 1));
      ctx.hovering = !!p.hovering;
      if (p.app && p.app !== ctx.app) { ctx.app = p.app; ctx.sameAppSince = Date.now(); onAppChange(); }
      ctx.appName = p.appName || "";
      if (typeof p.cpu === "number") ctx.cpu = p.cpu;
      if (typeof p.batt === "number") ctx.batt = p.batt;
      if (typeof p.charging === "boolean") ctx.charging = p.charging;
      ctx.roam = p.roam || "";
      // drag velocity from the window moving
      const tn = nowp();
      if (prevWin) { const dt = Math.max(16, tn - prevWt); ctx.vel.x = ctx.vel.x * 0.5 + ((p.winX - prevWin) / dt) * 0.5; }
      prevWin = p.winX; prevWt = tn;
    });
    window.__TAURI__.event.listen("task", (e) => { ctx.task = String(e.payload || ""); reactTask(); });
    window.__TAURI__.event.listen("permission", (e) => showPerm(e.payload));
  } else {
    window.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setLook(mx, my);
      ctx.hovering = Math.abs(mx - CX) < 95 && my > 82 && my < 330;
    });
    window.addEventListener("keydown", (e) => {
      const m = { c: "coding", b: "browsing", t: "terminal", d: "design", w: "writing" };
      if (m[e.key]) { ctx.app = m[e.key]; ctx.sameAppSince = Date.now(); onAppChange(); }
      if (e.key === "n") ctx.hour = ctx.hour < 5 ? 14 : 2;
      if (e.key === "p") ctx.cpu = ctx.cpu > 0.5 ? 0.1 : 0.95;
      if (e.key === "l") { ctx.batt = 8; ctx.charging = false; }
      if (e.key === "k") { ctx.charging = true; ctx.batt = 60; }
      if (e.key === "f") action("food");
      if (e.key === "1") { pet.hunger = 85; pet.thirst = 82; pet.happy = 30; }
      if (e.key === "y") idle.fire("yawn");
      if (e.key === "o") toggleFocus();
      if (e.key === "r") ctx.roam = ({ "": "climb-l", "climb-l": "climb-r", "climb-r": "nap", "nap": "" })[ctx.roam] ?? "";
      if (e.key === "g") showPerm(permActive ? "" : JSON.stringify({ id: "test", tool: "Bash", detail: "rm -rf build/ && npm run deploy" }));
    });
  }
  function setLook(px, py) {
    const dx = px - CX, dy = py - centerY, d = Math.hypot(dx, dy) || 1;
    ctx.look.x = Math.max(-1, Math.min(1, dx / Math.max(60, d)));
    ctx.look.y = Math.max(-1, Math.min(1, dy / Math.max(60, d)));
  }

  // ---- mood (priority order) -------------------------------------------
  const transient = { m: "", until: 0, kind: "" };
  function flash(m, ms, kind) { transient.m = m; transient.until = nowp() + ms; transient.kind = kind || ""; }
  function isLate() { return ctx.hour < 5 || ctx.hour >= 23; }
  function mood() {
    if (pet.dnd) return "nap";
    if (transient.until > nowp()) return transient.m;
    if (ctx.batt <= 10 && !ctx.charging) return "dying";
    if (ctx.cpu > 0.85) return "frazzled";
    if (ctx.batt <= 25 && !ctx.charging) return "hangry";
    if (ctx.charging && ctx.batt < 95) return "charging";
    if (ctx.roam === "nap") return "nap";
    if (isLate()) return "nocturnal";
    if (ctx.task === "groove") return "groove";
    if (ctx.task === "working" || ctx.task === "thinking") return "watching";
    const bad = Math.max(pet.hunger, pet.thirst);
    if (bad > 78 || pet.happy < 25) return "sad";
    if (bad > 55) return "meh";
    if (idle.m) return idle.m; // ambient idle beat
    if (pet.happy > 86 && pet.hair > 40) return "great";
    return "content";
  }

  // ---- idle personality beats ------------------------------------------
  const idle = {
    m: "", until: 0, next: nowp() + 6000,
    fire(kind) { this.m = kind; this.until = nowp() + (kind === "yawn" ? 1800 : kind === "groom" ? 2200 : kind === "sniff" ? 900 : 1500); },
    tick() {
      const t = nowp();
      if (this.m && t > this.until) this.m = "";
      if (t > this.next && !this.m) {
        this.next = t + (isLate() ? 6000 : 12000) + seed() * 9000;
        const calm = ["content", "great", "nocturnal"].includes(mood());
        if (calm && !ctx.hovering) {
          const beats = isLate() ? ["look", "scratch", "tap", "groom", "look", "sniff"] : ["yawn", "look", "scratch", "tap", "groom", "sniff"];
          this.fire(pick(beats));
        }
      }
    },
  };

  // ---- talking ---------------------------------------------------------
  const L = {
    coding: ["lock in. i'm watching.", "ooh we're building something", "clean commit incoming?", "ship it ✶", "you + me = unstoppable", "is that a bug or a feature 👀", "semicolon check"],
    browsing: ["research... or rabbit hole?", "whatcha lookin at 👀", "one more tab huh", "ooh shiny", "close some tabs, i can feel them", "this counts as work, right?"],
    terminal: ["command line hours 🖤", "type type type", "sudo make me a sandwich", "what does this flag do again", "rm -rf carefully please"],
    design: ["make it pretty", "ooh colors", "pixels lookin good today", "nudge it 1px left. trust me"],
    writing: ["words words words", "you got this paragraph", "delete that comma", "the muse is real"],
    nocturnal: ["NOW i'm awake 🦝", "night shift buddies 🌙", "these are the good hours", "i thrive after dark", "shhh we're being sneaky", "trash panda hours"],
    marathon: ["you've been at this a while", "stretch break? for me?", "hydrate, human 💧", "look away from the screen a sec", "blink. i'll wait."],
    frazzled: ["fans go BRRR", "it's getting toasty 🥵", "cpu's melting", "everything is fine (it's not)", "close a tab, i'm begging"],
    hangry: ["battery low & so am i", "getting sleepy...", "feed me electrons", "runnin on fumes", "power nap incoming"],
    dying: ["plug me in... please", "i don't feel so good", "power... fading", "🔋💀 save me", "tell my story"],
    charging: ["ahh sweet juice ⚡", "nom nom electrons", "power UP", "feelin recharged", "100% soon, 100% vibes"],
    hungry: ["getting peckish", "*tummy rumble*", "snack? 🍎", "i'd do anything for a grape"],
    thirsty: ["kinda thirsty", "water pls 💧", "parched over here"],
    fed: ["nom nom", "yesss thank you", "delicious", "10/10 would eat again", "you're the best"],
    watered: ["ahh refreshing", "glug glug", "hydrated & happy", "*content sploosh*"],
    pet: ["hehe", "*happy chitter*", "more please", "♡", "*melts*"],
    morning: ["morning ☀️", "coffee time?", "new day, let's get it", "you're up early"],
    afternoon: ["afternoon slump? me too", "how's it going up there", "snack o'clock"],
    evening: ["evening 🌆", "winding down?", "golden hour hits different"],
    codeLate: ["grinding past midnight, respect 🦝", "2am code hits different", "we ride at night", "the bugs come out at night"],
    browseLate: ["late night scroll, classic", "can't sleep either huh", "the algorithm has you"],
    restless: ["make up your mind 😅", "so many apps", "focus? never heard of her", "whoa slow down"],
    ambient: ["*chitters*", "just vibin", "*washes little hands*", "hi", "*sniff sniff*", "still here 🦝", "psst"],
  };
  const pick = (a) => a[Math.floor(seed() * a.length)];
  let sN = 0.37;
  function seed() { sN = ((sN * 9301 + 49297) % 233280) / 233280; return sN; }
  let bubbleUntil = 0;
  function say(text, ms = 3200) { if (!text || pet.chatter === false || pet.dnd) return; bubbleEl.textContent = text; bubbleEl.classList.remove("hidden"); bubbleUntil = nowp() + ms; }
  let appSwitches = [];
  function onAppChange() {
    const t = nowp();
    appSwitches.push(t);
    appSwitches = appSwitches.filter((x) => t - x < 16000);
    if (seed() < 0.55) say(pick(L[ctx.app] || L.ambient));
  }
  function reactTask() {
    if (pet.dnd) return;
    if (ctx.task === "celebrate") { flash("great", 1500, "jump"); say(pick(["nailed it!", "yesss", "we did it", "🎉"])); }
    else if (ctx.task === "alert") { flash("watching", 3000, ""); say(pick(["it needs you", "psst, your turn"])); }
    else if (ctx.task === "reviewing") { say(pick(["hmm, checking this...", "reviewing 👀", "one sec"])); }
  }
  const daysAlive = () => Math.floor((Date.now() - pet.born) / 86400000);
  function hourBucket() { const h = ctx.hour; if (h >= 5 && h < 12) return 0; if (h < 18) return 1; if (h < 23) return 2; return 3; }
  function brag() {
    const d = daysAlive(), o = [];
    if (d >= 1) o.push(`day ${d} together 🦝`);
    if (pet.stats.feeds > 0) o.push(`you've fed me ${pet.stats.feeds}x`);
    if (pet.stats.pets > 0) o.push(`${pet.stats.pets} pets and counting ♡`);
    if (pet.stats.lateNights > 1) o.push(`${pet.stats.lateNights} late nights, we wild`);
    if (pet.hair > 60) o.push("my hair's lookin great btw");
    return o.length ? pick(o) : pick(L.ambient);
  }
  let lastAmbient = 0, lastFling = 0, greetedBucket = -1;
  function maybeTalk() {
    const t = nowp();
    if (t < bubbleUntil || t - lastAmbient < 22000) return;
    lastAmbient = t;
    const late = isLate();
    const grind = (t - ctx.sameAppSince) > 45 * 60 * 1000;
    const restless = appSwitches.length >= 3;
    let line = null;
    if (ctx.batt <= 10 && !ctx.charging) line = pick(L.dying);
    else if (ctx.charging && ctx.batt < 95) line = pick(L.charging);
    else if (ctx.cpu > 0.85) line = pick(L.frazzled);
    else if (ctx.batt <= 25 && !ctx.charging) line = pick(L.hangry);
    else {
      const b = hourBucket();
      if (b !== greetedBucket) { greetedBucket = b; line = pick([L.morning, L.afternoon, L.evening, L.nocturnal][b]); }
      else if (seed() < 0.5) return; // often stay quiet
      else if (restless) line = pick(L.restless);
      else if (pet.hunger > 70) line = pick(L.hungry);
      else if (pet.thirst > 70) line = pick(L.thirsty);
      else if (late && (ctx.app === "coding" || ctx.app === "terminal")) line = pick(L.codeLate);
      else if (late && ctx.app === "browsing") line = pick(L.browseLate);
      else if (late) line = pick(L.nocturnal);
      else if (grind && (ctx.app === "coding" || ctx.app === "terminal")) line = pick(L.marathon);
      else if (seed() < 0.28) line = brag();
      else line = pick(L[ctx.app] || L.ambient);
    }
    say(line);
  }

  // ---- actions ---------------------------------------------------------
  function action(kind) {
    if (kind === "food") { pet.hunger = 0; pet.happy = Math.min(100, pet.happy + 8); pet.stats.feeds++; flash("great", 1500, "eat"); say(pick(L.fed)); }
    else if (kind === "water") { pet.thirst = 0; pet.happy = Math.min(100, pet.happy + 6); pet.stats.waters++; flash("great", 1400, "drink"); say(pick(L.watered)); }
    else if (kind === "pet") { pet.happy = Math.min(100, pet.happy + 12); pet.stats.pets++; flash("great", 1300, "pet"); say(pick(L.pet)); }
    else if (kind === "edit") { menuEl.classList.add("hidden"); editEl.classList.remove("hidden"); editMode = true; return; }
    else if (kind === "focus") { toggleFocus(); return; }
    savePet();
  }

  // ---- pomodoro / focus buddy ------------------------------------------
  const focus = { on: false, phase: "work", endsAt: 0, work: 25 * 60000, brk: 5 * 60000 };
  function toggleFocus() {
    focus.on = !focus.on;
    if (focus.on) { focus.phase = "work"; focus.endsAt = Date.now() + focus.work; say("focus on. 25 min — i've got you 🦝"); }
    else say("focus off. nice work 👏");
  }
  setInterval(() => {
    if (!focus.on) return;
    if (Date.now() >= focus.endsAt) {
      if (focus.phase === "work") { focus.phase = "break"; focus.endsAt = Date.now() + focus.brk; flash("great", 2200, "jump"); say("BREAK! 5 min — look away & stretch 🦝", 6000); }
      else { focus.phase = "work"; focus.endsAt = Date.now() + focus.work; say("back to it. lock in 💪"); }
    }
  }, 1000);

  let editMode = false;
  menuEl.querySelectorAll(".mbtn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); action(b.dataset.act); }));
  // click reactions on his body: double-click = poke, rapid clicks = flail
  let clickTimes = [];
  canvas.addEventListener("click", () => {
    if (pet.dnd) return;
    const t = nowp(); clickTimes.push(t); clickTimes = clickTimes.filter((x) => t - x < 900);
    if (clickTimes.length >= 4) { clickTimes = []; flash("flail", 1200, "flail"); say(pick(["AAAH", "hey hey HEY", "too much!!"]), 1100); }
    else if (clickTimes.length === 2) { flash("poke", 750, "poke"); pet.happy = Math.min(100, pet.happy + 3); say(pick(["boop!", "hey!", "eek", "!"]), 900); }
  });
  // coat follows the theme (light coat in light mode, dark in dark) until you pick a custom color
  const LIGHT_COAT = "#8b90a0", DARK_COAT = "#2a2d38";
  function resolvedTheme() {
    if (pet.theme === "light") return "light";
    if (pet.theme === "dark") return "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function coatColor() { return pet.coatAuto === false ? pet.bodyColor : (resolvedTheme() === "light" ? LIGHT_COAT : DARK_COAT); }
  $("bodyc").addEventListener("input", (e) => { pet.coatAuto = false; pet.bodyColor = e.target.value; savePet(); });
  $("hairc").addEventListener("input", (e) => { pet.hairColor = e.target.value; savePet(); });
  $("sizeUp").addEventListener("click", () => { pet.scale = Math.min(1.5, pet.scale + 0.1); savePet(); });
  $("sizeDown").addEventListener("click", () => { pet.scale = Math.max(0.7, pet.scale - 0.1); savePet(); });
  $("editDone").addEventListener("click", () => { editEl.classList.add("hidden"); editMode = false; });
  document.querySelectorAll("#themeSeg button").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); pet.theme = b.dataset.theme; applyTheme(); savePet(); })
  );
  function updateChatter() { const btn = $("chatterBtn"); if (!btn) return; btn.textContent = pet.chatter === false ? "off" : "on"; btn.classList.toggle("on", pet.chatter !== false); }
  $("chatterBtn").addEventListener("click", (e) => { e.stopPropagation(); pet.chatter = pet.chatter === false; updateChatter(); savePet(); if (pet.chatter === false) bubbleEl.classList.add("hidden"); });
  function updateDnd() { const btn = $("dndBtn"); if (!btn) return; btn.textContent = pet.dnd ? "on" : "off"; btn.classList.toggle("on", !!pet.dnd); }
  $("dndBtn").addEventListener("click", (e) => { e.stopPropagation(); pet.dnd = !pet.dnd; updateDnd(); savePet(); if (pet.dnd) bubbleEl.classList.add("hidden"); });
  function updateRoamSeg() { document.querySelectorAll("#roamSeg button").forEach((b) => b.classList.toggle("on", b.dataset.roam === (pet.roamMode || "dock"))); }
  document.querySelectorAll("#roamSeg button").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); pet.roamMode = b.dataset.roam; updateRoamSeg(); savePet(); }));

  // ---- permission bubble: Claude Code asks, you answer from Bandit ---------
  let permActive = false, permId = null;
  function showPerm(raw) {
    let req = null;
    try { req = raw ? JSON.parse(raw) : null; } catch (_) { req = null; }
    if (!req || !req.tool) { hidePerm(); return; }
    permId = req.id || "";
    permToolEl.textContent = req.tool;
    permDetailEl.textContent = req.detail || "";
    permEl.classList.remove("hidden");
    permActive = true;
    menuEl.classList.add("hidden");
    editEl.classList.add("hidden"); editMode = false;
    flash("watching", 60000, "");   // attentive while he waits on you
    say(pick(["your call?", "run this?", "want me to allow it?"]), 4000);
  }
  function hidePerm() {
    permActive = false; permId = null;
    permEl.classList.add("hidden");
    if (transient.m === "watching") transient.until = 0;   // release the attentive hold
  }
  function answerPerm(decision) {
    if (permId != null && invoke) invoke("resolve_permission", { id: String(permId), decision });
    if (decision === "allow") { flash("great", 1400, "jump"); say(pick(["on it", "go go go"])); }
    else { flash("meh", 1200, ""); say(pick(["skipped it", "nope, blocked"])); }
    hidePerm();
  }
  $("permAllow").addEventListener("click", (e) => { e.stopPropagation(); answerPerm("allow"); });
  $("permDeny").addEventListener("click", (e) => { e.stopPropagation(); answerPerm("deny"); });
  function syncUI() {
    menuEl.classList.toggle("hidden", !(ctx.hovering && !editMode && !permActive));
    if (!ctx.hovering && editMode) { editEl.classList.add("hidden"); editMode = false; }
    if (nowp() > bubbleUntil) bubbleEl.classList.add("hidden");
  }

  // ---- sim -------------------------------------------------------------
  function simTick() {
    const nm = Date.now();
    const dtH = (nm - pet.lastTick) / 3600000;
    pet.lastTick = nm;
    pet.hunger = Math.min(92, pet.hunger + dtH * 14);
    pet.thirst = Math.min(92, pet.thirst + dtH * 16);
    const bad = Math.max(pet.hunger, pet.thirst);
    pet.happy += ((100 - bad * 0.9) - pet.happy) * Math.min(1, dtH * 3);
    pet.happy = Math.max(15, Math.min(100, pet.happy));
    if (bad < 45) pet.hair = Math.min(100, pet.hair + dtH * 6);
    else if (bad > 70) pet.hair = Math.max(0, pet.hair - dtH * 4);
    if (ctx.hour < 5 && nm - (pet.stats.lastLateNight || 0) > 6 * 3600000) { pet.stats.lateNights++; pet.stats.lastLateNight = nm; }
    savePet();
  }
  setInterval(simTick, 5000);
  setInterval(maybeTalk, 3000);
  setInterval(() => { ctx.hour = new Date().getHours(); }, 60000);

  // ---- drawing helpers -------------------------------------------------
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); let r = Math.max(0, Math.min(255, (n >> 16) + amt)), gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt)); return "#" + ((1 << 24) + (r << 16) + (gg << 8) + b).toString(16).slice(1); }

  function drawTail(t, fur) {
    g.save();
    g.translate(BW / 2 - 8, BH / 2 - 6);
    const sway = Math.sin(t / 700) * 0.12;
    g.rotate(0.5 + sway);
    const seg = [[0, 0, 15], [4, -20, 14], [2, -40, 12], [-4, -58, 10]];
    for (let i = seg.length - 1; i >= 0; i--) {
      const [x, y, r] = seg[i];
      g.fillStyle = i % 2 ? "#33363f" : fur;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.restore();
  }

  function drawGrass(topY, m) {
    const lvl = pet.hair / 100; if (lvl < 0.02) return;
    const droop = (m === "sad" || m === "hangry" || m === "dying") ? 1 : m === "meh" ? 0.5 : 0;
    g.strokeStyle = pet.hairColor; g.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const f = (i / 5) * 2 - 1, x = f * 14;
      const len = (8 + lvl * 22) * (1 - Math.abs(f) * 0.3);
      const sway = Math.sin(nowp() / 700 + i) * (2 + lvl * 2) * (1 - droop * 0.5);
      g.lineWidth = 1.5 + lvl; g.beginPath(); g.moveTo(x, topY + 2);
      g.quadraticCurveTo(x + sway * 0.5, topY - len * 0.5, x + sway + droop * f * 8, topY - len + droop * len);
      g.stroke();
    }
  }

  let blinkAt = 2200;
  function draw() {
    g.clearRect(0, 0, W, H);
    const t = nowp(), m = mood(), s = pet.scale;
    const fur = coatColor();

    let bob = Math.sin(t / 560) * 2.4, lift = 0, squash = 0, tilt = 0, wide = 0;
    let openL = 1, openR = 1, style = "normal";
    if (m === "watching") bob = Math.sin(t / 900) * 1.4;
    else if (m === "great") { bob = Math.sin(t / 380) * 3; style = "happy"; }
    else if (m === "sad") { bob = Math.sin(t / 950) * 1.1; lift = -3; }
    else if (m === "meh") bob = Math.sin(t / 820) * 1.5;
    else if (m === "nocturnal") { bob = Math.sin(t / 300) * 2.2; wide = 0.25; }
    else if (m === "frazzled") { bob = Math.sin(t / 120) * 2.2; wide = 0.2; }
    else if (m === "hangry") { bob = Math.sin(t / 1100) * 1; lift = -3; openL = openR = 0.6; }
    else if (m === "dying") { bob = Math.sin(t / 1400) * 0.8; lift = -5; openL = openR = 0.45; }
    else if (m === "charging") { bob = Math.sin(t / 420) * 2.6; style = "happy"; }
    else if (m === "nap") { bob = Math.sin(t / 1200) * 0.9; openL = openR = 0.1; }
    else if (m === "poke") { const p = Math.min(1, (t - (transient.until - 700)) / 700); lift = Math.sin(p * Math.PI) * 18; wide = 0.35; }
    else if (m === "flail") { bob = Math.sin(t / 50) * 3; wide = 0.4; }
    else if (m === "groove") { bob = Math.abs(Math.sin(t / 210)) * 6; wide = 0.1; }
    else if (m === "celebrate") { const p = Math.min(1, (t - (transient.until - 1500)) / 1500); lift = Math.abs(Math.sin(p * Math.PI * 2)) * 40 * (1 - p * 0.3); style = "happy"; }
    if (transient.kind === "eat" || transient.kind === "drink" || transient.kind === "pet") style = "happy";

    // idle beats
    let mouthOpen = 0, pawScratch = 0, leanFwd = 0, grooming = 0;
    if (m === "yawn") { mouthOpen = Math.sin(Math.min(1, (t - (idle.until - 1800)) / 1800) * Math.PI); openL = openR = 1 - mouthOpen * 0.7; }
    if (m === "scratch") pawScratch = Math.sin(t / 60) * 3;
    if (m === "tap") leanFwd = Math.abs(Math.sin(t / 140)) * 4;
    if (m === "look") { ctx.look.x = Math.sin(t / 400); ctx.look.y = Math.cos(t / 500) * 0.4; }
    if (m === "groom") grooming = 1;
    if (m === "sniff") { ctx.look.y = 0.6; leanFwd = 2; }

    // drag lean + landing bounce
    const v = Math.max(-1, Math.min(1, ctx.vel.x * 0.7));
    tilt += v * 0.25;
    if (ctx.roam === "climb-l") tilt += 0.4;
    else if (ctx.roam === "climb-r") tilt -= 0.4;
    if (m === "flail") tilt += Math.sin(t / 45) * 0.32;
    else if (m === "groove") tilt = Math.sin(t / 210) * 0.14;
    if (Math.abs(ctx.vel.x) > 1.2 && t - lastFling > 1500) { lastFling = t; say(pick(["wheee", "wa-hey!", "put me down 😅"]), 1400); }

    if (style === "normal" && !mouthOpen) { if (t > blinkAt) { const bt = t - blinkAt; if (bt < 130) openL = openR = 1 - Math.sin((bt / 130) * Math.PI); else blinkAt = t + 1900 + seed() * 3400; } }

    const cx = CX, cy = centerY - bob - lift + leanFwd;

    // shadow
    g.save(); g.fillStyle = "rgba(0,0,0,.30)"; const sh = 1 - Math.min(0.55, lift / 70);
    g.beginPath(); g.ellipse(cx, GROUND + 6, 38 * s * sh, 8 * s * sh, 0, 0, 7); g.fill(); g.restore();

    g.save(); g.translate(cx, cy); g.rotate(tilt); g.scale(s, s);
    const w = BW * (1 - squash), h = BH * (1 + squash);

    drawTail(t, fur);

    // ears
    const eY = -h / 2 + 4;
    for (const sgn of [-1, 1]) {
      g.fillStyle = shade(fur, -8);
      g.beginPath(); g.ellipse(sgn * 26, eY - 6, 13, 15, sgn * 0.3, 0, 7); g.fill();
      g.fillStyle = "#4b4f5c";
      g.beginPath(); g.ellipse(sgn * 26, eY - 4, 6, 8, sgn * 0.3, 0, 7); g.fill();
    }

    drawGrass(-h / 2 + 2, m);

    // body
    const grad = g.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, shade(fur, 16)); grad.addColorStop(0.55, fur); grad.addColorStop(1, shade(fur, -18));
    g.fillStyle = grad; rr(-w / 2, -h / 2, w, h, 30); g.fill();

    // belly patch (lighter)
    g.save(); g.globalAlpha = 0.5; g.fillStyle = shade(fur, 22); rr(-w / 2 + 14, -4, w - 28, h / 2, 22); g.fill(); g.restore();

    // feet — shuffle while walking (window moving) so it reads as crawling
    g.fillStyle = shade(fur, -26);
    const walk = (Math.abs(ctx.vel.x) > 0.12 || m === "watching") ? Math.sin(t / 70) * 3 : 0;
    rr(-20, h / 2 - 6 + pawScratch + walk, 15, 9, 5); g.fill();
    rr(6, h / 2 - 6 - pawScratch - walk, 15, 9, 5); g.fill();

    // --- face ---
    const faceY = -8;
    // brow fur (light) above the mask
    g.fillStyle = "#edeae1"; g.beginPath(); g.ellipse(0, faceY - 14, 26, 12, 0, 0, 7); g.fill();
    // mask (dark band across eyes) — darker than the coat so it still reads
    g.fillStyle = "#131319";
    g.beginPath();
    g.moveTo(-30, faceY - 8);
    g.quadraticCurveTo(0, faceY - 16, 30, faceY - 8);
    g.quadraticCurveTo(34, faceY + 6, 20, faceY + 10);
    g.quadraticCurveTo(0, faceY + 4, -20, faceY + 10);
    g.quadraticCurveTo(-34, faceY + 6, -30, faceY - 8);
    g.closePath(); g.fill();

    // eyes (in mask)
    const ex = 15;
    for (const sgn of [-1, 1]) {
      const open = sgn < 0 ? openL : openR;
      g.fillStyle = "#f6f2ea";
      const ew = 12 + wide * 6, eh = (14 + wide * 8) * open;
      g.beginPath(); g.ellipse(sgn * ex, faceY, ew / 2, eh / 2, 0, 0, 7); g.fill();
      if (open > 0.35 && style !== "happy") {
        g.fillStyle = "#14161d";
        const px = sgn * ex + ctx.look.x * 3.2, py = faceY + ctx.look.y * 3.4;
        g.beginPath(); g.arc(px, py, 3.4, 0, 7); g.fill();
        g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.arc(px - 1, py - 1.3, 1, 0, 7); g.fill();
      } else if (style === "happy") {
        g.strokeStyle = "#14161d"; g.lineWidth = 2.4; g.lineCap = "round";
        g.beginPath(); g.moveTo(sgn * ex - 5, faceY + 1); g.lineTo(sgn * ex, faceY - 4); g.lineTo(sgn * ex + 5, faceY + 1); g.stroke();
      }
    }

    // muzzle + nose + mouth
    g.fillStyle = "#efeade"; g.beginPath(); g.ellipse(0, faceY + 18, 14, 12, 0, 0, 7); g.fill();
    g.fillStyle = "#1c1e26"; g.beginPath(); g.ellipse(0, faceY + 12, 4, 3, 0, 0, 7); g.fill();
    g.strokeStyle = "#1c1e26"; g.lineWidth = 1.8; g.lineCap = "round"; g.beginPath();
    if (mouthOpen) g.ellipse(0, faceY + 22, 4, 3 + mouthOpen * 4, 0, 0, 7);
    else if (style === "happy") g.arc(0, faceY + 18, 5, 0.1 * Math.PI, 0.9 * Math.PI);
    else if (m === "sad" || m === "dying" || m === "hangry") g.arc(0, faceY + 26, 5, 1.15 * Math.PI, 1.85 * Math.PI);
    else { g.moveTo(0, faceY + 15); g.lineTo(0, faceY + 19); g.moveTo(-4, faceY + 21); g.arc(0, faceY + 19, 4, 0.2 * Math.PI, 0.8 * Math.PI); }
    g.stroke();

    if (style === "happy") { g.fillStyle = "rgba(240,150,120,.35)"; g.beginPath(); g.arc(-24, faceY + 12, 5, 0, 7); g.arc(24, faceY + 12, 5, 0, 7); g.fill(); }
    if (grooming) { g.fillStyle = shade(fur, -26); const rub = Math.sin(t / 90) * 3; rr(-11 + rub, faceY + 11, 9, 8, 4); g.fill(); rr(2 - rub, faceY + 11, 9, 8, 4); g.fill(); }
    g.restore();

    // extras (screen-space)
    if (m === "frazzled" && seed() > 0.4) drops(cx + 20, cy - 20, "#bcd3e6");
    if (transient.kind === "drink" && t < transient.until) drops(cx, cy, "#6db6e6");
    if (m === "charging") bolt(cx + 30, cy - 26);
    if (m === "dying") { g.save(); g.globalAlpha = 0.5 + Math.sin(t / 300) * 0.3; bolt(cx + 28, cy - 24, "#e06a6a"); g.restore(); }
    if ((m === "nocturnal") && seed() > 0.7) star(cx - 30 + seed() * 60, cy - 40 - seed() * 20);
    if (m === "groove") { const nb = (t / 500) % 1; g.save(); g.globalAlpha = 0.85 * (1 - nb * 0.5); g.fillStyle = "#e6a24a"; g.font = "14px system-ui, sans-serif"; g.textAlign = "center"; g.fillText("♪", cx + 30, cy - 28 - nb * 16); g.restore(); }
    if (transient.kind === "pet" && t < transient.until) heart(cx, cy - 44);
    if (m === "sad" || m === "hangry") { g.save(); g.globalAlpha = 0.7; sweat(cx + 24, cy - 6); g.restore(); }
    if (m === "nap") { const zt = (t / 2600) % 1; g.save(); g.globalAlpha = 0.85 * (1 - zt); g.fillStyle = "rgba(244,239,230,.9)"; g.font = `${10 + zt * 8}px system-ui, sans-serif`; g.textAlign = "center"; g.fillText("z", cx + 22 + zt * 10, cy - 28 - zt * 24); g.restore(); }

    // pomodoro ring
    if (focus.on) {
      const total = focus.phase === "work" ? focus.work : focus.brk;
      const frac = Math.max(0, Math.min(1, (focus.endsAt - Date.now()) / total));
      g.save();
      g.strokeStyle = focus.phase === "work" ? "rgba(230,162,74,.92)" : "rgba(120,200,140,.95)";
      g.lineWidth = 3; g.lineCap = "round";
      g.beginPath(); g.arc(cx, cy, 64 * s, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
      g.restore();
    }

    syncUI();
    requestAnimationFrame(draw);
  }
  function drops(x, y, c) { g.fillStyle = c; for (let i = 0; i < 3; i++) { const a = nowp() / 300 + i * 2; g.globalAlpha = 0.6; g.beginPath(); g.arc(x + Math.cos(a) * 16, y + Math.sin(a) * 8, 2.2, 0, 7); g.fill(); } g.globalAlpha = 1; }
  function sweat(x, y) { const p = (nowp() / 800) % 1; g.fillStyle = "#bcd3e6"; g.beginPath(); g.ellipse(x, y + p * 16, 2.6, 3.6, 0, 0, 7); g.fill(); }
  function bolt(x, y, c) { g.fillStyle = c || "#f5c542"; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5, y + 8); g.lineTo(x - 1, y + 8); g.lineTo(x - 4, y + 16); g.lineTo(x + 5, y + 6); g.lineTo(x + 1, y + 6); g.closePath(); g.fill(); }
  function star(x, y) { g.save(); g.globalAlpha = 0.7; g.fillStyle = "#f5e9c0"; g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); g.restore(); }
  function heart(x, y) { const p = (nowp() / 900) % 1; g.save(); g.globalAlpha = 1 - p; g.fillStyle = "#ef8f8f"; g.translate(x, y - p * 24); g.scale(0.5, 0.5); g.beginPath(); g.moveTo(0, 4); g.bezierCurveTo(-6, -4, -12, 4, 0, 12); g.bezierCurveTo(12, 4, 6, -4, 0, 4); g.fill(); g.restore(); }

  setInterval(() => idle.tick(), 500);
  loadPet().then(() => requestAnimationFrame(draw));
})();
