import { useEffect, useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "body-blasters",
  title: "Body Blasters",
  kind: "GAME",
  order: 3,
  icon: "🕺",
  description: "Four color-coded bodies aim laser turrets against an asteroid rain.",
  instructions: "Stand in view and point either arm. Your matching turret autofires with gentle aim assist.",
};

const VISION_MODULE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
const VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const PLAYER_COLORS = ["#55eaff", "#ff70c7", "#ffe15b", "#89ff73"];
const TAU = Math.PI * 2;
const LOST_SECONDS = 0.7;
const BODY_CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const BODY_JOINTS = new Set(BODY_CONNECTIONS.flat());

let visionPromise;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const random = (low, high) => low + Math.random() * (high - low);
const visible = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= 0.35;

async function loadVision() {
  if (!visionPromise) visionPromise = import(/* @vite-ignore */ VISION_MODULE);
  return visionPromise;
}

async function createPoseLandmarker() {
  const { FilesetResolver, PoseLandmarker } = await loadVision();
  const fileset = await FilesetResolver.forVisionTasks(VISION_WASM);
  const options = {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 4,
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
    outputSegmentationMasks: false,
  };
  try {
    return await PoseLandmarker.createFromOptions(fileset, options);
  } catch {
    return PoseLandmarker.createFromOptions(fileset, { ...options, baseOptions: { modelAssetPath: POSE_MODEL } });
  }
}

function displayLandmarks(landmarks, video, width, height) {
  const videoWidth = Math.max(1, video.videoWidth);
  const videoHeight = Math.max(1, video.videoHeight);
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const drawnWidth = videoWidth * scale;
  const drawnHeight = videoHeight * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  return landmarks.map((point) => ({
    ...point,
    x: width - offsetX - point.x * drawnWidth,
    y: offsetY + point.y * drawnHeight,
  }));
}

function readPose(landmarks) {
  if (!landmarks?.length) return null;
  const shoulders = [landmarks[11], landmarks[12]];
  const hips = [landmarks[23], landmarks[24]];
  if (![...shoulders, ...hips].every(visible)) return null;
  const bodyX = (shoulders[0].x + shoulders[1].x + hips[0].x + hips[1].x) / 4;
  const arms = [
    { shoulder: landmarks[11], elbow: landmarks[13], wrist: landmarks[15] },
    { shoulder: landmarks[12], elbow: landmarks[14], wrist: landmarks[16] },
  ].filter((arm) => visible(arm.shoulder) && visible(arm.elbow) && visible(arm.wrist));
  if (!arms.length) return null;
  const arm = arms.sort((left, right) => {
    const leftReach = Math.hypot(left.wrist.x - left.shoulder.x, left.wrist.y - left.shoulder.y) - Math.max(0, left.wrist.y - left.shoulder.y) * 0.35;
    const rightReach = Math.hypot(right.wrist.x - right.shoulder.x, right.wrist.y - right.shoulder.y) - Math.max(0, right.wrist.y - right.shoulder.y) * 0.35;
    return rightReach - leftReach;
  })[0];
  const dx = arm.wrist.x - arm.shoulder.x;
  const dy = arm.wrist.y - arm.shoulder.y;
  const reach = Math.hypot(dx, dy);
  if (reach < 35) return null;
  const horizontalIntent = clamp(dx / (Math.abs(dx) + Math.max(28, -dy)), -1, 1);
  const angle = -Math.PI / 2 + horizontalIntent * 1.18;
  return { bodyX, dx: Math.cos(angle), dy: Math.sin(angle), landmarks };
}

function createPlayer(id) {
  return {
    id,
    color: PLAYER_COLORS[id],
    active: false,
    missingFor: LOST_SECONDS,
    bodyX: (id + 1) / 5,
    dx: 0,
    dy: -1,
    fireClock: id * 0.035,
    score: 0,
    landmarks: [],
  };
}

function makeAsteroid(id, level) {
  const radius = random(18, 34) * Math.min(1.35, 1 + level * 0.025);
  return {
    id,
    x: random(0.06, 0.94),
    y: random(-0.18, -0.06),
    vx: random(-0.025, 0.025),
    vy: random(0.085, 0.14) * Math.min(1.65, 1 + level * 0.05),
    radius,
    spin: random(-1.2, 1.2),
    rotation: Math.random() * TAU,
    hp: radius > 33 ? 2 : 1,
    points: Array.from({ length: 9 }, (_, index) => ({ angle: index / 9 * TAU, radius: random(0.78, 1.16) })),
    craters: Array.from({ length: 3 }, () => ({ angle: Math.random() * TAU, distance: random(0.15, 0.58), size: random(0.09, 0.2) })),
  };
}

function createScene() {
  return {
    time: 0,
    total: 0,
    shields: 5,
    level: 1,
    nextId: 1,
    spawnClock: 0.4,
    started: false,
    gameOver: false,
    flash: 0,
    shake: 0,
    players: PLAYER_COLORS.map((_, index) => createPlayer(index)),
    asteroids: [],
    beams: [],
    particles: [],
    rings: [],
  };
}

function assignPoses(scene, poses, seconds, width) {
  const candidates = poses.map(readPose).filter(Boolean).sort((a, b) => a.bodyX - b.bodyX);
  const next = scene.players.map((player) => ({ ...player, missingFor: player.missingFor + seconds }));
  const available = new Set(scene.players.map((_, index) => index));
  for (const candidate of candidates) {
    let best = null;
    let bestCost = Infinity;
    for (const index of available) {
      const player = scene.players[index];
      const cost = Math.abs(candidate.bodyX / width - player.bodyX) + (player.active ? 0 : 0.07);
      if (cost < bestCost) {
        best = index;
        bestCost = cost;
      }
    }
    if (best === null) continue;
    available.delete(best);
    const previous = scene.players[best];
    const blend = previous.active ? 0.16 : 1;
    let dx = previous.dx + (candidate.dx - previous.dx) * blend;
    let dy = previous.dy + (candidate.dy - previous.dy) * blend;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    next[best] = {
      ...previous,
      active: true,
      missingFor: 0,
      bodyX: candidate.bodyX / width,
      dx,
      dy,
      landmarks: candidate.landmarks,
    };
  }
  scene.players = next.map((player, index) => available.has(index)
    ? { ...player, active: scene.players[index].active && player.missingFor < LOST_SECONDS }
    : player);
}

function updatePointerPlayer(scene, input) {
  const player = scene.players[0];
  const originX = 0.14;
  const originY = 0.91;
  let dx = input.x - originX;
  let dy = input.y - originY;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  scene.players = scene.players.map((entry, index) => index === 0 ? {
    ...entry,
    active: input.active,
    missingFor: 0,
    bodyX: originX,
    dx: entry.dx + (dx - entry.dx) * 0.25,
    dy: entry.dy + (dy - entry.dy) * 0.25,
    landmarks: [],
  } : { ...entry, active: false, landmarks: [] });
}

function burst(scene, x, y, color, size = 1) {
  scene.rings.push({ x, y, color, age: 0, radius: 4, speed: 115 * size });
  scene.shake = Math.max(scene.shake, 5 * size);
  scene.flash = Math.max(scene.flash, 0.42);
  const count = Math.round(16 + size * 14);
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * TAU;
    const speed = random(65, 230) * size;
    scene.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: random(0.3, 0.8),
      color: Math.random() > 0.42 ? color : "#ffb65f",
      size: random(1.5, 4.8),
    });
  }
}

function assistedDirection(player, scene, width, height) {
  const originX = (0.14 + player.id * 0.24) * width;
  const originY = height * 0.91;
  let best = null;
  let bestScore = Infinity;
  for (const asteroid of scene.asteroids) {
    const targetX = asteroid.x * width - originX;
    const targetY = asteroid.y * height - originY;
    const length = Math.hypot(targetX, targetY) || 1;
    const tx = targetX / length;
    const ty = targetY / length;
    const angleError = Math.acos(clamp(tx * player.dx + ty * player.dy, -1, 1));
    const score = angleError + length / Math.max(width, height) * 0.035;
    if (angleError < 0.24 && score < bestScore) {
      best = { dx: tx, dy: ty };
      bestScore = score;
    }
  }
  if (!best) return { dx: player.dx, dy: player.dy };
  const assist = 0.34;
  const dx = player.dx * (1 - assist) + best.dx * assist;
  const dy = player.dy * (1 - assist) + best.dy * assist;
  const length = Math.hypot(dx, dy) || 1;
  return { dx: dx / length, dy: dy / length };
}

function fire(scene, player, width, height) {
  const originX = (0.14 + player.id * 0.24) * width;
  const originY = height * 0.91;
  const direction = assistedDirection(player, scene, width, height);
  let target = null;
  let nearest = Infinity;
  for (const asteroid of scene.asteroids) {
    const relX = asteroid.x * width - originX;
    const relY = asteroid.y * height - originY;
    const along = relX * direction.dx + relY * direction.dy;
    const across = Math.abs(relX * direction.dy - relY * direction.dx);
    if (along > 0 && across < asteroid.radius + 19 && along < nearest) {
      target = asteroid;
      nearest = along;
    }
  }
  const distance = target ? nearest : Math.max(width, height) * 1.45;
  const hitX = originX + direction.dx * distance;
  const hitY = originY + direction.dy * distance;
  scene.beams.push({ x1: originX, y1: originY, x2: hitX, y2: hitY, color: player.color, age: 0, hit: Boolean(target) });
  if (!target) return;
  target.hp -= 1;
  burst(scene, hitX, hitY, player.color, 0.55);
  if (target.hp > 0) return;
  scene.asteroids = scene.asteroids.filter((asteroid) => asteroid !== target);
  const points = 100 + scene.level * 10;
  player.score += points;
  scene.total += points;
  burst(scene, hitX, hitY, player.color, 1.15);
}

function stepScene(scene, input, poses, seconds, width, height) {
  scene.time += seconds;
  scene.flash = Math.max(0, scene.flash - seconds * 3);
  scene.shake = Math.max(0, scene.shake - seconds * 18);
  if (input.source === "camera") assignPoses(scene, poses, seconds, width);
  else updatePointerPlayer(scene, input);
  const activePlayers = scene.players.filter((player) => player.active);
  if (activePlayers.length) scene.started = true;
  if (!scene.started || scene.gameOver) return;

  scene.spawnClock -= seconds;
  const limit = 15 + activePlayers.length * 6;
  if (scene.spawnClock <= 0 && scene.asteroids.length < limit) {
    scene.asteroids.push(makeAsteroid(scene.nextId++, scene.level));
    scene.spawnClock = random(0.22, 0.48) / (1 + Math.max(0, activePlayers.length - 1) * 0.3);
  }
  for (const asteroid of scene.asteroids) {
    asteroid.x += asteroid.vx * seconds;
    asteroid.y += asteroid.vy * seconds;
    asteroid.rotation += asteroid.spin * seconds;
    if (asteroid.x < 0.04 || asteroid.x > 0.96) asteroid.vx *= -1;
  }
  const escaped = scene.asteroids.filter((asteroid) => asteroid.y > 1.04);
  for (const asteroid of escaped) {
    burst(scene, asteroid.x * width, height * 0.95, "#ff536f", 1.25);
    scene.shields -= 1;
  }
  if (escaped.length) scene.asteroids = scene.asteroids.filter((asteroid) => asteroid.y <= 1.04);
  if (scene.shields <= 0) scene.gameOver = true;
  scene.level = 1 + Math.floor(scene.total / 1600);

  for (const player of scene.players) {
    player.fireClock -= seconds;
    if (player.active && player.fireClock <= 0) {
      fire(scene, player, width, height);
      player.fireClock = 0.145;
    }
  }
  for (const beam of scene.beams) beam.age += seconds;
  scene.beams = scene.beams.filter((beam) => beam.age < 0.14).slice(-36);
  for (const ring of scene.rings) {
    ring.age += seconds;
    ring.radius += ring.speed * seconds;
  }
  scene.rings = scene.rings.filter((ring) => ring.age < 0.55).slice(-28);
  for (const particle of scene.particles) {
    particle.age += seconds;
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vx *= Math.pow(0.12, seconds);
    particle.vy = particle.vy * Math.pow(0.12, seconds) + 22 * seconds;
  }
  scene.particles = scene.particles.filter((particle) => particle.age < particle.life).slice(-800);
}

function drawAsteroid(context, asteroid, width, height) {
  const x = asteroid.x * width;
  const y = asteroid.y * height;
  const radius = asteroid.radius * (0.7 + clamp(asteroid.y, 0, 1) * 0.45);
  context.save();
  context.translate(x, y);
  context.rotate(asteroid.rotation);
  context.shadowColor = "rgba(255, 113, 76, .8)";
  context.shadowBlur = radius * 0.45;
  const gradient = context.createRadialGradient(-radius * 0.32, -radius * 0.32, 1, 0, 0, radius);
  gradient.addColorStop(0, "#d4b99f");
  gradient.addColorStop(0.35, "#725f59");
  gradient.addColorStop(1, "#201f2b");
  context.beginPath();
  asteroid.points.forEach((point, index) => {
    const px = Math.cos(point.angle) * radius * point.radius;
    const py = Math.sin(point.angle) * radius * point.radius;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = "rgba(255, 178, 116, .5)";
  context.lineWidth = 1.5;
  context.stroke();
  context.shadowBlur = 0;
  for (const crater of asteroid.craters) {
    context.beginPath();
    context.arc(Math.cos(crater.angle) * radius * crater.distance, Math.sin(crater.angle) * radius * crater.distance, radius * crater.size, 0, TAU);
    context.fillStyle = "rgba(20, 18, 28, .58)";
    context.fill();
  }
  context.restore();
}

function drawBody(context, player) {
  if (!player.landmarks.length) return;
  context.save();
  context.globalAlpha = clamp(1 - player.missingFor / LOST_SECONDS, 0.18, 0.9);
  context.shadowColor = player.color;
  context.shadowBlur = 12;
  context.strokeStyle = player.color;
  context.lineWidth = 4;
  context.lineCap = "round";
  for (const [from, to] of BODY_CONNECTIONS) {
    const start = player.landmarks[from];
    const end = player.landmarks[to];
    if (!visible(start) || !visible(end)) continue;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  for (const index of BODY_JOINTS) {
    const point = player.landmarks[index];
    if (!visible(point)) continue;
    context.beginPath();
    context.arc(point.x, point.y, index === 15 || index === 16 ? 8 : 5, 0, TAU);
    context.fillStyle = player.color;
    context.fill();
  }
  const head = player.landmarks[0];
  if (visible(head)) {
    context.shadowBlur = 5;
    context.font = "900 14px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(`P${player.id + 1}`, head.x, head.y - 24);
  }
  context.restore();
}

function drawTurret(context, player, width, height) {
  const x = (0.14 + player.id * 0.24) * width;
  const y = height * 0.91;
  const direction = assistedDirection(player, { asteroids: [] }, width, height);
  context.save();
  context.globalAlpha = player.active ? 1 : 0.3;
  context.translate(x, y);
  context.shadowColor = player.color;
  context.shadowBlur = player.active ? 20 : 5;
  context.strokeStyle = player.color;
  context.lineWidth = 11;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(direction.dx * 48, direction.dy * 48);
  context.stroke();
  context.fillStyle = "#10182b";
  context.strokeStyle = player.color;
  context.lineWidth = 4;
  context.beginPath();
  context.arc(0, 0, 22, Math.PI, 0);
  context.closePath();
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = player.color;
  context.font = "900 12px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText(`P${player.id + 1}`, 0, 17);
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
  const shade = context.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "rgba(3, 7, 24, .72)");
  shade.addColorStop(0.5, "rgba(4, 8, 25, .42)");
  shade.addColorStop(1, "rgba(2, 4, 16, .82)");
  context.fillStyle = shade;
  context.fillRect(-20, -20, width + 40, height + 40);

  for (let index = 0; index < 80; index += 1) {
    const x = (Math.sin(index * 91.7) * 0.5 + 0.5) * width;
    const y = ((index * 0.137 + scene.time * (0.02 + index % 5 * 0.004)) % 1) * height;
    context.fillStyle = `rgba(187, 226, 255, ${0.18 + index % 4 * 0.12})`;
    context.fillRect(x, y, 1 + index % 2, 4 + index % 7);
  }
  for (const player of scene.players) drawBody(context, player);
  for (const asteroid of scene.asteroids) {
    context.beginPath();
    context.moveTo(asteroid.x * width, asteroid.y * height - asteroid.radius * 2.2);
    context.lineTo(asteroid.x * width, asteroid.y * height - asteroid.radius * 0.7);
    context.strokeStyle = "rgba(255, 111, 70, .26)";
    context.lineWidth = asteroid.radius * 0.55;
    context.stroke();
    drawAsteroid(context, asteroid, width, height);
  }
  context.globalCompositeOperation = "lighter";
  for (const beam of scene.beams) {
    const alpha = 1 - beam.age / 0.14;
    context.globalAlpha = alpha * 0.25;
    context.strokeStyle = beam.color;
    context.lineWidth = 18 * alpha;
    context.beginPath();
    context.moveTo(beam.x1, beam.y1);
    context.lineTo(beam.x2, beam.y2);
    context.stroke();
    context.globalAlpha = alpha;
    context.lineWidth = 3.5;
    context.stroke();
  }
  context.globalAlpha = 1;
  for (const ring of scene.rings) {
    context.globalAlpha = 1 - ring.age / 0.55;
    context.strokeStyle = ring.color;
    context.lineWidth = 4;
    context.beginPath();
    context.arc(ring.x, ring.y, ring.radius, 0, TAU);
    context.stroke();
  }
  for (const particle of scene.particles) {
    context.globalAlpha = 1 - particle.age / particle.life;
    context.strokeStyle = particle.color;
    context.lineWidth = particle.size;
    context.beginPath();
    context.moveTo(particle.x, particle.y);
    context.lineTo(particle.x - particle.vx * 0.035, particle.y - particle.vy * 0.035);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  for (const player of scene.players) drawTurret(context, player, width, height);
  context.restore();
  if (scene.flash > 0) {
    context.fillStyle = `rgba(155, 238, 255, ${scene.flash * 0.08})`;
    context.fillRect(0, 0, width, height);
  }
}

export default function BodyBlasters({ inputRef, videoRef, paused }) {
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectionRef = useRef(0);
  const posesRef = useRef([]);
  const sceneRef = useRef(null);
  if (sceneRef.current === null) sceneRef.current = createScene();
  const hudClock = useRef(0);
  const [modelStatus, setModelStatus] = useState("Loading four-player pose model…");
  const [hud, setHud] = useState({ scores: [0, 0, 0, 0], players: 0, shields: 5, level: 1, started: false, gameOver: false });

  useEffect(() => {
    let active = true;
    let landmarker;
    void createPoseLandmarker().then((created) => {
      if (!active) {
        created.close();
        return;
      }
      landmarker = created;
      landmarkerRef.current = created;
      setModelStatus("Step back so your full bodies are visible");
    }).catch((error) => {
      if (active) setModelStatus(`Pose model unavailable: ${error?.message ?? "unknown error"}`);
    });
    return () => {
      active = false;
      landmarkerRef.current = null;
      posesRef.current = [];
      landmarker?.close();
    };
  }, []);

  useDemoFrame((seconds, now) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const input = inputRef.current;
    if (!canvas) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);

    if (input.source === "camera" && landmarkerRef.current && video?.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current && now - lastDetectionRef.current >= 85) {
      lastVideoTimeRef.current = video.currentTime;
      lastDetectionRef.current = now;
      try {
        const result = landmarkerRef.current.detectForVideo(video, now);
        posesRef.current = (result.landmarks ?? []).slice(0, 4).map((pose) => displayLandmarks(pose, video, width, height));
        setModelStatus(posesRef.current.length ? `${posesRef.current.length}/4 bodies tracked` : "Step back so your full bodies are visible");
      } catch (error) {
        setModelStatus(`Pose tracking paused: ${error?.message ?? "unknown error"}`);
      }
    }

    const scene = sceneRef.current;
    stepScene(scene, input, posesRef.current, seconds, width, height);
    drawScene(canvas, scene);
    hudClock.current += seconds;
    if (hudClock.current >= 0.1) {
      hudClock.current = 0;
      setHud({
        scores: scene.players.map((player) => player.score),
        players: scene.players.filter((player) => player.active).length,
        shields: scene.shields,
        level: scene.level,
        started: scene.started,
        gameOver: scene.gameOver,
      });
    }
  }, paused);

  const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: ".09em", textShadow: "0 2px 10px #000" };
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", color: "white", pointerEvents: "none", userSelect: "none" }}>
      <canvas ref={canvasRef} aria-label="Four-player full-body asteroid defense game" style={{ display: "block", width: "100%", height: "100%" }} />
      <div style={{ position: "absolute", top: "clamp(100px, 14vh, 136px)", left: 20, right: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", ...mono }}>
        <div style={{ display: "flex", gap: "clamp(12px, 2.4vw, 26px)", padding: "9px 13px", border: "1px solid rgba(127,235,255,.38)", borderRadius: 10, background: "rgba(3,7,23,.72)", backdropFilter: "blur(7px)" }}>
          {hud.scores.map((score, index) => (
            <span key={PLAYER_COLORS[index]} style={{ opacity: index < hud.players || score ? 1 : 0.38 }}>
              <small style={{ display: "block", color: PLAYER_COLORS[index], fontSize: 9 }}>P{index + 1}</small>
              <strong style={{ color: PLAYER_COLORS[index], fontSize: "clamp(14px, 2.1vw, 22px)" }}>{score.toString().padStart(5, "0")}</strong>
            </span>
          ))}
          <span><small style={{ display: "block", color: "#8defff", fontSize: 9 }}>LEVEL</small><strong style={{ fontSize: 22 }}>{hud.level}</strong></span>
        </div>
        <div style={{ padding: "9px 13px", border: "1px solid rgba(255,112,126,.38)", borderRadius: 10, background: "rgba(3,7,23,.72)", textAlign: "right", ...mono }}>
          <small style={{ display: "block", color: "#ff9da5", fontSize: 9 }}>SHIELD</small>
          <strong style={{ color: hud.shields <= 2 ? "#ff6077" : "#76f4ff", fontSize: 21 }}>{"◆".repeat(Math.max(0, hud.shields))}{"◇".repeat(Math.max(0, 5 - hud.shields))}</strong>
        </div>
      </div>
      <div style={{ position: "absolute", top: "clamp(174px, 24vh, 216px)", left: "50%", transform: "translateX(-50%)", padding: "6px 11px", borderRadius: 5, color: hud.players ? "#bafaff" : "#ffcf8a", background: "rgba(3,7,23,.68)", whiteSpace: "nowrap", fontSize: "clamp(9px, 1.35vw, 12px)", fontWeight: 850, ...mono }}>
        {inputRef.current.source === "camera" ? modelStatus : "POINTER AIM · P1 AUTOFIRE"}
      </div>
      {!hud.started && <div style={{ position: "absolute", left: "50%", bottom: "11%", transform: "translateX(-50%)", padding: "10px 16px", borderRadius: 999, color: "#eafcff", background: "rgba(3,7,23,.76)", fontSize: "clamp(11px, 1.8vw, 16px)", fontWeight: 900, textAlign: "center", ...mono }}>STEP BACK · POINT AN ARM TO JOIN</div>}
      {hud.gameOver && <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 10, textAlign: "center", background: "rgba(3,5,18,.78)", ...mono }}><strong style={{ color: "#ff7a75", fontSize: "clamp(36px, 7vw, 76px)" }}>DEFENSE DOWN</strong><span style={{ color: "#b9f8ff", fontWeight: 850 }}>USE RESTART TO RECHARGE</span></div>}
    </div>
  );
}
