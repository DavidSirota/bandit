// deskpet creature — hand-drawn on a canvas, no assets, no dependencies.
// Reacts to a "mood" event emitted by the Rust side (from ~/.deskpet/state).
// Runs fine in a plain browser too (mood events just won't arrive), which
// makes it easy to tweak the art without rebuilding.

(() => {
  "use strict";

  // ---- theme (retint here; body reads on any wallpaper) ----------------
  const T = {
    body: "#2b2f3d",
    bodyHi: "#3b4254",
    body2: "#20242e",
    eye: "#f4efe6",
    pupil: "#1b1e27",
    accent: "#ef9d5c", // warm — sparkles, alert mark, zzz
    shadow: "rgba(0,0,0,0.30)",
  };

  const MOODS = new Set(["idle", "thinking", "working", "celebrate", "alert", "sleep"]);
  const SLEEP_AFTER_MS = 3 * 60 * 1000; // dozes off if left alone
  const CELEBRATE_MS = 1500;
  const ALERT_MS = 4000;

  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  const W = 180, H = 200;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const state = {
    mood: "idle",
    since: performance.now(),
    lastActivity: performance.now(),
    blinkAt: 1500 + Math.random() * 3000,
  };

  function setMood(m) {
    if (!MOODS.has(m)) return;
    state.mood = m;
    state.since = performance.now();
    state.lastActivity = performance.now();
  }

  // Receive moods from the Rust side if we're inside Tauri.
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen("mood", (e) => setMood(String(e.payload || "idle")));
  }

  // ---- little drawing helpers -----------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function eye(cx, cy, open, look) {
    const w = 12, h = 15 * open;
    ctx.fillStyle = T.eye;
    roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(6, h / 2));
    ctx.fill();
    if (open > 0.35) {
      ctx.fillStyle = T.pupil;
      const px = cx + look.x * 3;
      const py = cy + look.y * 4;
      ctx.beginPath();
      ctx.arc(px, py, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(px - 1, py - 1.3, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function happyEye(cx, cy) {
    ctx.strokeStyle = T.eye;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 1);
    ctx.lineTo(cx, cy - 4);
    ctx.lineTo(cx + 6, cy + 1);
    ctx.stroke();
  }

  function sleepEye(cx, cy) {
    ctx.strokeStyle = T.eye;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy - 2, 6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  function sparkle(x, y, s, a) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = T.accent;
    ctx.translate(x, y);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s * 0.35, s * 0.35, 0, s);
      ctx.quadraticCurveTo(-s * 0.35, s * 0.35, 0, 0);
    }
    ctx.fill();
    ctx.restore();
  }

  // ---- the creature ----------------------------------------------------
  function draw(now) {
    ctx.clearRect(0, 0, W, H);

    const mood = state.mood;
    const age = now - state.since;
    const t = now / 1000;

    // baseline geometry
    const bw = 78, bh = 88;
    const baseX = W / 2;
    const groundY = H - 30;

    // per-mood motion
    let bob = 0, squash = 0, tilt = 0, lift = 0;
    let lookX = 0, lookY = 0, openL = 1, openR = 1, eyeStyle = "normal";

    if (mood === "idle") {
      bob = Math.sin(t * 1.8) * 2.5;
      squash = Math.sin(t * 1.8) * 0.02;
    } else if (mood === "thinking") {
      bob = Math.sin(t * 1.4) * 1.5;
      tilt = -0.06;
      lookX = -0.6; lookY = -1;
    } else if (mood === "working") {
      bob = Math.abs(Math.sin(t * 7)) * 3;
      squash = Math.sin(t * 14) * 0.05;
      lookY = 0.8; lookX = Math.sin(t * 9) * 0.5;
    } else if (mood === "celebrate") {
      const p = Math.min(1, age / CELEBRATE_MS);
      const hops = 2;
      lift = Math.abs(Math.sin(p * Math.PI * hops)) * 34 * (1 - p * 0.25);
      squash = -Math.cos(p * Math.PI * hops * 2) * 0.06;
      eyeStyle = "happy";
    } else if (mood === "alert") {
      bob = Math.sin(t * 2) * 2;
      tilt = Math.sin(t * 6) * 0.08; // gentle wave
      openL = openR = 1.15;
    } else if (mood === "sleep") {
      bob = Math.sin(t * 0.9) * 1.6;
      lift = -3;
      eyeStyle = "sleep";
    }

    // blink (only when eyes are "normal")
    if (eyeStyle === "normal") {
      if (now > state.blinkAt) {
        const bt = now - state.blinkAt;
        if (bt < 130) openL = openR = 1 - Math.sin((bt / 130) * Math.PI);
        else state.blinkAt = now + 1800 + Math.random() * 3600;
      }
    }

    const cx = baseX;
    const cy = groundY - bh / 2 - bob - lift;

    // contact shadow (shrinks as it jumps)
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = T.shadow;
    const sh = 1 - Math.min(0.6, lift / 60);
    ctx.beginPath();
    ctx.ellipse(cx, groundY + 4, 34 * sh, 7 * sh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);

    // body with squash-and-stretch
    const sx = 1 - squash, sy = 1 + squash;
    const w = bw * sx, h = bh * sy;

    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, T.bodyHi);
    grad.addColorStop(0.5, T.body);
    grad.addColorStop(1, T.body2);
    ctx.fillStyle = grad;
    roundRect(-w / 2, -h / 2, w, h, 26);
    ctx.fill();

    // soft top sheen
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ffffff";
    roundRect(-w / 2 + 8, -h / 2 + 7, w - 16, 16, 10);
    ctx.fill();
    ctx.restore();

    // feet
    ctx.fillStyle = T.body2;
    const footShuffle = mood === "working" ? Math.sin(t * 14) * 3 : 0;
    roundRect(-18, h / 2 - 5 + footShuffle, 13, 8, 4);
    ctx.fill();
    roundRect(5, h / 2 - 5 - footShuffle, 13, 8, 4);
    ctx.fill();

    // face
    const ex = 15, ey = -6;
    if (eyeStyle === "happy") {
      happyEye(-ex, ey); happyEye(ex, ey);
    } else if (eyeStyle === "sleep") {
      sleepEye(-ex, ey); sleepEye(ex, ey);
    } else {
      eye(-ex, ey, openL, { x: lookX, y: lookY });
      eye(ex, ey, openR, { x: lookX, y: lookY });
    }

    // mouth
    ctx.strokeStyle = "rgba(244,239,230,0.55)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (mood === "celebrate") ctx.arc(0, 8, 6, 0.1 * Math.PI, 0.9 * Math.PI);
    else if (mood === "sleep") ctx.arc(0, 12, 4, 0, Math.PI);
    else if (mood === "working") { ctx.moveTo(-4, 10); ctx.lineTo(4, 10); }
    else ctx.arc(0, 9, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.restore();

    // extras above the creature
    if (mood === "celebrate") {
      const p = Math.min(1, age / CELEBRATE_MS);
      sparkle(cx - 34, cy - 30 - p * 10, 8, 1 - p);
      sparkle(cx + 32, cy - 22 - p * 14, 6, 1 - p);
      sparkle(cx + 4, cy - 52 - p * 8, 5, 1 - p);
    } else if (mood === "thinking") {
      const bob2 = (t % 1.6) / 1.6;
      ctx.save();
      ctx.globalAlpha = 0.8 * (1 - bob2);
      ctx.fillStyle = "rgba(244,239,230,0.9)";
      ctx.beginPath();
      ctx.arc(cx + 26, cy - 40 - bob2 * 16, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (mood === "alert") {
      ctx.fillStyle = T.accent;
      const jy = Math.abs(Math.sin(t * 6)) * 4;
      ctx.font = "bold 22px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", cx, cy - 44 - jy);
    } else if (mood === "sleep") {
      const zt = (t % 3) / 3;
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - zt);
      ctx.fillStyle = "rgba(244,239,230,0.9)";
      ctx.font = `${10 + zt * 8}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("z", cx + 24 + zt * 12, cy - 26 - zt * 26);
      ctx.restore();
    }
  }

  // ---- loop: handle transient moods + idle->sleep, then draw ----------
  function tick(now) {
    const mood = state.mood;
    const age = now - state.since;

    if (mood === "celebrate" && age > CELEBRATE_MS) setMoodQuiet("idle", now);
    else if (mood === "alert" && age > ALERT_MS) setMoodQuiet("idle", now);
    else if (mood === "idle" && now - state.lastActivity > SLEEP_AFTER_MS)
      setMoodQuiet("sleep", now);

    draw(now);
    requestAnimationFrame(tick);
  }

  // internal transition that does NOT reset the activity clock
  function setMoodQuiet(m, now) {
    state.mood = m;
    state.since = now;
  }

  requestAnimationFrame(tick);
})();
