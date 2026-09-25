import { useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "shape-painter",
  title: "Shape Painter",
  kind: "GAME",
  order: 5,
  icon: "🎨",
  description: "Pinch to paint along a shape, then see how closely you traced it.",
  instructions: "Guide the brush with your thumb. Hold a pinch, pointer press, or Space to paint; release to lift it.",
};

const WIDTH = 1000;
const HEIGHT = 600;
const ROUND_SECONDS = 45;
const BRUSH_WIDTH = 17;
const GUIDE_TOLERANCE = 25;

function sampleLine(a, b, step = 5) {
  const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: count }, (_, index) => {
    const t = index / count;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
}

function polygonPoints(vertices) {
  return vertices.flatMap((point, index) => sampleLine(point, vertices[(index + 1) % vertices.length]));
}

function heartPoints() {
  return Array.from({ length: 300 }, (_, index) => {
    const t = (index / 300) * Math.PI * 2;
    return {
      x: 500 + 13 * (16 * Math.sin(t) ** 3),
      y: 313 - 13 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    };
  });
}

const SHAPES = [
  {
    name: "Circle",
    color: "#29b6c8",
    points: Array.from({ length: 260 }, (_, index) => {
      const angle = (index / 260) * Math.PI * 2 - Math.PI / 2;
      return { x: 500 + Math.cos(angle) * 180, y: 300 + Math.sin(angle) * 180 };
    }),
  },
  {
    name: "Star",
    color: "#f2a93b",
    points: polygonPoints(Array.from({ length: 10 }, (_, index) => {
      const angle = (index / 10) * Math.PI * 2 - Math.PI / 2;
      const radius = index % 2 === 0 ? 215 : 105;
      return { x: 500 + Math.cos(angle) * radius, y: 305 + Math.sin(angle) * radius };
    })),
  },
  { name: "Heart", color: "#f16a83", points: heartPoints() },
];

function createScene(index = 0) {
  return {
    index,
    phase: "ready",
    remaining: ROUND_SECONDS,
    paint: null,
    paintContext: null,
    covered: new Uint8Array(SHAPES[index].points.length),
    coveredCount: 0,
    goodSamples: 0,
    totalSamples: 0,
    last: null,
    actionWasDown: false,
    waitForRelease: false,
    result: null,
    hudElapsed: 0,
  };
}

function ensurePaint(scene) {
  if (scene.paint) return;
  scene.paint = document.createElement("canvas");
  scene.paint.width = WIDTH;
  scene.paint.height = HEIGHT;
  scene.paintContext = scene.paint.getContext("2d");
}

function markPaint(scene, x, y) {
  const points = SHAPES[scene.index].points;
  let onGuide = false;
  const distanceLimit = GUIDE_TOLERANCE ** 2;
  for (let index = 0; index < points.length; index += 1) {
    const dx = points[index].x - x;
    const dy = points[index].y - y;
    if (dx * dx + dy * dy > distanceLimit) continue;
    onGuide = true;
    if (!scene.covered[index]) {
      scene.covered[index] = 1;
      scene.coveredCount += 1;
    }
  }
  scene.totalSamples += 1;
  if (onGuide) scene.goodSamples += 1;
}

function paintSegment(scene, from, to) {
  ensurePaint(scene);
  const context = scene.paintContext;
  const color = SHAPES[scene.index].color;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = BRUSH_WIDTH;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  if (from) {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  } else {
    context.arc(to.x, to.y, BRUSH_WIDTH / 2, 0, Math.PI * 2);
    context.fill();
  }

  const distance = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  const samples = Math.max(1, Math.ceil(distance / 5));
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    markPaint(scene, from ? from.x + (to.x - from.x) * t : to.x, from ? from.y + (to.y - from.y) * t : to.y);
  }
}

function finishRound(scene) {
  if (scene.phase !== "painting") return;
  const coverage = scene.coveredCount / scene.covered.length;
  const precision = scene.totalSamples ? scene.goodSamples / scene.totalSamples : 0;
  scene.result = {
    score: Math.round(100 * coverage * (0.45 + 0.55 * precision)),
    coverage: Math.round(coverage * 100),
    precision: Math.round(precision * 100),
  };
  scene.phase = "result";
  scene.last = null;
}

function guidePath(context, points) {
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
}

function anchorPoint(input) {
  if (input.source !== "camera") return { x: input.x, y: input.y };
  return input.tips.find((tip) => tip.id === "0-0") ?? null;
}

function playLayout(width, height) {
  const compact = width <= 720;
  const top = compact ? 175 : 150;
  const bottom = compact ? 160 : 150;
  const available = Math.max(1, height - top - bottom);
  const scale = Math.max(0.1, Math.min((width - 32) / WIDTH, available / HEIGHT, 1.15));
  return {
    scale,
    left: (width - WIDTH * scale) / 2,
    top: top + (available - HEIGHT * scale) / 2,
  };
}

function drawScene(canvas, scene) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(bounds.width * dpr);
  const pixelHeight = Math.round(bounds.height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(canvas.width / bounds.width, 0, 0, canvas.height / bounds.height, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  const layout = playLayout(bounds.width, bounds.height);
  context.save();
  context.translate(layout.left, layout.top);
  context.scale(layout.scale, layout.scale);

  const shape = SHAPES[scene.index];
  context.lineCap = "round";
  context.lineJoin = "round";
  guidePath(context, shape.points);
  context.strokeStyle = "rgba(5, 20, 32, .55)";
  context.lineWidth = 39;
  context.stroke();
  guidePath(context, shape.points);
  context.strokeStyle = `${shape.color}88`;
  context.lineWidth = 30;
  context.stroke();
  guidePath(context, shape.points);
  context.strokeStyle = "rgba(255, 255, 255, .9)";
  context.lineWidth = 3.5;
  context.setLineDash([12, 10]);
  context.stroke();
  context.setLineDash([]);

  if (scene.paint) context.drawImage(scene.paint, 0, 0);
  context.restore();
}

export default function ShapePainter({ inputRef, paused }) {
  const canvasRef = useRef(null);
  const trackerRef = useRef(null);
  const finishRef = useRef(null);
  const nextRef = useRef(null);
  const sceneRef = useRef(null);
  if (!sceneRef.current) sceneRef.current = createScene();
  const [hud, setHud] = useState({ phase: "ready", index: 0, coverage: 0, remaining: ROUND_SECONDS, result: null });

  function syncHud(scene) {
    setHud({
      phase: scene.phase,
      index: scene.index,
      coverage: Math.round((scene.coveredCount / scene.covered.length) * 100),
      remaining: Math.ceil(scene.remaining),
      result: scene.result,
    });
  }

  function nextRound() {
    const next = createScene((sceneRef.current.index + 1) % SHAPES.length);
    next.waitForRelease = Boolean(inputRef.current.action);
    next.actionWasDown = next.waitForRelease;
    sceneRef.current = next;
    syncHud(next);
  }

  function inControl(anchor, control) {
    const rect = control?.getBoundingClientRect();
    if (!rect || !anchor) return false;
    const x = anchor.x * window.innerWidth;
    const y = anchor.y * window.innerHeight;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  useDemoFrame((seconds) => {
    const scene = sceneRef.current;
    const input = inputRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const anchor = anchorPoint(input);
    const down = Boolean(input.active && anchor && input.action);
    const actionStarted = down && !scene.actionWasDown;
    scene.actionWasDown = down;

    if (input.source === "camera" && actionStarted) {
      if (scene.phase === "painting" && inControl(anchor, finishRef.current)) finishRound(scene);
      else if (scene.phase === "result" && inControl(anchor, nextRef.current)) nextRound();
    }

    const current = sceneRef.current;
    if (!down) current.waitForRelease = false;
    const rect = canvas.getBoundingClientRect();
    const x = anchor ? anchor.x * window.innerWidth : 0;
    const y = anchor ? anchor.y * window.innerHeight : 0;
    const tracker = trackerRef.current;
    if (tracker) {
      tracker.style.display = input.active && anchor ? "block" : "none";
      tracker.style.left = `${x}px`;
      tracker.style.top = `${y}px`;
      tracker.dataset.down = down && !current.waitForRelease ? "true" : "false";
      tracker.dataset.label = input.source === "camera" ? "THUMB" : "POINTER";
      tracker.dataset.align = x > rect.width - 150 ? "left" : "right";
    }
    const layout = playLayout(rect.width, rect.height);
    const point = input.active && anchor ? {
      x: (x - rect.left - layout.left) / layout.scale,
      y: (y - rect.top - layout.top) / layout.scale,
    } : null;
    const inPaintArea = point && point.x >= 0 && point.x <= WIDTH && point.y >= 0 && point.y <= HEIGHT;

    if (down && !current.waitForRelease && inPaintArea && current.phase !== "result") {
      if (current.phase === "ready") current.phase = "painting";
      const previous = current.last;
      const distance = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : Infinity;
      // A lost camera track should begin a new stroke instead of drawing a long jump.
      if (!previous || distance >= 1) {
        paintSegment(current, distance < 110 ? previous : null, point);
        current.last = point;
      }
    } else {
      current.last = null;
    }

    if (current.phase === "painting") {
      current.remaining = Math.max(0, current.remaining - seconds);
      if (current.remaining === 0) finishRound(current);
    }
    current.hudElapsed += seconds;
    if (current.hudElapsed >= 0.12 || current.phase !== hud.phase) {
      current.hudElapsed = 0;
      syncHud(current);
    }
    drawScene(canvas, current);
  }, paused);

  const shape = SHAPES[hud.index];
  return (
    <div className="shape-painter" style={{ "--brush": shape.color }}>
      <style>{`
        .shape-painter { position:absolute; inset:0; color:#fffaf0; pointer-events:none; }
        .shape-painter .paint-scene { position:absolute; inset:0; display:block; width:100%; height:100%; }
        .shape-painter .paint-hud { position:absolute; z-index:1; top:105px; left:50%; transform:translateX(-50%); width:min(calc(100% - 80px), 990px); display:flex; align-items:center; justify-content:space-between; gap:16px; font-weight:800; text-shadow:0 2px 12px #10202e; }
        .shape-painter .paint-label { font-size:clamp(18px,2.3vw,27px); }
        .shape-painter .paint-label span { color:#ffdf99; }
        .shape-painter .paint-stats { display:flex; gap:16px; font-size:clamp(14px,1.6vw,18px); }
        .shape-painter .paint-footer { position:absolute; z-index:1; bottom:120px; left:50%; transform:translateX(-50%); width:min(calc(100% - 80px), 990px); min-height:44px; display:flex; align-items:center; justify-content:space-between; gap:15px; font-size:clamp(13px,1.4vw,17px); font-weight:700; text-shadow:0 2px 12px #10202e; }
        .shape-painter .paint-tracker { position:absolute; z-index:5; display:none; width:34px; height:34px; transform:translate(-50%,-50%); border:3px solid #8af5ff; border-radius:50%; background:#09283daa; box-shadow:0 0 0 7px #8af5ff33,0 0 22px #8af5ff; }
        .shape-painter .paint-tracker::before { content:""; position:absolute; left:50%; top:50%; width:7px; height:7px; transform:translate(-50%,-50%); border-radius:50%; background:#fff; }
        .shape-painter .paint-tracker::after { content:attr(data-label); position:absolute; left:28px; top:-3px; padding:6px 9px; border:1px solid #ffffff77; border-radius:999px; background:#10202de8; color:#fff; font:800 11px ui-sans-serif,system-ui,sans-serif; white-space:nowrap; letter-spacing:.08em; text-shadow:none; }
        .shape-painter .paint-tracker[data-align="left"]::after { left:auto; right:28px; }
        .shape-painter .paint-tracker[data-down="true"] { border-color:var(--brush); background:var(--brush); box-shadow:0 0 0 8px #ffffff44,0 0 25px var(--brush); }
        .shape-painter button { pointer-events:auto; min-width:156px; padding:10px 18px; border:2px solid #fff6; border-radius:999px; color:#10202e; background:#ffdf99; font-size:16px; font-weight:900; box-shadow:0 5px 0 #b48644,0 10px 20px #0006; }
        .shape-painter button:hover,.shape-painter button:focus-visible { background:#fff0c1; outline:3px solid white; outline-offset:3px; }
        .shape-painter .paint-result { position:absolute; z-index:2; left:50%; top:50%; transform:translate(-50%,-50%); width:min(420px,calc(100vw - 50px)); padding:22px; border:3px solid #ffdf99; border-radius:22px; background:#172536f2; box-shadow:0 25px 70px #000a; text-align:center; pointer-events:auto; }
        .shape-painter .paint-result h2 { margin:0 0 5px; font-size:clamp(44px,8vw,70px); line-height:1; color:#ffdf99; }
        .shape-painter .paint-result p { margin:7px 0 16px; font-size:18px; }
        .shape-painter .paint-result .paint-breakdown { display:flex; justify-content:center; gap:22px; margin-bottom:18px; color:#e4edf4; font-size:15px; }
        @media (max-width:720px) { .shape-painter .paint-hud { top:135px; width:calc(100% - 24px); flex-wrap:wrap; gap:2px; } .shape-painter .paint-footer { bottom:126px; width:calc(100% - 24px); flex-wrap:wrap; justify-content:center; text-align:center; } }
      `}</style>
      <canvas className="paint-scene" ref={canvasRef} aria-label={`Trace the ${shape.name} outline`} />
      <div ref={trackerRef} className="paint-tracker" aria-hidden="true" />
      <div className="paint-hud">
        <div className="paint-label">Shape {hud.index + 1}/{SHAPES.length}: <span>{shape.name}</span></div>
        <div className="paint-stats"><span>Outline {hud.coverage}%</span><span>Time {hud.remaining}s</span></div>
      </div>
      <div className="paint-footer">
        <span>{hud.phase === "ready" ? "Move the tracker to the outline, then hold to paint." : hud.phase === "painting" ? "Release to lift the brush; pinch again to keep tracing." : "Round complete!"}</span>
        {hud.phase === "painting" ? <button ref={finishRef} type="button" onPointerDown={(event) => { event.stopPropagation(); finishRound(sceneRef.current); syncHud(sceneRef.current); }} onClick={(event) => { if (event.detail === 0) { finishRound(sceneRef.current); syncHud(sceneRef.current); } }}>Finish drawing</button> : null}
      </div>
      {hud.phase === "result" ? (
        <div className="paint-result" role="status">
          <h2>{hud.result.score}/100</h2>
          <p>{hud.result.score >= 80 ? "Beautiful tracing!" : hud.result.score >= 50 ? "Nice work—try for a steadier line!" : "Give the outline another careful pass!"}</p>
          <div className="paint-breakdown"><span>Covered {hud.result.coverage}%</span><span>On line {hud.result.precision}%</span></div>
          <button ref={nextRef} type="button" onPointerDown={(event) => { event.stopPropagation(); nextRound(); }} onClick={(event) => { if (event.detail === 0) nextRound(); }}>Next shape →</button>
        </div>
      ) : null}
    </div>
  );
}
