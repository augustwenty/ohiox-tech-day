import { useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "asteroid-finger-guns",
  title: "Asteroid Finger Guns",
  kind: "GAME",
  order: 2,
  icon: "☄️",
  description: "Up to four hands angle their lasers through a 3D asteroid storm.",
  instructions: "Bring up to four hands. Each index finger is an autofiring laser; pointer mode controls one ship.",
};

const TAU = Math.PI * 2;
const COLORS = ["#ff7b54", "#ffb84d", "#ffe78a", "#69efff", "#b88cff"];
const PLAYER_COLORS = ["#69efff", "#ff7fd1", "#ffe46b", "#9cff78"];
const TRACKING_GRACE_SECONDS = 0.55;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const random = (min, max) => min + Math.random() * (max - min);

function makeStars(count = 150) {
  return Array.from({ length: count }, (_, id) => ({
    id,
    angle: Math.random() * TAU,
    distance: Math.random(),
    speed: random(0.16, 0.52),
    size: random(0.45, 1.8),
  }));
}

function makeAsteroid(id, wave) {
  const size = random(18, 34) * Math.min(1.45, 1 + wave * 0.025);
  return {
    id,
    laneX: random(-0.78, 0.78),
    laneY: random(0.22, 0.92),
    depth: random(0.015, 0.07),
    speed: random(0.075, 0.12) * Math.min(1.75, 1 + wave * 0.045),
    size,
    hp: size > 34 ? 2 : 1,
    rotation: Math.random() * TAU,
    spin: random(-1.15, 1.15),
    craters: Array.from({ length: 4 }, () => ({
      angle: Math.random() * TAU,
      distance: random(0.15, 0.58),
      size: random(0.09, 0.2),
    })),
    points: Array.from({ length: 10 }, (_, index) => ({
      angle: index / 10 * TAU,
      radius: random(0.78, 1.13),
    })),
  };
}

function createScene() {
  return {
    time: 0,
    score: 0,
    playerScores: [0, 0, 0, 0],
    combo: 1,
    comboTime: 0,
    shields: 3,
    wave: 1,
    nextId: 1,
    spawnClock: 0.35,
    shake: 0,
    flash: 0,
    gameOver: false,
    aims: PLAYER_COLORS.map((color, index) => ({
      id: index,
      color,
      ox: 0.5,
      oy: 0.72,
      dx: 0,
      dy: -1,
      active: false,
      camera: false,
      handedness: null,
      missingFor: TRACKING_GRACE_SECONDS,
      fireClock: index * 0.026,
    })),
    stars: makeStars(),
    asteroids: [],
    beams: [],
    particles: [],
    rings: [],
    floaters: [],
  };
}

function projected(asteroid, width, height) {
  const spread = Math.pow(asteroid.depth, 1.22);
  return {
    x: width * 0.5 + asteroid.laneX * width * spread * 0.72,
    y: height * 0.16 + asteroid.laneY * height * spread * 0.85,
    radius: asteroid.size * (0.12 + spread * 1.32),
  };
}

function smoothRay(previous, ox, oy, dx, dy, camera) {
  const length = Math.hypot(dx, dy);
  if (length < 0.012) return { ...previous, active: false };
  dx /= length;
  dy /= length;
  const blend = previous.active ? 0.24 : 1;
  const smoothDx = previous.dx + (dx - previous.dx) * blend;
  const smoothDy = previous.dy + (dy - previous.dy) * blend;
  const smoothLength = Math.hypot(smoothDx, smoothDy) || 1;
  return {
    ...previous,
    ox: previous.ox + (ox - previous.ox) * blend,
    oy: previous.oy + (oy - previous.oy) * blend,
    dx: smoothDx / smoothLength,
    dy: smoothDy / smoothLength,
    active: true,
    camera,
    missingFor: 0,
  };
}

function inputRays(input, previousAims, seconds) {
  if (input.source !== "camera") {
    const pointer = smoothRay(previousAims[0], 0.5, 0.94, input.x - 0.5, input.y - 0.94, false);
    return previousAims.map((aim, index) => index === 0
      ? { ...pointer, active: input.active, handedness: null }
      : { ...aim, active: false, handedness: null, missingFor: TRACKING_GRACE_SECONDS });
  }

  const candidates = (input.hands ?? []).slice(0, 4).flatMap((hand) => {
    const landmarks = hand.landmarks;
    const pip = landmarks?.[6];
    const tip = landmarks?.[8];
    return pip && tip ? [{ pip, tip, handedness: hand.handedness ?? null }] : [];
  });

  const next = previousAims.map((aim) => ({ ...aim, missingFor: aim.missingFor + seconds }));
  const availableSlots = new Set(previousAims.map((_, index) => index));
  for (const candidate of candidates) {
    let bestSlot = null;
    let bestCost = Infinity;
    for (const index of availableSlots) {
      const previous = previousAims[index];
      const distance = Math.hypot(candidate.tip.x - previous.ox, candidate.tip.y - previous.oy);
      const handednessPenalty = previous.handedness && candidate.handedness !== previous.handedness ? 0.3 : 0;
      const unusedPenalty = previous.active ? 0 : 0.08;
      const cost = distance + handednessPenalty + unusedPenalty;
      if (cost < bestCost) {
        bestCost = cost;
        bestSlot = index;
      }
    }
    if (bestSlot === null) continue;
    availableSlots.delete(bestSlot);
    const ray = smoothRay(
      previousAims[bestSlot],
      candidate.tip.x,
      candidate.tip.y,
      candidate.tip.x - candidate.pip.x,
      candidate.tip.y - candidate.pip.y,
      true,
    );
    next[bestSlot] = { ...ray, handedness: candidate.handedness };
  }

  return next.map((aim, index) => availableSlots.has(index)
    ? { ...aim, active: previousAims[index].active && aim.missingFor < TRACKING_GRACE_SECONDS }
    : aim);
}

function rayExit(aim, width, height) {
  const x = aim.ox * width;
  const y = aim.oy * height;
  const tx = aim.dx > 0 ? (width - x) / aim.dx : aim.dx < 0 ? -x / aim.dx : Infinity;
  const ty = aim.dy > 0 ? (height - y) / aim.dy : aim.dy < 0 ? -y / aim.dy : Infinity;
  const distance = Math.max(0, Math.min(tx, ty));
  return { x: x + aim.dx * distance, y: y + aim.dy * distance, distance };
}

function burst(scene, x, y, radius, color = "#ff9b54") {
  scene.shake = Math.max(scene.shake, Math.min(12, radius * 0.22));
  scene.flash = Math.max(scene.flash, 0.7);
  scene.rings.push({ x, y, radius: 4, target: radius * 2.5, age: 0, color });
  const count = Math.round(clamp(radius * 0.9, 18, 48));
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * TAU;
    const speed = random(55, 260) * (0.65 + radius / 80);
    scene.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: random(0.28, 0.85),
      size: random(1.5, 5.5),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      streak: Math.random() > 0.45,
    });
  }
}

function fire(scene, aim, width, height) {
  const startX = aim.ox * width;
  const startY = aim.oy * height;
  const end = rayExit(aim, width, height);
  let target = null;
  let targetDistance = Infinity;

  for (const asteroid of scene.asteroids) {
    const at = projected(asteroid, width, height);
    const relX = at.x - startX;
    const relY = at.y - startY;
    const along = relX * aim.dx + relY * aim.dy;
    if (along <= 0 || along >= end.distance) continue;
    const across = Math.abs(relX * aim.dy - relY * aim.dx);
    if (across <= at.radius + 7 && along < targetDistance) {
      target = { asteroid, at };
      targetDistance = along;
    }
  }

  const hitX = target ? startX + aim.dx * targetDistance : end.x;
  const hitY = target ? startY + aim.dy * targetDistance : end.y;
  scene.beams.push({ x1: startX, y1: startY, x2: hitX, y2: hitY, age: 0, hit: Boolean(target), color: aim.color });
  for (let spark = 0; spark < 3; spark += 1) {
    scene.particles.push({ x: startX, y: startY, vx: aim.dx * random(80, 170) + random(-25, 25), vy: aim.dy * random(80, 170) + random(-25, 25), age: 0, life: 0.2, size: 2, color: aim.color, streak: true });
  }

  if (!target) {
    scene.comboTime = Math.max(0, scene.comboTime - 0.08);
    return;
  }
  target.asteroid.hp -= 1;
  burst(scene, target.at.x, target.at.y, Math.max(15, target.at.radius * 0.55), aim.color);
  if (target.asteroid.hp > 0) return;
  scene.asteroids = scene.asteroids.filter((asteroid) => asteroid !== target.asteroid);
  const points = 100 * scene.combo;
  scene.score += points;
  scene.playerScores[aim.id] += points;
  scene.combo = Math.min(9, scene.combo + 1);
  scene.comboTime = 2.2;
  scene.floaters.push({ x: target.at.x, y: target.at.y, text: `P${aim.id + 1} +${points}`, age: 0, color: aim.color });
  burst(scene, target.at.x, target.at.y, target.at.radius + 22);
}

function stepScene(scene, input, seconds, width, height) {
  scene.time += seconds;
  scene.aims = inputRays(input, scene.aims, seconds);
  const playerCount = scene.aims.filter((aim) => aim.active).length;
  scene.shake = Math.max(0, scene.shake - seconds * 24);
  scene.flash = Math.max(0, scene.flash - seconds * 3.6);
  scene.comboTime = Math.max(0, scene.comboTime - seconds);
  if (scene.comboTime === 0) scene.combo = 1;
  if (scene.gameOver) return;

  for (const star of scene.stars) {
    star.distance += seconds * star.speed;
    if (star.distance > 1) {
      star.distance -= 1;
      star.angle = Math.random() * TAU;
    }
  }

  scene.spawnClock -= seconds;
  const asteroidLimit = 18 + Math.max(1, playerCount) * 7;
  if (scene.spawnClock <= 0 && scene.asteroids.length < asteroidLimit) {
    scene.asteroids.push(makeAsteroid(scene.nextId++, scene.wave));
    const playerPressure = 1 + Math.max(0, playerCount - 1) * 0.38;
    scene.spawnClock = random(0.2, 0.42) / (Math.min(1.8, 1 + scene.wave * 0.05) * playerPressure);
  }

  for (const asteroid of scene.asteroids) {
    asteroid.depth += seconds * asteroid.speed;
    asteroid.rotation += seconds * asteroid.spin;
  }
  const escaped = scene.asteroids.filter((asteroid) => asteroid.depth >= 1.08);
  for (const asteroid of escaped) {
    const at = projected(asteroid, width, height);
    burst(scene, at.x, at.y, at.radius * 0.65, "#ff5470");
    scene.shields -= 1;
    scene.combo = 1;
    scene.comboTime = 0;
  }
  if (escaped.length) scene.asteroids = scene.asteroids.filter((asteroid) => asteroid.depth < 1.08);
  if (scene.shields <= 0) scene.gameOver = true;
  scene.wave = 1 + Math.floor(scene.score / 1200);

  for (const aim of scene.aims) {
    aim.fireClock -= seconds;
    if (aim.active && aim.fireClock <= 0) {
      fire(scene, aim, width, height);
      aim.fireClock = 0.12;
    }
  }

  for (const beam of scene.beams) beam.age += seconds;
  scene.beams = scene.beams.filter((beam) => beam.age < 0.16).slice(-40);
  for (const ring of scene.rings) {
    ring.age += seconds;
    ring.radius += (ring.target - ring.radius) * Math.min(1, seconds * 9);
  }
  scene.rings = scene.rings.filter((ring) => ring.age < 0.6).slice(-20);
  for (const particle of scene.particles) {
    particle.age += seconds;
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vx *= Math.pow(0.06, seconds);
    particle.vy = particle.vy * Math.pow(0.1, seconds) + 18 * seconds;
  }
  scene.particles = scene.particles.filter((particle) => particle.age < particle.life).slice(-900);
  for (const floater of scene.floaters) {
    floater.age += seconds;
    floater.y -= seconds * 42;
  }
  scene.floaters = scene.floaters.filter((floater) => floater.age < 0.85).slice(-12);
}

function asteroidPath(context, asteroid, radius) {
  context.beginPath();
  asteroid.points.forEach((point, index) => {
    const x = Math.cos(point.angle) * radius * point.radius;
    const y = Math.sin(point.angle) * radius * point.radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

function drawAsteroid(context, asteroid, at) {
  context.save();
  context.translate(at.x, at.y);
  context.rotate(asteroid.rotation);
  context.shadowColor = "rgba(255, 105, 70, .8)";
  context.shadowBlur = at.radius * 0.48;
  const gradient = context.createRadialGradient(-at.radius * 0.3, -at.radius * 0.36, 1, 0, 0, at.radius * 1.15);
  gradient.addColorStop(0, "#d7c1ae");
  gradient.addColorStop(0.28, "#79675e");
  gradient.addColorStop(0.72, "#342f38");
  gradient.addColorStop(1, "#151520");
  asteroidPath(context, asteroid, at.radius);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = "rgba(255, 174, 115, .45)";
  context.lineWidth = Math.max(1, at.radius * 0.035);
  context.stroke();
  context.shadowBlur = 0;
  for (const crater of asteroid.craters) {
    const x = Math.cos(crater.angle) * at.radius * crater.distance;
    const y = Math.sin(crater.angle) * at.radius * crater.distance;
    context.beginPath();
    context.arc(x, y, at.radius * crater.size, 0, TAU);
    context.fillStyle = "rgba(20, 18, 27, .58)";
    context.fill();
    context.strokeStyle = "rgba(235, 195, 160, .14)";
    context.stroke();
  }
  context.restore();
}

function drawScene(canvas, scene) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const shakeX = scene.shake ? random(-scene.shake, scene.shake) : 0;
  const shakeY = scene.shake ? random(-scene.shake, scene.shake) : 0;
  context.save();
  context.translate(shakeX, shakeY);

  const backdrop = context.createRadialGradient(width * 0.5, height * 0.17, 0, width * 0.5, height * 0.17, Math.max(width, height) * 0.82);
  backdrop.addColorStop(0, "rgba(32, 34, 89, .3)");
  backdrop.addColorStop(0.38, "rgba(7, 14, 38, .67)");
  backdrop.addColorStop(1, "rgba(2, 4, 16, .94)");
  context.fillStyle = backdrop;
  context.fillRect(-20, -20, width + 40, height + 40);

  const centerX = width * 0.5;
  const centerY = height * 0.16;
  for (const star of scene.stars) {
    const distance = Math.pow(star.distance, 1.8);
    const length = 2 + distance * 25;
    const x = centerX + Math.cos(star.angle) * distance * width * 0.74;
    const y = centerY + Math.sin(star.angle) * distance * height * 0.9;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(star.angle) * length, y + Math.sin(star.angle) * length);
    context.strokeStyle = `rgba(166, 225, 255, ${0.18 + distance * 0.72})`;
    context.lineWidth = star.size * (0.6 + distance);
    context.stroke();
  }

  const horizon = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * 0.23);
  horizon.addColorStop(0, "rgba(148, 112, 255, .2)");
  horizon.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = horizon;
  context.fillRect(0, 0, width, height * 0.55);

  [...scene.asteroids]
    .sort((a, b) => a.depth - b.depth)
    .forEach((asteroid) => drawAsteroid(context, asteroid, projected(asteroid, width, height)));

  context.globalCompositeOperation = "lighter";
  for (const beam of scene.beams) {
    const alpha = 1 - beam.age / 0.16;
    context.beginPath();
    context.moveTo(beam.x1, beam.y1);
    context.lineTo(beam.x2, beam.y2);
    context.strokeStyle = beam.color;
    context.globalAlpha = alpha * 0.22;
    context.lineWidth = 16 * alpha;
    context.stroke();
    context.globalAlpha = 1;
    context.beginPath();
    context.moveTo(beam.x1, beam.y1);
    context.lineTo(beam.x2, beam.y2);
    context.strokeStyle = beam.hit ? `rgba(255, 255, 255, ${alpha})` : beam.color;
    context.globalAlpha = beam.hit ? 1 : alpha;
    context.lineWidth = 2.4 + alpha * 2;
    context.stroke();
    context.globalAlpha = 1;
  }
  for (const ring of scene.rings) {
    context.beginPath();
    context.arc(ring.x, ring.y, ring.radius, 0, TAU);
    context.strokeStyle = ring.color.replace(")", `, ${1 - ring.age / 0.6})`).replace("rgbargba", "rgba");
    context.globalAlpha = 1 - ring.age / 0.6;
    context.lineWidth = 4 * (1 - ring.age / 0.6);
    context.stroke();
  }
  context.globalAlpha = 1;
  for (const particle of scene.particles) {
    const alpha = 1 - particle.age / particle.life;
    context.beginPath();
    context.moveTo(particle.x, particle.y);
    context.lineTo(particle.x - (particle.streak ? particle.vx * 0.035 : 0), particle.y - (particle.streak ? particle.vy * 0.035 : 0));
    context.strokeStyle = particle.color;
    context.globalAlpha = alpha;
    context.lineWidth = particle.size * alpha;
    context.stroke();
  }
  context.globalAlpha = 1;

  for (const floater of scene.floaters) {
    context.globalAlpha = 1 - floater.age / 0.85;
    context.fillStyle = floater.color;
    context.font = "900 18px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(floater.text, floater.x, floater.y);
  }
  context.globalAlpha = 1;

  for (const aim of scene.aims.filter((candidate) => candidate.active)) {
    const startX = aim.ox * width;
    const startY = aim.oy * height;
    const end = rayExit(aim, width, height);
    const pulse = 0.65 + Math.sin(scene.time * 18) * 0.22;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(end.x, end.y);
    context.setLineDash([3, 13]);
    context.lineDashOffset = -scene.time * 90;
    context.strokeStyle = aim.color;
    context.globalAlpha = 0.24 * pulse;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;
    context.setLineDash([]);
    context.beginPath();
    context.arc(startX, startY, 11 + pulse * 4, 0, TAU);
    context.strokeStyle = aim.color;
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.moveTo(startX - 19, startY);
    context.lineTo(startX + 19, startY);
    context.moveTo(startX, startY - 19);
    context.lineTo(startX, startY + 19);
    context.strokeStyle = aim.color;
    context.globalAlpha = 0.66;
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = aim.color;
    context.font = "900 11px ui-monospace, monospace";
    context.textAlign = "left";
    context.fillText(`P${aim.id + 1}`, startX + 15, startY - 15);
  }
  context.globalCompositeOperation = "source-over";
  context.restore();

  if (scene.flash > 0) {
    context.fillStyle = `rgba(129, 238, 255, ${scene.flash * 0.075})`;
    context.fillRect(0, 0, width, height);
  }
  const vignette = context.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.22, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,12,.66)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
  return { width, height };
}

export default function AsteroidFingerGuns({ inputRef, paused }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  if (sceneRef.current === null) sceneRef.current = createScene();
  const hudClock = useRef(0);
  const [hud, setHud] = useState({ score: 0, scores: [0, 0, 0, 0], combo: 1, shields: 3, wave: 1, players: 0, camera: false, gameOver: false });

  useDemoFrame((seconds) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = sceneRef.current;
    const input = inputRef.current;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    stepScene(scene, input, seconds, width, height);
    drawScene(canvas, scene);
    hudClock.current += seconds;
    if (hudClock.current >= 0.1) {
      hudClock.current = 0;
      const activeAims = scene.aims.filter((aim) => aim.active);
      setHud({ score: scene.score, scores: [...scene.playerScores], combo: scene.combo, shields: scene.shields, wave: scene.wave, players: activeAims.length, camera: activeAims.some((aim) => aim.camera), gameOver: scene.gameOver });
    }
  }, paused);

  const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.1em", textShadow: "0 2px 14px #000" };
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", color: "#ecfdff", pointerEvents: "none", userSelect: "none" }}>
      <canvas ref={canvasRef} aria-label="A forward-flying asteroid game controlled by the angle of your index finger" style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", top: "clamp(100px, 14vh, 136px)", left: 20, right: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", ...mono }}>
        <div style={{ display: "flex", gap: "clamp(14px, 3vw, 34px)", padding: "10px 14px", border: "1px solid rgba(101, 236, 255, .35)", borderRadius: 10, background: "rgba(4, 9, 30, .62)", backdropFilter: "blur(8px)" }}>
          {hud.scores.map((score, index) => (
            <span key={PLAYER_COLORS[index]} style={{ opacity: index < hud.players || score > 0 ? 1 : 0.38 }}>
              <small style={{ display: "block", color: PLAYER_COLORS[index], fontSize: 9 }}>P{index + 1} SCORE</small>
              <strong style={{ color: PLAYER_COLORS[index], fontSize: "clamp(15px, 2.2vw, 23px)" }}>{score.toString().padStart(5, "0")}</strong>
            </span>
          ))}
          <span><small style={{ display: "block", color: "#77eaff", fontSize: 9 }}>CHAIN</small><strong style={{ fontSize: "clamp(18px, 3vw, 27px)", color: hud.combo > 2 ? "#ffe07b" : "#dffcff" }}>×{hud.combo}</strong></span>
          <span><small style={{ display: "block", color: "#77eaff", fontSize: 9 }}>WAVE</small><strong style={{ fontSize: "clamp(18px, 3vw, 27px)" }}>{hud.wave}</strong></span>
          <span><small style={{ display: "block", color: "#77eaff", fontSize: 9 }}>PLAYERS</small><strong style={{ fontSize: "clamp(18px, 3vw, 27px)", color: PLAYER_COLORS[Math.max(0, hud.players - 1)] }}>{hud.players}/4</strong></span>
        </div>
        <div style={{ padding: "10px 14px", border: "1px solid rgba(255, 108, 115, .38)", borderRadius: 10, background: "rgba(4, 9, 30, .62)", textAlign: "right", backdropFilter: "blur(8px)" }}>
          <small style={{ display: "block", color: "#ff9b9f", fontSize: 9 }}>HULL</small>
          <strong style={{ color: hud.shields <= 1 ? "#ff5b72" : "#79f4ff", fontSize: 24 }}>{"◆".repeat(Math.max(0, hud.shields))}{"◇".repeat(Math.max(0, 3 - hud.shields))}</strong>
        </div>
      </div>
      <div style={{ position: "absolute", top: "clamp(176px, 25vh, 220px)", left: "50%", transform: "translateX(-50%)", padding: "6px 11px", borderRadius: 4, color: hud.players ? "#a8f8ff" : "#ffca85", background: "rgba(3, 8, 26, .58)", whiteSpace: "nowrap", fontSize: "clamp(9px, 1.4vw, 12px)", fontWeight: 800, ...mono }}>
        {hud.players ? (hud.camera ? `${hud.players} FINGER${hud.players === 1 ? "" : "S"} LOCKED · AUTOFIRE` : "POINTER VECTOR LOCKED · AUTOFIRE") : "SHOW UP TO FOUR INDEX FINGERS TO ARM"}
      </div>
      {hud.gameOver && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 10, textAlign: "center", background: "rgba(2, 4, 18, .76)", backdropFilter: "blur(3px)", ...mono }}>
          <strong style={{ fontSize: "clamp(34px, 7vw, 76px)", color: "#ff8b72" }}>HULL BREACH</strong>
          <span style={{ color: "#b9f8ff", fontWeight: 800 }}>SCORE {hud.score} · USE RESTART FOR ANOTHER RUN</span>
        </div>
      )}
    </div>
  );
}
