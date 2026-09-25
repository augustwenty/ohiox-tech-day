import { useRef } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "block-toybox",
  title: "Block Toybox",
  kind: "GAME",
  order: 2,
  icon: "🧱",
  description: "Build, balance, and throw a box full of physics blocks.",
  instructions: "Pinch or press anywhere on a block. Move and release to throw it—the grab point controls its spin.",
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
  const mass = width * height / 4000;
  return {
    id,
    x,
    y,
    width,
    height,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    mass,
    inverseMass: 1 / mass,
    inverseInertia: 12 / (mass * (width * width + height * height)),
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
    grabLocalX: 0,
    grabLocalY: 0,
    throwSamples: [],
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
    const local = worldToLocal(block, x, y);
    if (Math.abs(local.x) <= block.width / 2 + 9 && Math.abs(local.y) <= block.height / 2 + 9) return block;
  }
  return null;
}

function pointInToybox(x, y) {
  return x >= TOYBOX.x && x <= TOYBOX.x + TOYBOX.width && y >= TOYBOX.y && y <= TOYBOX.y + TOYBOX.height;
}

function rotate(x, y, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function worldToLocal(block, x, y) {
  return rotate(x - block.x, y - block.y, -block.angle);
}

function localToWorld(block, x, y) {
  const point = rotate(x, y, block.angle);
  return { x: block.x + point.x, y: block.y + point.y };
}

function vertices(block) {
  const halfWidth = block.width / 2;
  const halfHeight = block.height / 2;
  return [
    localToWorld(block, -halfWidth, -halfHeight),
    localToWorld(block, halfWidth, -halfHeight),
    localToWorld(block, halfWidth, halfHeight),
    localToWorld(block, -halfWidth, halfHeight),
  ];
}

const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;

function pointInBlock(block, point) {
  const local = worldToLocal(block, point.x, point.y);
  return Math.abs(local.x) <= block.width / 2 + 0.01 && Math.abs(local.y) <= block.height / 2 + 0.01;
}

function segmentIntersection(a, b, c, d) {
  const first = { x: b.x - a.x, y: b.y - a.y };
  const second = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(first, second);
  if (Math.abs(denominator) < 0.0001) return null;
  const offset = { x: c.x - a.x, y: c.y - a.y };
  const alongFirst = cross(offset, second) / denominator;
  const alongSecond = cross(offset, first) / denominator;
  if (alongFirst < 0 || alongFirst > 1 || alongSecond < 0 || alongSecond > 1) return null;
  return { x: a.x + first.x * alongFirst, y: a.y + first.y * alongFirst };
}

function collisionContact(a, b, pointsA, pointsB) {
  const candidates = [
    ...pointsA.filter((point) => pointInBlock(b, point)),
    ...pointsB.filter((point) => pointInBlock(a, point)),
  ];
  for (let first = 0; first < 4; first += 1) {
    for (let second = 0; second < 4; second += 1) {
      const point = segmentIntersection(pointsA[first], pointsA[(first + 1) % 4], pointsB[second], pointsB[(second + 1) % 4]);
      if (point) candidates.push(point);
    }
  }
  if (!candidates.length) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return candidates.reduce((total, point) => ({ x: total.x + point.x / candidates.length, y: total.y + point.y / candidates.length }), { x: 0, y: 0 });
}

function findCollision(a, b) {
  const pointsA = vertices(a);
  const pointsB = vertices(b);
  const axes = [
    rotate(1, 0, a.angle), rotate(0, 1, a.angle),
    rotate(1, 0, b.angle), rotate(0, 1, b.angle),
  ];
  let depth = Infinity;
  let normal = null;
  for (const axis of axes) {
    const projectedA = pointsA.map((point) => dot(point, axis));
    const projectedB = pointsB.map((point) => dot(point, axis));
    const overlap = Math.min(Math.max(...projectedA), Math.max(...projectedB)) - Math.max(Math.min(...projectedA), Math.min(...projectedB));
    if (overlap <= 0) return null;
    if (overlap < depth) {
      depth = overlap;
      normal = axis;
    }
  }
  if ((b.x - a.x) * normal.x + (b.y - a.y) * normal.y < 0) normal = { x: -normal.x, y: -normal.y };
  return { depth, normal, contact: collisionContact(a, b, pointsA, pointsB) };
}

function applyImpulse(block, impulse, offset, direction = 1) {
  block.vx += impulse.x * block.inverseMass * direction;
  block.vy += impulse.y * block.inverseMass * direction;
  block.angularVelocity += cross(offset, impulse) * block.inverseInertia * direction;
}

function collide(a, b, heldId) {
  const collision = findCollision(a, b);
  if (!collision) return;

  const inverseA = a.id === heldId ? 0 : 1 / (a.width * a.height);
  const inverseB = b.id === heldId ? 0 : 1 / (b.width * b.height);
  const inverseTotal = inverseA + inverseB;
  if (inverseTotal === 0) return;

  const correction = Math.max(0, collision.depth - 0.12) / inverseTotal * 0.76;
  a.x -= collision.normal.x * correction * inverseA;
  a.y -= collision.normal.y * correction * inverseA;
  b.x += collision.normal.x * correction * inverseB;
  b.y += collision.normal.y * correction * inverseB;

  const ra = { x: collision.contact.x - a.x, y: collision.contact.y - a.y };
  const rb = { x: collision.contact.x - b.x, y: collision.contact.y - b.y };
  const velocityA = { x: a.vx - a.angularVelocity * ra.y, y: a.vy + a.angularVelocity * ra.x };
  const velocityB = { x: b.vx - b.angularVelocity * rb.y, y: b.vy + b.angularVelocity * rb.x };
  const relative = { x: velocityB.x - velocityA.x, y: velocityB.y - velocityA.y };
  const normalSpeed = dot(relative, collision.normal);
  if (normalSpeed >= 0) return;
  const inverseInertiaA = a.id === heldId ? 0 : a.inverseInertia;
  const inverseInertiaB = b.id === heldId ? 0 : b.inverseInertia;
  const normalDenominator = a.inverseMass * (a.id === heldId ? 0 : 1) + b.inverseMass * (b.id === heldId ? 0 : 1)
    + cross(ra, collision.normal) ** 2 * inverseInertiaA + cross(rb, collision.normal) ** 2 * inverseInertiaB;
  const strength = -(1.22 * normalSpeed) / normalDenominator;
  const normalImpulse = { x: collision.normal.x * strength, y: collision.normal.y * strength };
  if (a.id !== heldId) applyImpulse(a, normalImpulse, ra, -1);
  if (b.id !== heldId) applyImpulse(b, normalImpulse, rb, 1);

  const tangent = { x: -collision.normal.y, y: collision.normal.x };
  const tangentDenominator = a.inverseMass * (a.id === heldId ? 0 : 1) + b.inverseMass * (b.id === heldId ? 0 : 1)
    + cross(ra, tangent) ** 2 * inverseInertiaA + cross(rb, tangent) ** 2 * inverseInertiaB;
  const frictionStrength = clamp(-dot(relative, tangent) / tangentDenominator, -strength * 0.42, strength * 0.42);
  const frictionImpulse = { x: tangent.x * frictionStrength, y: tangent.y * frictionStrength };
  if (a.id !== heldId) applyImpulse(a, frictionImpulse, ra, -1);
  if (b.id !== heldId) applyImpulse(b, frictionImpulse, rb, 1);
}

function collideWithWall(block, heldId, normal, penetration, contacts, floor = false) {
  if (penetration <= 0 || block.id === heldId) return;
  block.x -= normal.x * penetration;
  block.y -= normal.y * penetration;
  const contact = contacts.reduce((total, point) => ({ x: total.x + point.x / contacts.length, y: total.y + point.y / contacts.length }), { x: 0, y: 0 });
  const offset = { x: contact.x - block.x, y: contact.y - block.y };
  const pointVelocity = { x: block.vx - block.angularVelocity * offset.y, y: block.vy + block.angularVelocity * offset.x };
  const normalSpeed = -dot(pointVelocity, normal);
  if (normalSpeed >= 0) return;
  const denominator = block.inverseMass + cross(offset, normal) ** 2 * block.inverseInertia;
  const strength = -(1 + (floor ? 0.12 : 0.28)) * normalSpeed / denominator;
  applyImpulse(block, { x: normal.x * strength, y: normal.y * strength }, offset, -1);
  const tangent = { x: -normal.y, y: normal.x };
  const tangentSpeed = dot(pointVelocity, tangent);
  const tangentDenominator = block.inverseMass + cross(offset, tangent) ** 2 * block.inverseInertia;
  const friction = clamp(tangentSpeed / tangentDenominator, -strength * 0.5, strength * 0.5);
  applyImpulse(block, { x: tangent.x * friction, y: tangent.y * friction }, offset, -1);
  if (floor && Math.abs(block.vy) < 18) block.vy = 0;
}

function constrainToWalls(block, heldId) {
  const points = vertices(block);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  collideWithWall(block, heldId, { x: -1, y: 0 }, WALL.left - minX, points.filter((point) => point.x <= minX + 0.5));
  collideWithWall(block, heldId, { x: 1, y: 0 }, maxX - WALL.right, points.filter((point) => point.x >= maxX - 0.5));
  collideWithWall(block, heldId, { x: 0, y: -1 }, WALL.top - minY, points.filter((point) => point.y <= minY + 0.5));
  collideWithWall(block, heldId, { x: 0, y: 1 }, maxY - WALL.bottom, points.filter((point) => point.y >= maxY - 0.5), true);
}

function stepPhysics(world, seconds) {
  const step = Math.min(seconds, 1 / 30) / 4;
  for (let substep = 0; substep < 4; substep += 1) {
    for (const block of world.blocks) {
      if (block.id === world.heldId) continue;
      block.vy += 1450 * step;
      block.vx *= Math.pow(0.996, step * 60);
      block.angularVelocity *= Math.pow(0.992, step * 60);
      block.angularVelocity = clamp(block.angularVelocity, -16, 16);
      block.x += block.vx * step;
      block.y += block.vy * step;
      block.angle += block.angularVelocity * step;
      constrainToWalls(block, world.heldId);
    }
    for (let pass = 0; pass < 3; pass += 1) {
      for (let first = 0; first < world.blocks.length; first += 1) {
        for (let second = first + 1; second < world.blocks.length; second += 1) {
          collide(world.blocks[first], world.blocks[second], world.heldId);
        }
      }
      world.blocks.forEach((block) => constrainToWalls(block, world.heldId));
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
  background.addColorStop(0, "rgba(15, 28, 48, .58)");
  background.addColorStop(1, "rgba(5, 12, 23, .84)");
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.strokeStyle = "rgba(126, 231, 255, .48)";
  context.lineWidth = 5;
  context.shadowColor = "rgba(34, 211, 238, .32)";
  context.shadowBlur = 14;
  context.strokeRect(WALL.left, WALL.top, WALL.right - WALL.left, WALL.bottom - WALL.top);
  context.shadowBlur = 0;

  for (const block of world.blocks) {
    context.save();
    context.translate(block.x, block.y);
    context.rotate(block.angle);
    context.shadowColor = "rgba(0, 0, 0, .4)";
    context.shadowBlur = 16;
    context.shadowOffsetY = 8;
    roundedRect(context, -block.width / 2, -block.height / 2, block.width, block.height, 9);
    context.fillStyle = block.color;
    context.fill();
    context.shadowColor = "transparent";
    context.lineWidth = block.id === world.heldId ? 5 : 2;
    context.strokeStyle = block.id === world.heldId ? "#ffffff" : "rgba(255,255,255,.58)";
    context.stroke();
    roundedRect(context, -block.width / 2 + 8, -block.height / 2 + 7, block.width - 16, Math.max(8, block.height * 0.2), 5);
    context.fillStyle = "rgba(255,255,255,.19)";
    context.fill();
    if (block.id === world.heldId) {
      context.shadowColor = "transparent";
      context.fillStyle = "#082f49";
      context.strokeStyle = "white";
      context.lineWidth = 3;
      context.beginPath();
      context.arc(world.grabLocalX, world.grabLocalY, 7, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
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
    const elapsed = clamp(seconds, 1 / 120, 1 / 20);
    const measuredVx = input.active && world.active ? (x - world.pointerX) / elapsed : 0;
    const measuredVy = input.active && world.active ? (y - world.pointerY) / elapsed : 0;
    world.pointerVx = world.pointerVx * 0.45 + measuredVx * 0.55;
    world.pointerVy = world.pointerVy * 0.45 + measuredVy * 0.55;
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
        const grab = worldToLocal(block, x, y);
        world.grabLocalX = clamp(grab.x, -block.width / 2, block.width / 2);
        world.grabLocalY = clamp(grab.y, -block.height / 2, block.height / 2);
        world.throwSamples = [{ x, y, age: 0 }];
        block.vx = 0;
        block.vy = 0;
        block.angularVelocity = 0;
      }
    }

    const held = world.blocks.find((block) => block.id === world.heldId);
    if (held && input.action && input.active) {
      world.throwSamples.forEach((sample) => { sample.age += elapsed; });
      world.throwSamples.push({ x, y, age: 0 });
      world.throwSamples = world.throwSamples.filter((sample) => sample.age <= 0.12).slice(-8);
      const grabOffset = rotate(world.grabLocalX, world.grabLocalY, held.angle);
      const cosine = Math.abs(Math.cos(held.angle));
      const sine = Math.abs(Math.sin(held.angle));
      const extentX = held.width / 2 * cosine + held.height / 2 * sine;
      const extentY = held.width / 2 * sine + held.height / 2 * cosine;
      held.x = clamp(x - grabOffset.x, WALL.left + extentX, WALL.right - extentX);
      held.y = clamp(y - grabOffset.y, WALL.top + extentY, WALL.bottom - extentY);
      held.vx = clamp(world.pointerVx, -2400, 2400);
      held.vy = clamp(world.pointerVy, -2400, 2400);
    }
    if (actionEnded && held) {
      const oldest = world.throwSamples[0];
      const latest = world.throwSamples.at(-1);
      const releaseX = input.active ? x : latest?.x ?? x;
      const releaseY = input.active ? y : latest?.y ?? y;
      const duration = (oldest?.age || 0) + (input.active ? elapsed : 0);
      const releaseVx = duration > 0.018 ? (releaseX - oldest.x) / duration : world.pointerVx;
      const releaseVy = duration > 0.018 ? (releaseY - oldest.y) / duration : world.pointerVy;
      const pointerVx = clamp(releaseVx, -2400, 2400);
      const pointerVy = clamp(releaseVy, -2400, 2400);
      const grabOffset = rotate(world.grabLocalX, world.grabLocalY, held.angle);
      const inertiaPerMass = (held.width * held.width + held.height * held.height) / 12;
      const grabRadiusSquared = grabOffset.x * grabOffset.x + grabOffset.y * grabOffset.y;
      held.angularVelocity = clamp(cross(grabOffset, { x: pointerVx, y: pointerVy }) / (inertiaPerMass + grabRadiusSquared) * 0.82, -14, 14);
      held.vx = clamp(pointerVx + held.angularVelocity * grabOffset.y, -2200, 2200);
      held.vy = clamp(pointerVy - held.angularVelocity * grabOffset.x, -2200, 2200);
      world.heldId = null;
      world.throwSamples = [];
    }

    world.actionWasDown = Boolean(input.action && input.active);
    stepPhysics(world, seconds);
    drawWorld(canvas.getContext("2d"), world);
  }, paused);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "rgba(3, 8, 18, .72)" }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Physics toybox with colorful blocks that can be grabbed, stacked, and thrown"
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      <div style={{ position: "absolute", right: 190, bottom: 18, padding: "9px 14px", border: "1px solid rgba(255,255,255,.16)", borderRadius: 999, color: "#dffaff", background: "rgba(3,8,20,.74)", pointerEvents: "none", fontSize: 14 }}>
        Grab any point · release while moving to throw and spin
      </div>
    </div>
  );
}
