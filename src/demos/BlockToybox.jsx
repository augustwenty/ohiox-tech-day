import { useRef } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "block-toybox",
  title: "Block Toybox",
  kind: "GAME",
  order: 2,
  icon: "🧱",
  description: "Build, balance, and throw a box full of physics blocks.",
  instructions: "Pinch or press to grab. Pull new blocks from the toybox and release to toss.",
};

const WIDTH = 1000;
const HEIGHT = 650;
const WALL = { left: 14, right: 986, top: 88, bottom: 625 };
const TOYBOX = { x: 26, y: 480, width: 178, height: 140 };
const COLORS = ["#ff6b6b", "#ffd166", "#4dd4ac", "#55b8ff", "#a98bff", "#ff8ec7"];
const SIZES = [[68, 68], [90, 48], [54, 82], [110, 42], [58, 58]];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function makeBlock(id, x, y, sizeIndex = id % SIZES.length) {
  const [width, height] = SIZES[sizeIndex];
  return {
    id,
    x,
    y,
    width,
    height,
    vx: 0,
    vy: 0,
    color: COLORS[id % COLORS.length],
  };
}

function createWorld() {
  return {
    blocks: [
      makeBlock(1, 610, 560, 3),
      makeBlock(2, 610, 505, 1),
      makeBlock(3, 790, 560, 0),
      makeBlock(4, 865, 568, 4),
    ],
    nextId: 5,
    heldId: null,
    grabOffsetX: 0,
    grabOffsetY: 0,
    pointerX: WIDTH / 2,
    pointerY: HEIGHT / 2,
    pointerVx: 0,
    pointerVy: 0,
    actionWasDown: false,
    active: false,
  };
}

function blockAt(blocks, x, y) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (Math.abs(x - block.x) <= block.width / 2 + 9 && Math.abs(y - block.y) <= block.height / 2 + 9) return block;
  }
  return null;
}

function pointInToybox(x, y) {
  return x >= TOYBOX.x && x <= TOYBOX.x + TOYBOX.width && y >= TOYBOX.y && y <= TOYBOX.y + TOYBOX.height;
}

function constrainToWalls(block) {
  const halfWidth = block.width / 2;
  const halfHeight = block.height / 2;
  if (block.x - halfWidth < WALL.left) {
    block.x = WALL.left + halfWidth;
    if (block.vx < 0) block.vx *= -0.38;
  }
  if (block.x + halfWidth > WALL.right) {
    block.x = WALL.right - halfWidth;
    if (block.vx > 0) block.vx *= -0.38;
  }
  if (block.y - halfHeight < WALL.top) {
    block.y = WALL.top + halfHeight;
    if (block.vy < 0) block.vy *= -0.3;
  }
  if (block.y + halfHeight > WALL.bottom) {
    block.y = WALL.bottom - halfHeight;
    if (block.vy > 0) block.vy *= -0.22;
    block.vx *= 0.86;
    if (Math.abs(block.vy) < 22) block.vy = 0;
  }
}

function collide(a, b, heldId) {
  const overlapX = (a.width + b.width) / 2 - Math.abs(b.x - a.x);
  const overlapY = (a.height + b.height) / 2 - Math.abs(b.y - a.y);
  if (overlapX <= 0 || overlapY <= 0) return;

  let nx = 0;
  let ny = 0;
  let depth;
  if (overlapX < overlapY) {
    nx = b.x >= a.x ? 1 : -1;
    depth = overlapX;
  } else {
    ny = b.y >= a.y ? 1 : -1;
    depth = overlapY;
  }

  const inverseA = a.id === heldId ? 0 : 1 / (a.width * a.height);
  const inverseB = b.id === heldId ? 0 : 1 / (b.width * b.height);
  const inverseTotal = inverseA + inverseB;
  if (inverseTotal === 0) return;

  const correction = Math.max(0, depth - 0.15) / inverseTotal * 0.82;
  a.x -= nx * correction * inverseA;
  a.y -= ny * correction * inverseA;
  b.x += nx * correction * inverseB;
  b.y += ny * correction * inverseB;

  const relativeX = b.vx - a.vx;
  const relativeY = b.vy - a.vy;
  const normalSpeed = relativeX * nx + relativeY * ny;
  if (normalSpeed >= 0) return;
  const impulse = -(1.12 * normalSpeed) / inverseTotal;
  a.vx -= nx * impulse * inverseA;
  a.vy -= ny * impulse * inverseA;
  b.vx += nx * impulse * inverseB;
  b.vy += ny * impulse * inverseB;

  const tx = -ny;
  const ty = nx;
  const tangentSpeed = relativeX * tx + relativeY * ty;
  const friction = clamp(-tangentSpeed / inverseTotal, -impulse * 0.34, impulse * 0.34);
  a.vx -= tx * friction * inverseA;
  a.vy -= ty * friction * inverseA;
  b.vx += tx * friction * inverseB;
  b.vy += ty * friction * inverseB;
}

function stepPhysics(world, seconds) {
  const step = Math.min(seconds, 1 / 30) / 3;
  for (let substep = 0; substep < 3; substep += 1) {
    for (const block of world.blocks) {
      if (block.id === world.heldId) continue;
      block.vy += 1450 * step;
      block.vx *= Math.pow(0.996, step * 60);
      block.x += block.vx * step;
      block.y += block.vy * step;
      constrainToWalls(block);
    }
    for (let pass = 0; pass < 3; pass += 1) {
      for (let first = 0; first < world.blocks.length; first += 1) {
        for (let second = first + 1; second < world.blocks.length; second += 1) {
          collide(world.blocks[first], world.blocks[second], world.heldId);
        }
      }
      world.blocks.forEach(constrainToWalls);
    }
  }
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawWorld(context, world) {
  context.clearRect(0, 0, WIDTH, HEIGHT);
  const background = context.createLinearGradient(0, WALL.top, 0, WALL.bottom);
  background.addColorStop(0, "rgba(15, 28, 48, .08)");
  background.addColorStop(1, "rgba(5, 12, 23, .2)");
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.strokeStyle = "rgba(126, 231, 255, .48)";
  context.lineWidth = 5;
  context.shadowColor = "rgba(34, 211, 238, .32)";
  context.shadowBlur = 14;
  context.strokeRect(WALL.left, WALL.top, WALL.right - WALL.left, WALL.bottom - WALL.top);
  context.shadowBlur = 0;

  for (const block of world.blocks) {
    const left = block.x - block.width / 2;
    const top = block.y - block.height / 2;
    context.save();
    context.shadowColor = "rgba(0, 0, 0, .4)";
    context.shadowBlur = 16;
    context.shadowOffsetY = 8;
    roundedRect(context, left, top, block.width, block.height, 9);
    context.fillStyle = block.color;
    context.fill();
    context.shadowColor = "transparent";
    context.lineWidth = block.id === world.heldId ? 5 : 2;
    context.strokeStyle = block.id === world.heldId ? "#ffffff" : "rgba(255,255,255,.58)";
    context.stroke();
    roundedRect(context, left + 8, top + 7, block.width - 16, Math.max(8, block.height * 0.2), 5);
    context.fillStyle = "rgba(255,255,255,.19)";
    context.fill();
    context.restore();
  }

  // The toybox is painted in front so blocks appear to emerge from inside it.
  context.save();
  context.shadowColor = "rgba(0,0,0,.5)";
  context.shadowBlur = 18;
  roundedRect(context, TOYBOX.x, TOYBOX.y + 25, TOYBOX.width, TOYBOX.height - 25, 14);
  context.fillStyle = "#d84a38";
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#7e251f";
  roundedRect(context, TOYBOX.x + 10, TOYBOX.y + 14, TOYBOX.width - 20, 36, 9);
  context.fill();
  context.lineWidth = 7;
  context.strokeStyle = "#ff856c";
  context.beginPath();
  context.moveTo(TOYBOX.x + 5, TOYBOX.y + 30);
  context.lineTo(TOYBOX.x + TOYBOX.width - 5, TOYBOX.y + 30);
  context.stroke();
  context.fillStyle = "#fff5df";
  context.textAlign = "center";
  context.font = "800 18px system-ui, sans-serif";
  context.fillText("TOYBOX", TOYBOX.x + TOYBOX.width / 2, TOYBOX.y + 84);
  context.font = "600 13px system-ui, sans-serif";
  context.fillStyle = "rgba(255,245,223,.8)";
  context.fillText("grab here for a new block", TOYBOX.x + TOYBOX.width / 2, TOYBOX.y + 106);
  context.restore();

  if (world.active) {
    context.save();
    context.translate(world.pointerX, world.pointerY);
    context.strokeStyle = world.heldId === null ? "rgba(255,255,255,.92)" : "#67e8f9";
    context.fillStyle = world.heldId === null ? "rgba(34,211,238,.18)" : "rgba(34,211,238,.35)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, 0, world.actionWasDown ? 14 : 20, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }
}

export default function BlockToybox({ inputRef, paused }) {
  const canvasRef = useRef(null);
  const worldRef = useRef(null);

  useDemoFrame((seconds) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!worldRef.current) worldRef.current = createWorld();
    const world = worldRef.current;
    const input = inputRef.current;
    const x = input.x * WIDTH;
    const y = input.y * HEIGHT;
    const elapsed = Math.max(seconds, 1 / 120);
    const measuredVx = (x - world.pointerX) / elapsed;
    const measuredVy = (y - world.pointerY) / elapsed;
    world.pointerVx = world.pointerVx * 0.55 + measuredVx * 0.45;
    world.pointerVy = world.pointerVy * 0.55 + measuredVy * 0.45;
    world.pointerX = x;
    world.pointerY = y;
    world.active = input.active;

    const actionStarted = input.active && input.action && !world.actionWasDown;
    const actionEnded = (!input.action || !input.active) && world.actionWasDown;

    if (actionStarted) {
      let block;
      if (pointInToybox(x, y)) {
        block = makeBlock(world.nextId, x, Math.min(y, TOYBOX.y + 18));
        world.nextId += 1;
        if (world.blocks.length >= 36) world.blocks.shift();
        world.blocks.push(block);
      } else {
        block = blockAt(world.blocks, x, y);
        if (block) {
          world.blocks.splice(world.blocks.indexOf(block), 1);
          world.blocks.push(block);
        }
      }
      if (block) {
        world.heldId = block.id;
        world.grabOffsetX = block.x - x;
        world.grabOffsetY = block.y - y;
        block.vx = 0;
        block.vy = 0;
      }
    }

    const held = world.blocks.find((block) => block.id === world.heldId);
    if (held && input.action && input.active) {
      held.x = clamp(x + world.grabOffsetX, WALL.left + held.width / 2, WALL.right - held.width / 2);
      held.y = clamp(y + world.grabOffsetY, WALL.top + held.height / 2, WALL.bottom - held.height / 2);
      held.vx = clamp(world.pointerVx, -1800, 1800);
      held.vy = clamp(world.pointerVy, -1800, 1800);
    }
    if (actionEnded && held) {
      held.vx = clamp(world.pointerVx, -1800, 1800);
      held.vy = clamp(world.pointerVy, -1800, 1800);
      world.heldId = null;
    }

    world.actionWasDown = Boolean(input.action && input.active);
    stepPhysics(world, seconds);
    drawWorld(canvas.getContext("2d"), world);
  }, paused);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Physics toybox with colorful blocks that can be grabbed, stacked, and thrown"
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      <div style={{ position: "absolute", right: 190, bottom: 18, padding: "9px 14px", border: "1px solid rgba(255,255,255,.16)", borderRadius: 999, color: "#dffaff", background: "rgba(3,8,20,.74)", pointerEvents: "none", fontSize: 14 }}>
        Pinch or press a block · release while moving to throw
      </div>
    </div>
  );
}
