import { useEffect, useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "starflight",
  title: "Starflight",
  kind: "GAME",
  order: 3,
  icon: "🚀",
  description: "Fly through a neon starfield and blast incoming targets.",
  instructions: "Point your index finger to steer. Pinch, click, touch, or tap Space once per missile.",
};

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const randomLane = () => Math.random() * 1.65 - 0.825;

function createScene() {
  return {
    time: 0,
    ship: { x: 0, y: 0, bank: 0 },
    enemies: [
      { id: 1, x: 0, y: 0, z: 0.68, kind: "drone", spin: 0 },
      { id: 2, x: -0.52, y: -0.36, z: 0.98, kind: "drone", spin: 1 },
      { id: 3, x: 0.55, y: 0.42, z: 1.2, kind: "asteroid", spin: 2 },
    ],
    missiles: [],
    bursts: [],
    stars: Array.from({ length: 85 }, () => ({ x: randomLane() * 1.8, y: randomLane() * 1.8, z: Math.random(), size: Math.random() * 1.6 + 0.4 })),
    nextId: 4,
    spawnIn: 1.8,
    score: 0,
    shields: 3,
    actionWasDown: false,
    flash: 0,
    invulnerable: 0,
    lastMessage: "ALIGN WITH A TARGET · PINCH TO FIRE",
    messageTime: 3,
    playing: true,
  };
}

function project(width, height, x, y, z) {
  const near = 1 - z;
  return {
    x: width * (0.5 + x * (0.07 + 0.31 * near)),
    y: height * (0.29 + 0.46 * near + y * (0.025 + 0.16 * near)),
    scale: 0.15 + 1.2 * near,
  };
}

function lockedEnemy(scene) {
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of scene.enemies) {
    if (enemy.z > 1 || enemy.z < 0.1) continue;
    const distance = Math.hypot(enemy.x - scene.ship.x, enemy.y - scene.ship.y);
    if (distance < 0.37 && distance < bestDistance) {
      best = enemy;
      bestDistance = distance;
    }
  }
  return best;
}

function addBurst(scene, x, y, color, size = 1) {
  scene.bursts.push({ id: scene.nextId++, x, y, color, age: 0, size });
  if (scene.bursts.length > 22) scene.bursts.shift();
}

function fire(scene) {
  const target = lockedEnemy(scene);
  scene.missiles.push({
    id: scene.nextId++,
    targetId: target?.id ?? null,
    x: scene.ship.x,
    y: scene.ship.y,
    age: 0,
    duration: target ? 0.38 : 0.52,
    targetX: target?.x ?? scene.ship.x,
    targetY: target?.y ?? scene.ship.y,
    targetZ: target?.z ?? 0.58,
  });
  if (scene.missiles.length > 10) scene.missiles.shift();
  scene.lastMessage = target ? "MISSILE LOCKED" : "MISSILE AWAY";
  scene.messageTime = 0.8;
}

function stepScene(scene, input, seconds) {
  const dt = Math.min(seconds, 0.05);
  scene.time += dt;
  scene.flash = Math.max(0, scene.flash - dt * 2.8);
  scene.invulnerable = Math.max(0, scene.invulnerable - dt);
  scene.messageTime = Math.max(0, scene.messageTime - dt);

  const targetX = input.active ? clamp(input.x * 2 - 1, -0.9, 0.9) : scene.ship.x;
  const targetY = input.active ? clamp(input.y * 2 - 1, -0.85, 0.85) : scene.ship.y;
  const oldX = scene.ship.x;
  const follow = 1 - Math.exp(-dt * (input.source === "camera" ? 9 : 16));
  scene.ship.x += (targetX - scene.ship.x) * follow;
  scene.ship.y += (targetY - scene.ship.y) * follow;
  scene.ship.bank += (clamp((scene.ship.x - oldX) * 22, -0.6, 0.6) - scene.ship.bank) * Math.min(1, dt * 9);

  const actionStarted = input.active && input.action && !scene.actionWasDown;
  scene.actionWasDown = input.active && input.action;
  if (actionStarted && scene.playing) fire(scene);

  for (const star of scene.stars) {
    star.z -= dt * (0.1 + star.size * 0.05);
    if (star.z < 0) {
      star.z = 1;
      star.x = randomLane() * 1.8;
      star.y = randomLane() * 1.8;
    }
  }
  for (const burst of scene.bursts) burst.age += dt;
  scene.bursts = scene.bursts.filter((burst) => burst.age < 0.55);
  if (!scene.playing || !input.active) return;

  scene.spawnIn -= dt;
  if (scene.spawnIn <= 0) {
    scene.enemies.push({ id: scene.nextId++, x: randomLane(), y: randomLane(), z: 1.15, kind: Math.random() < 0.22 ? "asteroid" : "drone", spin: Math.random() * TAU });
    scene.spawnIn = Math.max(0.65, 1.35 - scene.score / 2500) + Math.random() * 0.4;
  }

  const speed = Math.min(0.43, 0.27 + scene.score / 9000);
  for (const enemy of scene.enemies) {
    enemy.z -= dt * speed;
    enemy.spin += dt * (enemy.kind === "asteroid" ? 0.7 : 1.5);
  }
  for (const missile of scene.missiles) {
    missile.age += dt;
    if (missile.age < missile.duration) continue;
    const target = scene.enemies.find((enemy) => enemy.id === missile.targetId);
    if (target) {
      scene.enemies = scene.enemies.filter((enemy) => enemy.id !== target.id);
      scene.score += target.kind === "asteroid" ? 50 : 100;
      addBurst(scene, target.x, target.y, target.kind === "asteroid" ? "#ffca70" : "#76f4ff", 1.4);
      scene.lastMessage = target.kind === "asteroid" ? "+50 ASTEROID" : "+100 TARGET DOWN";
      scene.messageTime = 1;
    } else if (missile.targetId === null) {
      const stray = scene.enemies.find((enemy) => enemy.z > 0.15 && enemy.z < 0.75 && Math.hypot(enemy.x - missile.x, enemy.y - missile.y) < 0.18);
      if (stray) {
        scene.enemies = scene.enemies.filter((enemy) => enemy.id !== stray.id);
        scene.score += stray.kind === "asteroid" ? 50 : 100;
        addBurst(scene, stray.x, stray.y, "#76f4ff", 1.4);
      }
    }
  }
  scene.missiles = scene.missiles.filter((missile) => missile.age < missile.duration);

  for (const enemy of scene.enemies) {
    if (enemy.z > 0) continue;
    if (scene.invulnerable === 0 && Math.hypot(enemy.x - scene.ship.x, enemy.y - scene.ship.y) < 0.25) {
      scene.shields = Math.max(0, scene.shields - 1);
      scene.invulnerable = 1.2;
      scene.flash = 1;
      addBurst(scene, scene.ship.x, scene.ship.y, "#ff6c80", 2);
      scene.lastMessage = scene.shields > 0 ? "HULL HIT!" : "MISSION OVER";
      scene.messageTime = 1.3;
      if (scene.shields <= 0) scene.playing = false;
    }
  }
  scene.enemies = scene.enemies.filter((enemy) => enemy.z > 0);
}

function path(context, points, fill, stroke, lineWidth = 1) {
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath();
  if (fill) { context.fillStyle = fill; context.fill(); }
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = lineWidth; context.stroke(); }
}

function drawEnemy(context, enemy, width, height, isLocked) {
  const at = project(width, height, enemy.x, enemy.y, enemy.z);
  const size = clamp(26 * at.scale, 5, 42);
  context.save();
  context.translate(at.x, at.y);
  context.rotate(enemy.spin * (enemy.kind === "asteroid" ? 0.18 : 0.08));
  if (enemy.kind === "asteroid") {
    path(context, [[-size, -size * 0.2], [-size * 0.52, -size], [size * 0.4, -size * 0.87], [size, -size * 0.18], [size * 0.7, size * 0.75], [-size * 0.37, size]], "#7a6d84", "#e6b885", 2);
    path(context, [[-size * 0.32, -size * 0.45], [size * 0.18, -size * 0.55], [size * 0.45, -size * 0.05], [-size * 0.15, size * 0.1]], "#aa8d9d", null);
  } else {
    context.shadowColor = "#ff547b";
    context.shadowBlur = size * 0.8;
    path(context, [[0, -size], [size * 0.92, size * 0.4], [size * 0.25, size * 0.18], [0, size * 0.65], [-size * 0.25, size * 0.18], [-size * 0.92, size * 0.4]], "#dc4268", "#ffd1dd", 1.5);
    context.shadowBlur = 0;
    path(context, [[0, -size * 0.55], [size * 0.28, size * 0.16], [0, size * 0.35], [-size * 0.28, size * 0.16]], "#5b1736", "#ff9bb3", 1);
  }
  context.restore();
  if (isLocked) {
    const ring = size + 16;
    context.strokeStyle = "#9efcff";
    context.lineWidth = 2.5;
    context.shadowColor = "#73f8ff";
    context.shadowBlur = 14;
    context.strokeRect(at.x - ring, at.y - ring, ring * 2, ring * 2);
    context.shadowBlur = 0;
    context.fillStyle = "#b9ffff";
    context.font = "700 11px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("LOCK", at.x, at.y - ring - 9);
  }
}

function drawShip(context, scene, width, height) {
  const at = project(width, height, scene.ship.x, scene.ship.y, 0);
  const scale = clamp(Math.min(width / 1000, height / 650), 0.65, 1.45);
  context.save();
  context.translate(at.x, at.y);
  context.rotate(scene.ship.bank);
  context.scale(scale, scale);
  const flame = 19 + Math.sin(scene.time * 33) * 7;
  context.shadowColor = "#5bf4ff";
  context.shadowBlur = 22;
  path(context, [[-13, 28], [0, 28 + flame], [13, 28]], "#3ceaff", null);
  context.shadowBlur = 0;
  path(context, [[0, -44], [18, 1], [57, 17], [65, 31], [22, 24], [0, 35], [-22, 24], [-65, 31], [-57, 17], [-18, 1]], "#d8ebff", "#58eaff", 2.5);
  path(context, [[0, -39], [13, 4], [0, 24], [-13, 4]], "#183556", "#a6efff", 2);
  path(context, [[-53, 18], [-24, 13], [-20, 23], [-57, 29]], "#56bbec", null);
  path(context, [[53, 18], [24, 13], [20, 23], [57, 29]], "#56bbec", null);
  context.fillStyle = "#ff7e90";
  context.fillRect(-47, 26, 13, 4);
  context.fillRect(34, 26, 13, 4);
  context.restore();
}

function drawInputMarker(context, input, width, height, time) {
  if (!input.active) return;
  const x = clamp(input.x, 0, 1) * width;
  const y = clamp(input.y, 0, 1) * height;
  const color = input.action ? "#ffd078" : "#75f7ff";
  const radius = input.action ? 14 : 18 + Math.sin(time * 7) * 2;
  const label = input.action ? (input.source === "camera" ? "PINCH" : "FIRE") : input.source === "camera" ? "INDEX TIP" : "POINTER";

  context.save();
  context.shadowColor = color;
  context.shadowBlur = 18;
  context.fillStyle = "rgba(3, 17, 35, .65)";
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.beginPath(); context.arc(x, y, radius, 0, TAU); context.fill(); context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = "#ffffff";
  context.beginPath(); context.arc(x, y, 4, 0, TAU); context.fill();
  context.font = "800 11px ui-monospace, monospace";
  context.textAlign = "left";
  const labelWidth = context.measureText(label).width + 16;
  const labelX = clamp(x + 23, 5, width - labelWidth - 5);
  const labelY = clamp(y - 29, 88, height - 27);
  context.fillStyle = "rgba(3, 17, 35, .84)";
  context.fillRect(labelX, labelY, labelWidth, 21);
  context.fillStyle = color;
  context.fillText(label, labelX + 8, labelY + 15);
  context.restore();
}

function drawScene(canvas, scene, input) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "rgba(7, 17, 39, .62)");
  sky.addColorStop(0.58, "rgba(18, 51, 90, .50)");
  sky.addColorStop(1, "rgba(8, 12, 35, .68)");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const horizon = context.createRadialGradient(width * 0.5, height * 0.31, 5, width * 0.5, height * 0.31, width * 0.56);
  horizon.addColorStop(0, "rgba(93, 200, 255, .44)");
  horizon.addColorStop(1, "rgba(93, 200, 255, 0)");
  context.fillStyle = horizon;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(100, 219, 255, .18)";
  context.lineWidth = 1;
  for (const lane of [-1, -0.5, 0, 0.5, 1]) {
    const far = project(width, height, lane, 1, 1);
    const near = project(width, height, lane, 1, 0);
    context.beginPath(); context.moveTo(far.x, far.y); context.lineTo(near.x, near.y); context.stroke();
  }
  for (let index = 0; index < 9; index += 1) {
    const z = (index / 9 + scene.time * 0.17) % 1;
    const left = project(width, height, -1, 1, z);
    const right = project(width, height, 1, 1, z);
    context.beginPath(); context.moveTo(left.x, left.y); context.lineTo(right.x, right.y); context.stroke();
  }

  for (const star of scene.stars) {
    const at = project(width, height, star.x, star.y, star.z);
    const tail = project(width, height, star.x, star.y, Math.min(1, star.z + 0.035));
    context.strokeStyle = `rgba(205, 239, 255, ${0.2 + (1 - star.z) * 0.65})`;
    context.lineWidth = star.size;
    context.beginPath(); context.moveTo(at.x, at.y); context.lineTo(tail.x, tail.y); context.stroke();
  }

  const lock = scene.playing && input.active ? lockedEnemy(scene) : null;
  scene.enemies.slice().sort((a, b) => b.z - a.z).forEach((enemy) => drawEnemy(context, enemy, width, height, enemy.id === lock?.id));

  for (const missile of scene.missiles) {
    const progress = clamp(missile.age / missile.duration, 0, 1);
    const target = scene.enemies.find((enemy) => enemy.id === missile.targetId);
    const destination = project(width, height, target?.x ?? missile.targetX, target?.y ?? missile.targetY, target?.z ?? missile.targetZ);
    const origin = project(width, height, missile.x, missile.y, 0);
    const eased = 1 - (1 - progress) ** 2;
    const x = origin.x + (destination.x - origin.x) * eased;
    const y = origin.y + (destination.y - origin.y) * eased;
    context.strokeStyle = "#83faff";
    context.lineWidth = 4 + (1 - progress) * 3;
    context.shadowColor = "#48eaff";
    context.shadowBlur = 18;
    context.beginPath(); context.moveTo(origin.x, origin.y - 30); context.lineTo(x, y); context.stroke();
    context.shadowBlur = 0;
    context.save();
    context.translate(x, y);
    context.rotate(Math.atan2(destination.y - origin.y, destination.x - origin.x) + Math.PI / 2);
    path(context, [[0, 7], [-3, 17 + Math.sin(scene.time * 40) * 3], [3, 7]], "#ffae69", null);
    path(context, [[0, -11], [6, 7], [0, 4], [-6, 7]], "#f5ffff", "#60f4ff", 1.5);
    context.restore();
  }

  for (const burst of scene.bursts) {
    const at = project(width, height, burst.x, burst.y, 0.3);
    const radius = burst.age * 95 * burst.size;
    context.globalAlpha = 1 - burst.age / 0.55;
    context.strokeStyle = burst.color;
    context.lineWidth = 4;
    context.beginPath(); context.arc(at.x, at.y, radius, 0, TAU); context.stroke();
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = spoke * TAU / 8 + burst.id;
      context.beginPath();
      context.moveTo(at.x + Math.cos(angle) * radius * 0.65, at.y + Math.sin(angle) * radius * 0.65);
      context.lineTo(at.x + Math.cos(angle) * radius * 1.2, at.y + Math.sin(angle) * radius * 1.2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  drawShip(context, scene, width, height);
  if (scene.flash > 0) {
    context.fillStyle = `rgba(255, 77, 113, ${scene.flash * 0.24})`;
    context.fillRect(0, 0, width, height);
  }
  drawInputMarker(context, input, width, height, scene.time);
}

export default function Starflight({ inputRef, paused }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  if (sceneRef.current === null) sceneRef.current = createScene();
  const hudRef = useRef({ score: 0, shields: 3, message: "ALIGN WITH A TARGET · PINCH TO FIRE", playing: true, active: false });
  const [hud, setHud] = useState(hudRef.current);
  const hudClock = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => drawScene(canvas, sceneRef.current, inputRef.current));
    observer.observe(canvas);
    drawScene(canvas, sceneRef.current, inputRef.current);
    return () => observer.disconnect();
  }, [inputRef]);

  useDemoFrame((seconds) => {
    const scene = sceneRef.current;
    const input = inputRef.current;
    stepScene(scene, input, seconds);
    if (canvasRef.current) drawScene(canvasRef.current, scene, input);
    hudClock.current += seconds;
    if (hudClock.current >= 0.1) {
      hudClock.current = 0;
      const next = {
        score: scene.score,
        shields: scene.shields,
        message: scene.messageTime > 0 ? scene.lastMessage : lockedEnemy(scene) ? "TARGET LOCKED · PINCH TO FIRE" : "ALIGN WITH A TARGET · PINCH TO FIRE",
        playing: scene.playing,
        active: input.active,
      };
      if (Object.keys(next).some((key) => next[key] !== hudRef.current[key])) {
        hudRef.current = next;
        setHud(next);
      }
    }
  }, paused);

  const labelStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.12em", textShadow: "0 2px 12px #061127" };
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "transparent", color: "#effbff", pointerEvents: "none" }}>
      <canvas ref={canvasRef} aria-label="Starflight game: steer your ship toward incoming targets and fire missiles" style={{ display: "block", width: "100%", height: "100%" }} />
      <div style={{ position: "absolute", top: "clamp(100px, 14vh, 138px)", left: 22, display: "flex", gap: 28, padding: "10px 14px", border: "1px solid rgba(124, 231, 255, .4)", borderRadius: 12, background: "rgba(5, 19, 41, .68)", backdropFilter: "blur(6px)", ...labelStyle }}>
        <span><small style={{ display: "block", color: "#80dbed", fontSize: 10 }}>SCORE</small><strong style={{ fontSize: 24 }}>{hud.score.toString().padStart(5, "0")}</strong></span>
        <span><small style={{ display: "block", color: "#80dbed", fontSize: 10 }}>SHIELDS</small><strong style={{ fontSize: 24, color: hud.shields === 1 ? "#ff8299" : "#a0f6ff" }}>{"◆".repeat(hud.shields)}{"◇".repeat(3 - hud.shields)}</strong></span>
      </div>
      <div style={{ position: "absolute", top: "clamp(179px, 25vh, 225px)", left: "50%", transform: "translateX(-50%)", maxWidth: "calc(100% - 32px)", padding: "7px 12px", borderRadius: 4, color: "#c4fbff", background: "rgba(5, 19, 41, .62)", textAlign: "center", whiteSpace: "nowrap", fontSize: "clamp(10px, 1.5vw, 14px)", fontWeight: 800, ...labelStyle }}>
        {hud.active ? hud.message : "SHOW YOUR HAND OR SELECT POINTER"}
      </div>
      {!hud.playing && <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center", background: "rgba(3, 10, 25, .74)", ...labelStyle }}><strong style={{ fontSize: "clamp(32px, 6vw, 72px)", color: "#fff" }}>MISSION OVER</strong><span style={{ marginTop: 12, color: "#9df4ff" }}>SCORE {hud.score} · USE RESTART TO FLY AGAIN</span></div>}
    </div>
  );
}
