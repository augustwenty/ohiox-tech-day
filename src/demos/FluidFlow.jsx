import { useRef } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "fluid-flow",
  title: "Fluid Flow",
  kind: "VISUAL",
  order: 3,
  icon: "🌊",
  description: "Paint glowing currents and whirlpools with your hands.",
  instructions: "Move to stir the fluid. Pinch, press, or hold Space for a powerful vortex.",
};

const WIDTH = 192;
const HEIGHT = 120;
const SIZE = WIDTH * HEIGHT;
const PALETTE = [
  [0.18, 0.92, 1],
  [0.72, 0.3, 1],
  [1, 0.22, 0.58],
  [1, 0.72, 0.2],
  [0.22, 1, 0.62],
];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function sample(field, x, y) {
  const sx = clamp(x, 0, WIDTH - 1.001);
  const sy = clamp(y, 0, HEIGHT - 1.001);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(WIDTH - 1, x0 + 1);
  const y1 = Math.min(HEIGHT - 1, y0 + 1);
  const fx = sx - x0;
  const fy = sy - y0;
  const top = field[y0 * WIDTH + x0] * (1 - fx) + field[y0 * WIDTH + x1] * fx;
  const bottom = field[y1 * WIDTH + x0] * (1 - fx) + field[y1 * WIDTH + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function createSimulation(context) {
  const simulation = {
    context,
    image: context.createImageData(WIDTH, HEIGHT),
    u: new Float32Array(SIZE),
    v: new Float32Array(SIZE),
    red: new Float32Array(SIZE),
    green: new Float32Array(SIZE),
    blue: new Float32Array(SIZE),
    nextU: new Float32Array(SIZE),
    nextV: new Float32Array(SIZE),
    nextRed: new Float32Array(SIZE),
    nextGreen: new Float32Array(SIZE),
    nextBlue: new Float32Array(SIZE),
    previousPoints: new Map(),
    points: [],
    time: 0,
  };

  // A faint initial nebula makes the current visible before the first gesture.
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      const wave = 0.018 + 0.012 * (Math.sin(x * 0.11) + Math.cos(y * 0.14));
      simulation.red[index] = Math.max(0, wave * 0.4);
      simulation.green[index] = Math.max(0, wave * 0.8);
      simulation.blue[index] = Math.max(0, wave * 1.5);
    }
  }
  return simulation;
}

function addVortex(simulation, point, previous, seconds, color, boosted) {
  const cx = point.x * (WIDTH - 1);
  const cy = point.y * (HEIGHT - 1);
  const elapsed = Math.max(seconds, 1 / 60);
  const motionX = previous ? clamp((point.x - previous.x) * WIDTH / elapsed, -100, 100) : 0;
  const motionY = previous ? clamp((point.y - previous.y) * HEIGHT / elapsed, -100, 100) : 0;
  const speed = Math.hypot(motionX, motionY);
  const radius = boosted ? 17 : 11;
  const spin = (boosted ? 54 : 23) + Math.min(32, speed * 0.45);
  const minX = Math.max(1, Math.floor(cx - radius));
  const maxX = Math.min(WIDTH - 2, Math.ceil(cx + radius));
  const minY = Math.max(1, Math.floor(cy - radius));
  const maxY = Math.min(HEIGHT - 2, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const falloff = (1 - distance / radius) ** 2;
      const inverse = 1 / Math.max(2, distance);
      const index = y * WIDTH + x;
      simulation.u[index] += (motionX * 0.3 - dy * inverse * spin) * falloff;
      simulation.v[index] += (motionY * 0.3 + dx * inverse * spin) * falloff;
      const ink = falloff * (boosted ? 0.19 : 0.105);
      simulation.red[index] = Math.min(2.4, simulation.red[index] + color[0] * ink);
      simulation.green[index] = Math.min(2.4, simulation.green[index] + color[1] * ink);
      simulation.blue[index] = Math.min(2.4, simulation.blue[index] + color[2] * ink);
    }
  }
}

function advect(simulation, seconds) {
  const velocityDecay = Math.pow(0.986, seconds * 60);
  const colorDecay = Math.pow(0.997, seconds * 60);
  const { u, v, red, green, blue, nextU, nextV, nextRed, nextGreen, nextBlue } = simulation;

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      const backX = x - u[index] * seconds;
      const backY = y - v[index] * seconds;
      nextU[index] = sample(u, backX, backY) * velocityDecay;
      nextV[index] = sample(v, backX, backY) * velocityDecay;
      nextRed[index] = sample(red, backX, backY) * colorDecay;
      nextGreen[index] = sample(green, backX, backY) * colorDecay;
      nextBlue[index] = sample(blue, backX, backY) * colorDecay;
    }
  }

  simulation.u = nextU;
  simulation.v = nextV;
  simulation.red = nextRed;
  simulation.green = nextGreen;
  simulation.blue = nextBlue;
  simulation.nextU = u;
  simulation.nextV = v;
  simulation.nextRed = red;
  simulation.nextGreen = green;
  simulation.nextBlue = blue;
}

function render(simulation, active) {
  const pixels = simulation.image.data;
  for (let index = 0; index < SIZE; index += 1) {
    const offset = index * 4;
    const glow = Math.min(1, Math.hypot(simulation.u[index], simulation.v[index]) / 42);
    pixels[offset] = 3 + 252 * (1 - Math.exp(-simulation.red[index] * 1.6)) + glow * 10;
    pixels[offset + 1] = 7 + 248 * (1 - Math.exp(-simulation.green[index] * 1.6)) + glow * 15;
    pixels[offset + 2] = 17 + 238 * (1 - Math.exp(-simulation.blue[index] * 1.45)) + glow * 28;
    pixels[offset + 3] = 242;
  }
  simulation.context.putImageData(simulation.image, 0, 0);

  // Rings make every camera fingertip (or the pointer) visibly part of the flow.
  if (active) {
    simulation.context.save();
    simulation.context.globalCompositeOperation = "screen";
    simulation.context.lineWidth = 1.2;
    simulation.points.forEach((point, index) => {
      const pulse = 3.5 + Math.sin(simulation.time * 5 + index) * 0.8;
      simulation.context.beginPath();
      simulation.context.arc(point.x * WIDTH, point.y * HEIGHT, pulse, 0, Math.PI * 2);
      simulation.context.strokeStyle = "rgba(230, 252, 255, .88)";
      simulation.context.stroke();
    });
    simulation.context.restore();
  }
}

export default function FluidFlow({ inputRef, paused }) {
  const canvasRef = useRef(null);
  const simulationRef = useRef(null);

  useDemoFrame((seconds) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!simulationRef.current) {
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      simulationRef.current = createSimulation(context);
    }

    const simulation = simulationRef.current;
    const input = inputRef.current;
    const points = input.active
      ? (input.source === "camera" && input.tips.length ? input.tips : [{ id: "pointer", x: input.x, y: input.y }])
      : [];
    simulation.time += seconds;
    simulation.points = points;

    const liveIds = new Set();
    points.forEach((point, index) => {
      liveIds.add(point.id);
      const paletteIndex = (index + Math.floor(simulation.time * 0.45)) % PALETTE.length;
      addVortex(simulation, point, simulation.previousPoints.get(point.id), seconds, PALETTE[paletteIndex], input.action);
      simulation.previousPoints.set(point.id, { x: point.x, y: point.y });
    });
    for (const id of simulation.previousPoints.keys()) {
      if (!liveIds.has(id)) simulation.previousPoints.delete(id);
    }

    advect(simulation, Math.max(seconds, 1 / 120));
    render(simulation, input.active);
  }, paused);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#030713" }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Interactive glowing fluid flow simulation"
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      <div style={{ position: "absolute", right: 22, bottom: 20, padding: "9px 14px", border: "1px solid rgba(255,255,255,.16)", borderRadius: 999, color: "rgba(235,248,255,.82)", background: "rgba(3,7,19,.58)", backdropFilter: "blur(10px)", pointerEvents: "none", fontSize: 14 }}>
        Move to stir · pinch or press to boost
      </div>
    </div>
  );
}
