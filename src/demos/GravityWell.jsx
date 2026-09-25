import { useEffect, useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "gravity-well",
  title: "Gravity Well",
  kind: "VISUAL",
  order: 4,
  icon: "🪐",
  description: "Hold still to pull a field of stars into a glowing spiral.",
  instructions: "Hold a fingertip or pointer still to strengthen the pull. Move to place a new well.",
};

const PARTICLE_COUNT = 240;
const COLORS = ["#79e8ff", "#c2b7ff", "#ffd991", "#8fffc8"];
const BACKGROUND = "#040a1b";
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function newParticle(width, height, fromEdge = false) {
  let x = Math.random() * width;
  let y = Math.random() * height;
  if (fromEdge) {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = -12; y = Math.random() * height; }
    if (side === 1) { x = width + 12; y = Math.random() * height; }
    if (side === 2) { x = Math.random() * width; y = -12; }
    if (side === 3) { x = Math.random() * width; y = height + 12; }
  }
  return {
    x, y,
    vx: (Math.random() - .5) * 28,
    vy: (Math.random() - .5) * 28,
    size: .8 + Math.random() * 1.6,
    opacity: .45 + Math.random() * .5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

function resizeScene(canvas, sceneRef) {
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const previous = sceneRef.current;
  if (previous && previous.width === width && previous.height === height && previous.dpr === dpr) return;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);

  if (previous) {
    const scaleX = width / previous.width;
    const scaleY = height / previous.height;
    previous.particles.forEach((particle) => {
      particle.x *= scaleX;
      particle.y *= scaleY;
      particle.vx *= scaleX;
      particle.vy *= scaleY;
    });
    previous.well.x *= scaleX;
    previous.well.y *= scaleY;
    if (previous.holdOrigin) {
      previous.holdOrigin.x *= scaleX;
      previous.holdOrigin.y *= scaleY;
    }
    Object.assign(previous, { context, width, height, dpr });
    return;
  }

  sceneRef.current = {
    context, width, height, dpr,
    particles: Array.from({ length: PARTICLE_COUNT }, () => newParticle(width, height)),
    well: { x: width / 2, y: height / 2 },
    holdOrigin: null,
    charge: 0,
    active: false,
    time: 0,
    hudTime: 0,
  };
}

function updateWell(scene, input, seconds) {
  scene.active = input.active;
  if (!input.active) {
    scene.holdOrigin = null;
    scene.charge = Math.max(0, scene.charge - seconds * 1.2);
    return;
  }

  const x = clamp(input.x, 0, 1) * scene.width;
  const y = clamp(input.y, 0, 1) * scene.height;
  if (!scene.holdOrigin) {
    scene.holdOrigin = { x, y };
    scene.well = { x, y };
  }

  const tolerance = Math.max(24, Math.min(scene.width, scene.height) * .045);
  if (Math.hypot(x - scene.holdOrigin.x, y - scene.holdOrigin.y) > tolerance) {
    scene.holdOrigin = { x, y };
    scene.charge = 0;
  } else {
    scene.charge = Math.min(1, scene.charge + seconds / 1.8);
  }
  const follow = Math.min(1, seconds * 12);
  scene.well.x += (x - scene.well.x) * follow;
  scene.well.y += (y - scene.well.y) * follow;
}

function drawWell(scene) {
  if (!scene.active && scene.charge <= 0) return;
  const { context, well, charge, time } = scene;
  const radius = 48 + charge * 95;
  const glow = context.createRadialGradient(well.x, well.y, 4, well.x, well.y, radius);
  glow.addColorStop(0, `rgba(255, 220, 145, ${.31 + charge * .4})`);
  glow.addColorStop(.35, `rgba(170, 112, 255, ${.12 + charge * .18})`);
  glow.addColorStop(1, "rgba(80, 130, 255, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(well.x, well.y, radius, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = 1;
  context.strokeStyle = `rgba(151, 198, 255, ${.13 + charge * .16})`;
  for (let ring = 0; ring < 3; ring += 1) {
    context.beginPath();
    context.arc(well.x, well.y, 55 + ring * 58 + charge * 24, 0, Math.PI * 2);
    context.stroke();
  }

  context.strokeStyle = "rgba(255, 234, 171, .24)";
  context.lineWidth = 5;
  context.beginPath();
  context.arc(well.x, well.y, 28, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "#ffd991";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.arc(well.x, well.y, 28, -Math.PI / 2 + time * .18, -Math.PI / 2 + time * .18 + charge * Math.PI * 2);
  context.stroke();

  context.fillStyle = BACKGROUND;
  context.beginPath();
  context.arc(well.x, well.y, 10 + charge * 7, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#e4faff";
  context.lineWidth = 1.5;
  context.stroke();
}

function drawFrame(scene, seconds) {
  const { context, width, height, particles, well, charge, active } = scene;
  const fade = clamp(1 - Math.exp(-seconds * 11), .08, .32);
  context.fillStyle = `rgba(4, 10, 27, ${fade})`;
  context.fillRect(0, 0, width, height);
  context.save();
  context.globalCompositeOperation = "lighter";

  const reach = Math.max(90, Math.min(width, height) * .25);
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    const oldX = particle.x;
    const oldY = particle.y;
    if (active) {
      const dx = well.x - particle.x;
      const dy = well.y - particle.y;
      const distance = Math.max(12, Math.hypot(dx, dy));
      const falloff = 1 / (1 + (distance / reach) ** 2);
      const pull = (35 + charge * 610) * falloff;
      const spin = pull * (.24 + charge * .48);
      particle.vx += (dx / distance * pull - dy / distance * spin) * seconds;
      particle.vy += (dy / distance * pull + dx / distance * spin) * seconds;
    }
    const drag = Math.exp(-(active ? .52 : .025) * seconds);
    particle.vx *= drag;
    particle.vy *= drag;
    const speed = Math.hypot(particle.vx, particle.vy);
    if (speed > 340) {
      particle.vx *= 340 / speed;
      particle.vy *= 340 / speed;
    }
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;

    const swallowed = active && Math.hypot(well.x - particle.x, well.y - particle.y) < 11 + charge * 7;
    const escaped = particle.x < -28 || particle.x > width + 28 || particle.y < -28 || particle.y > height + 28;
    if (swallowed || escaped) {
      particles[index] = newParticle(width, height, active);
      continue;
    }
    context.globalAlpha = particle.opacity;
    context.strokeStyle = particle.color;
    context.lineWidth = particle.size;
    context.beginPath();
    context.moveTo(oldX, oldY);
    context.lineTo(particle.x, particle.y);
    context.stroke();
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size * .65, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
  drawWell(scene);
}

export default function GravityWell({ inputRef, paused }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const hudRef = useRef({ active: false, percent: 0 });
  const [hud, setHud] = useState(hudRef.current);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const resize = () => resizeScene(canvas, sceneRef);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useDemoFrame((seconds) => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.time += seconds;
    updateWell(scene, inputRef.current, seconds);
    drawFrame(scene, seconds);
    scene.hudTime += seconds;
    if (scene.hudTime >= .1 || scene.active !== hudRef.current.active) {
      scene.hudTime = 0;
      const next = { active: scene.active, percent: Math.round(scene.charge * 100) };
      if (next.active !== hudRef.current.active || next.percent !== hudRef.current.percent) {
        hudRef.current = next;
        setHud(next);
      }
    }
  }, paused);

  const message = !hud.active ? "Show a hand or choose Pointer" : hud.percent >= 100 ? "Gravity at full strength" : "Hold steady to build gravity";
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: BACKGROUND }}>
      <canvas
        ref={canvasRef}
        aria-label="Particle field pulled into a gravity well where you hold your hand or pointer"
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      <div style={{ position: "absolute", top: "clamp(108px, 14vh, 136px)", left: 20, width: "min(290px, calc(100% - 40px))", padding: "13px 15px", color: "#f1f8ff", background: "rgba(4, 10, 27, .7)", border: "1px solid rgba(170, 210, 255, .25)", borderRadius: 12, backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", fontSize: 12, fontWeight: 800, letterSpacing: ".09em" }}>
          <span>GRAVITY WELL</span><span>{hud.percent}%</span>
        </div>
        <div role="progressbar" aria-label="Gravity strength" aria-valuemin="0" aria-valuemax="100" aria-valuenow={hud.percent} style={{ height: 7, margin: "9px 0 8px", background: "rgba(145, 181, 223, .25)", overflow: "hidden" }}>
          <div style={{ width: `${hud.percent}%`, height: "100%", background: "linear-gradient(90deg, #79e8ff, #ffd991)", transition: "width .1s linear" }} />
        </div>
        <div style={{ fontSize: 11, color: "#b8cadf" }}>{message}</div>
      </div>
    </div>
  );
}
