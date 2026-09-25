import { useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "slingshot-street",
  title: "Slingshot Street",
  kind: "GAME",
  order: 6,
  icon: "🎯",
  description: "Hold a slingshot with one fist, pull with the other hand, and stop the approaching goons.",
  instructions: "Camera: make a fist to aim, pinch the pouch with your other hand, pull back, release. Pointer: aim, drag, release.",
};

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = (landmarks, index) => landmarks?.[index];

function handPose(hand, index) {
  const landmarks = hand.landmarks;
  if (!landmarks || landmarks.length < 21 || ![0, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20].every((joint) => point(landmarks, joint))) return null;
  const palm = {
    x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
    y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5,
  };
  let curled = 0;
  for (const [mcp, pip, tip] of [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]) {
    const first = distance(landmarks[mcp], landmarks[pip]);
    if (first > 0.003 && distance(landmarks[mcp], landmarks[tip]) / first < 1.75) curled += 1;
  }
  const palmWidth = Math.max(0.045, distance(landmarks[5], landmarks[17]));
  return {
    index,
    handedness: hand.handedness,
    palm,
    curled,
    pinch: {
      x: (landmarks[4].x + landmarks[8].x) / 2,
      y: (landmarks[4].y + landmarks[8].y) / 2,
    },
    pinchDistance: distance(landmarks[4], landmarks[8]),
    pinchEnter: clamp(palmWidth * 0.46, 0.035, 0.075),
  };
}

function smoothPoint(previous, target, seconds, speed = 14) {
  if (!previous) return { ...target };
  const alpha = 1 - Math.exp(-speed * Math.max(seconds, 1 / 120));
  return {
    x: previous.x + (target.x - previous.x) * alpha,
    y: previous.y + (target.y - previous.y) * alpha,
  };
}

function makeEnemy(id, wave, depth = -0.05) {
  const kind = wave > 1 && Math.random() < 0.23 ? "bruiser" : Math.random() < 0.27 ? "skater" : "goon";
  return {
    id,
    kind,
    lane: (Math.random() * 1.7 - 0.85),
    depth,
    speed: (kind === "skater" ? 0.105 : kind === "bruiser" ? 0.067 : 0.082) * (1 + Math.min(0.5, (wave - 1) * 0.09)),
    hp: kind === "bruiser" ? 2 : 1,
    phase: Math.random() * TAU,
    flash: 0,
  };
}

function newGame() {
  return {
    time: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    hearts: 4,
    wave: 1,
    defeated: 0,
    nextId: 4,
    enemies: [makeEnemy(1, 1, 0.32), makeEnemy(2, 1, 0.16), makeEnemy(3, 1, 0.02)],
    shots: [],
    bursts: [],
    popups: [],
    spawnIn: 2.1,
    sling: { x: 0.5, y: 0.79 },
    aim: { x: 0.5, y: 0.5 },
    fistPoint: null,
    holderSide: null,
    fistTime: 0,
    fistLost: 0,
    pinchPoint: null,
    pinchDown: false,
    draw: null,
    pointerWasDown: false,
    source: null,
    started: false,
    flash: 0,
    shake: 0,
    message: "READY, AIM, RELEASE!",
    messageTime: 3,
    hudTime: 0,
    gameOver: false,
    restartHold: 0,
  };
}

function enemyScreen(enemy, width, height, time) {
  const depth = clamp(enemy.depth, 0, 1.08);
  const sway = Math.sin(time * (enemy.kind === "skater" ? 6 : 3.6) + enemy.phase) * (5 + depth * 15);
  return {
    x: width * (0.5 + enemy.lane * (0.08 + depth * 0.37)) + sway,
    y: height * (0.43 + 0.38 * depth * depth),
    scale: (0.42 + depth * 1.58) * Math.min(1.25, Math.max(0.7, height / 720)),
  };
}

function slingPixels(scene, width, height) {
  return { x: scene.sling.x * width, y: scene.sling.y * height };
}

function pouchPixels(scene, width, height) {
  const sling = slingPixels(scene, width, height);
  return { x: sling.x, y: sling.y - Math.min(width, height) * 0.075 };
}

function currentAim(scene) {
  return scene.draw?.kind === "pointer" ? scene.draw.aim : scene.aim;
}

function aimTarget(scene, width, height) {
  const aim = currentAim(scene);
  const at = { x: aim.x * width, y: aim.y * height };
  let best = null;
  let bestRatio = 1.35;
  for (const enemy of scene.enemies) {
    if (enemy.depth < 0 || enemy.depth > 1.05) continue;
    const screen = enemyScreen(enemy, width, height, scene.time);
    const center = { x: screen.x, y: screen.y - 48 * screen.scale };
    const ratio = distance(at, center) / (38 * screen.scale + 17);
    if (ratio < bestRatio) { best = enemy; bestRatio = ratio; }
  }
  return best;
}

function addPopup(scene, x, y, label, color = "#fff2a8") {
  scene.popups.push({ x, y, label, color, age: 0 });
  if (scene.popups.length > 12) scene.popups.shift();
}

function addBurst(scene, x, y, color, count = 12) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * TAU;
    const speed = 45 + Math.random() * 150;
    scene.bursts.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 55, age: 0, life: 0.3 + Math.random() * 0.35, color, size: 3 + Math.random() * 6 });
  }
  if (scene.bursts.length > 90) scene.bursts.splice(0, scene.bursts.length - 90);
}

function setPull(draw, x, y, width, height) {
  const maxPull = Math.min(width, height) * 0.19;
  const dx = clamp(x - draw.start.x, -maxPull, maxPull);
  const dy = clamp(y - draw.start.y, 0, maxPull);
  const length = Math.hypot(dx, dy);
  const scale = length > maxPull ? maxPull / length : 1;
  draw.offsetX = dx * scale;
  draw.offsetY = dy * scale;
  draw.power = clamp(length / maxPull, 0, 1);
  draw.hand = { x, y };
}

function fire(scene, width, height) {
  const draw = scene.draw;
  if (!draw) return;
  scene.draw = null;
  if (draw.power < 0.22) {
    scene.message = "PULL FARTHER!";
    scene.messageTime = 0.9;
    return;
  }
  const aim = draw.kind === "pointer" ? draw.aim : scene.aim;
  const target = aimTarget({ ...scene, aim, draw: null }, width, height);
  const origin = pouchPixels(scene, width, height);
  scene.shots.push({ x: origin.x, y: origin.y, aimX: aim.x * width, aimY: aim.y * height, age: 0, duration: 0.22 + 0.12 * (1 - draw.power), power: draw.power, targetId: target?.id ?? null });
  if (scene.shots.length > 8) scene.shots.shift();
  scene.shake = Math.max(scene.shake, 5 + draw.power * 4);
  scene.message = draw.power > 0.8 ? "FULL POWER!" : "ROCK AWAY!";
  scene.messageTime = 0.7;
}

function resolveShot(scene, shot, width, height) {
  const enemy = scene.enemies.find((item) => item.id === shot.targetId);
  if (!enemy) {
    addBurst(scene, shot.aimX, shot.aimY, "#ece2c3", 6);
    addPopup(scene, shot.aimX, shot.aimY, "MISS", "#ffffff");
    scene.combo = 0;
    return;
  }
  const at = enemyScreen(enemy, width, height, scene.time);
  enemy.hp -= shot.power > 0.78 ? 2 : 1;
  enemy.flash = 0.2;
  scene.shake = Math.max(scene.shake, 9);
  addBurst(scene, at.x, at.y - 48 * at.scale, enemy.kind === "bruiser" ? "#ffce64" : "#90f2ff", 16);
  if (enemy.hp <= 0) {
    scene.enemies = scene.enemies.filter((item) => item.id !== enemy.id);
    scene.combo = Math.min(5, scene.combo + 1);
    scene.bestCombo = Math.max(scene.bestCombo, scene.combo);
    scene.defeated += 1;
    scene.wave = 1 + Math.floor(scene.defeated / 8);
    const points = 100 * scene.combo + (enemy.kind === "bruiser" ? 100 : 0);
    scene.score += points;
    addPopup(scene, at.x, at.y - 80 * at.scale, `BONK! +${points}`, "#fff3a7");
    scene.message = scene.combo >= 3 ? `${scene.combo}× COMBO!` : "NICE SHOT!";
  } else {
    scene.score += 50;
    addPopup(scene, at.x, at.y - 70 * at.scale, "CRACK! +50", "#fff3a7");
    scene.message = "ONE MORE HIT!";
  }
  scene.messageTime = 1;
}

function cameraControls(scene, input, seconds, width, height) {
  const poses = (input.hands ?? []).map(handPose).filter(Boolean);
  const candidates = poses.filter((pose) => pose.curled >= 3);
  candidates.sort((left, right) => {
    const leftBonus = left.handedness && left.handedness === scene.holderSide ? 1.5 : 0;
    const rightBonus = right.handedness && right.handedness === scene.holderSide ? 1.5 : 0;
    const leftPinch = left.pinchDistance < left.pinchEnter ? 1 : 0;
    const rightPinch = right.pinchDistance < right.pinchEnter ? 1 : 0;
    return right.curled + rightBonus - rightPinch - left.curled - leftBonus + leftPinch;
  });
  const holder = candidates[0] ?? null;
  if (holder) {
    scene.holderSide = holder.handedness;
    scene.fistPoint = smoothPoint(scene.fistPoint, holder.palm, seconds, 13);
    scene.fistTime = Math.min(0.25, scene.fistTime + seconds);
    scene.fistLost = 0;
  } else {
    scene.fistLost += seconds;
    if (scene.fistLost > 0.22) scene.fistTime = 0;
  }
  if (scene.fistPoint) {
    scene.sling.x = clamp(scene.fistPoint.x, 0.2, 0.8);
    scene.sling.y = clamp(scene.fistPoint.y + 0.1, 0.66, 0.85);
    scene.aim.x = scene.sling.x;
    scene.aim.y = clamp(scene.fistPoint.y - 0.08, 0.25, 0.72);
  }

  const rest = pouchPixels(scene, width, height);
  const other = poses.filter((pose) => pose.index !== holder?.index)
    .sort((a, b) => distance({ x: a.pinch.x * width, y: a.pinch.y * height }, rest) - distance({ x: b.pinch.x * width, y: b.pinch.y * height }, rest))[0];
  const pinchEnter = other?.pinchEnter ?? 0.045;
  const pinched = Boolean(other && other.pinchDistance < pinchEnter * (scene.pinchDown ? 1.35 : 1));
  scene.pinchDown = pinched;
  scene.pinchPoint = other ? smoothPoint(scene.pinchPoint, other.pinch, seconds, 18) : null;
  const pinchAt = scene.pinchPoint ? { x: scene.pinchPoint.x * width, y: scene.pinchPoint.y * height } : null;

  if (scene.draw?.kind === "camera") {
    if (!other) {
      scene.draw.missing = (scene.draw.missing ?? 0) + seconds;
      if (scene.draw.missing > 0.22) scene.draw = null;
    } else if (!pinched) {
      scene.draw.release = (scene.draw.release ?? 0) + seconds;
      if (scene.draw.release > 0.06) fire(scene, width, height);
    } else {
      scene.draw.release = 0;
      scene.draw.missing = 0;
      setPull(scene.draw, pinchAt.x, pinchAt.y, width, height);
    }
  } else if (scene.fistTime >= 0.1 && pinched && pinchAt && distance(pinchAt, rest) < Math.min(width, height) * 0.13) {
    scene.draw = { kind: "camera", start: pinchAt, offsetX: 0, offsetY: 0, power: 0, hand: pinchAt, release: 0, missing: 0 };
  }
}

function pointerControls(scene, input, width, height) {
  scene.sling = { x: 0.5, y: 0.79 };
  const down = Boolean(input.active && input.action);
  const at = { x: input.x * width, y: input.y * height };
  if (!scene.draw && !down) scene.aim = { x: clamp(input.x, 0.08, 0.92), y: clamp(input.y, 0.17, 0.73) };
  if (down && !scene.pointerWasDown) {
    scene.draw = { kind: "pointer", start: at, aim: { x: clamp(input.x, 0.08, 0.92), y: clamp(input.y, 0.17, 0.73) }, offsetX: 0, offsetY: 0, power: 0, hand: at };
  }
  if (down && scene.draw?.kind === "pointer") setPull(scene.draw, at.x, at.y, width, height);
  if (!down && scene.pointerWasDown && scene.draw?.kind === "pointer") fire(scene, width, height);
  scene.pointerWasDown = down;
}

function stepGame(scene, input, seconds, width, height) {
  const dt = Math.min(seconds, 0.05);
  scene.time += dt;
  scene.flash = Math.max(0, scene.flash - dt * 2.8);
  scene.shake *= Math.exp(-dt * 14);
  scene.messageTime = Math.max(0, scene.messageTime - dt);
  for (const enemy of scene.enemies) enemy.flash = Math.max(0, enemy.flash - dt);
  for (const burst of scene.bursts) {
    burst.age += dt;
    burst.x += burst.vx * dt;
    burst.y += burst.vy * dt;
    burst.vy += 220 * dt;
  }
  scene.bursts = scene.bursts.filter((burst) => burst.age < burst.life);
  for (const popup of scene.popups) { popup.age += dt; popup.y -= dt * 48; }
  scene.popups = scene.popups.filter((popup) => popup.age < 0.9);

  if (scene.source !== input.source) {
    scene.source = input.source;
    scene.draw = null;
    scene.pointerWasDown = false;
    scene.pinchDown = false;
    scene.pinchPoint = null;
  }
  if (scene.gameOver) {
    if (input.source !== "pointer") {
      const poses = (input.hands ?? []).map(handPose).filter(Boolean);
      const ready = poses.some((fist) => fist.curled >= 3 && poses.some((other) => other.index !== fist.index && other.pinchDistance < other.pinchEnter));
      scene.restartHold = ready ? scene.restartHold + dt : 0;
      if (scene.restartHold >= 0.8) Object.assign(scene, newGame());
    }
    return;
  }

  if (input.source === "pointer") pointerControls(scene, input, width, height);
  else cameraControls(scene, input, dt, width, height);
  if (input.source === "pointer" && input.active) scene.started = true;
  const playing = input.source === "pointer" ? scene.started : scene.fistTime >= 0.1;
  if (!playing) return;

  scene.spawnIn -= dt;
  if (scene.spawnIn <= 0) {
    if (scene.enemies.length < 9) scene.enemies.push(makeEnemy(scene.nextId++, scene.wave));
    scene.spawnIn = Math.max(0.85, 2.25 - scene.wave * 0.11) + Math.random() * 0.3;
  }
  for (const enemy of scene.enemies) enemy.depth += enemy.speed * dt;
  for (const shot of scene.shots) shot.age += dt;
  const arrived = scene.shots.filter((shot) => shot.age >= shot.duration);
  scene.shots = scene.shots.filter((shot) => shot.age < shot.duration);
  for (const shot of arrived) resolveShot(scene, shot, width, height);

  const escaped = scene.enemies.filter((enemy) => enemy.depth >= 1.08);
  if (escaped.length) {
    scene.enemies = scene.enemies.filter((enemy) => enemy.depth < 1.08);
    scene.hearts = Math.max(0, scene.hearts - escaped.length);
    scene.combo = 0;
    scene.flash = 0.65;
    scene.shake = 17;
    scene.message = scene.hearts ? "THEY GOT THROUGH!" : "STREET OVERRUN!";
    scene.messageTime = 1.4;
    if (!scene.hearts) { scene.gameOver = true; scene.draw = null; }
  }
}

function polygon(ctx, points, fill, stroke = "#172b3a", line = 3) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke(); }
}

function line(ctx, points, color, width, cap = "round") {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function circle(ctx, x, y, radius, fill, stroke = null, width = 3) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function house(ctx, x, y, size, flip, palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size * flip, size);
  polygon(ctx, [[-82, 0], [75, 0], [75, -77], [-82, -77]], palette.wall, "#243b42", 3);
  polygon(ctx, [[-94, -76], [-5, -133], [88, -76]], palette.roof, "#243b42", 4);
  polygon(ctx, [[-5, -131], [87, -76], [78, -76], [-5, -119]], "#fff2c7", null);
  polygon(ctx, [[-20, 0], [12, 0], [12, -61], [-20, -61]], palette.door, "#243b42", 3);
  circle(ctx, 4, -25, 2.5, "#fff1aa");
  for (const px of [-60, 43]) {
    polygon(ctx, [[px - 14, -61], [px + 14, -61], [px + 14, -31], [px - 14, -31]], "#b8eaf1", "#243b42", 3);
    line(ctx, [[px, -60], [px, -31]], "#fff9d9", 2);
    line(ctx, [[px - 13, -46], [px + 13, -46]], "#fff9d9", 2);
  }
  polygon(ctx, [[-84, 0], [79, 0], [93, 9], [-93, 9]], "#426e56", null);
  ctx.restore();
}

function tree(ctx, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  polygon(ctx, [[-8, 0], [10, 0], [5, -81], [-6, -81]], "#805640", "#253b3d", 3);
  circle(ctx, -22, -83, 34, "#328c69", "#253b3d", 3);
  circle(ctx, 22, -86, 33, "#2d805f", "#253b3d", 3);
  circle(ctx, 0, -109, 42, "#54b777", "#253b3d", 3);
  circle(ctx, -17, -120, 10, "#8fd291");
  ctx.restore();
}

function drawStreet(ctx, width, height, time) {
  const horizon = height * 0.43;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#66b9d5"); sky.addColorStop(1, "#d2eecf");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  circle(ctx, width * 0.77, height * 0.21, 43, "#fff0ac");
  for (const [cx, cy, scale] of [[.17,.2,1],[.42,.14,.72],[.9,.3,.68]]) {
    const x = width * cx + Math.sin(time * .11 + cx) * 12; const y = height * cy;
    circle(ctx, x - 27*scale, y, 19*scale, "#f7f9db");
    circle(ctx, x, y - 10*scale, 26*scale, "#f7f9db");
    circle(ctx, x + 30*scale, y, 18*scale, "#f7f9db");
  }
  polygon(ctx, [[0,horizon+20],[width*.18,horizon-5],[width*.36,horizon+16],[width*.54,horizon-14],[width*.75,horizon+10],[width,horizon-3],[width,horizon+90],[0,horizon+90]], "#7bbd85", null);
  ctx.fillStyle = "#73b77d"; ctx.fillRect(0,horizon,width,height-horizon);

  const leftHouses = [[.07,.43,.7],[.22,.44,.51],[.34,.44,.34]];
  const rightHouses = [[.93,.43,.7],[.78,.44,.51],[.66,.44,.34]];
  const palettes = [
    {wall:"#ffd597",roof:"#b96b60",door:"#428ba2"},
    {wall:"#c6e6d3",roof:"#6587a0",door:"#eeaa64"},
    {wall:"#f7d3c2",roof:"#80679a",door:"#398f73"},
  ];
  leftHouses.forEach(([x,y,s],i) => house(ctx,width*x,height*y,s*Math.min(1.25,width/1100+.22),1,palettes[i]));
  rightHouses.forEach(([x,y,s],i) => house(ctx,width*x,height*y,s*Math.min(1.25,width/1100+.22),-1,palettes[(i+1)%3]));
  tree(ctx,width*.11,height*.47,Math.min(1.4,width/980+.35));
  tree(ctx,width*.88,height*.47,Math.min(1.4,width/980+.35));

  polygon(ctx, [[width*.465,horizon],[width*.535,horizon],[width*1.11,height],[-width*.11,height]], "#586c73", "#263942", 4);
  polygon(ctx, [[width*.465,horizon],[width*.465+7,horizon],[width*.08,height],[width*.02,height]], "#edddba", null);
  polygon(ctx, [[width*.535-7,horizon],[width*.535,horizon],[width*.98,height],[width*.92,height]], "#edddba", null);
  line(ctx, [[width*.465,horizon],[width*.02,height]], "#fff0d2", 3);
  line(ctx, [[width*.535,horizon],[width*.98,height]], "#fff0d2", 3);
  for (const depth of [.1,.27,.5,.77]) {
    const y = horizon + (height-horizon)*depth*depth;
    const markW = 2 + depth*10;
    const markH = 7 + depth*43;
    polygon(ctx, [[width*.5-markW/2,y],[width*.5+markW/2,y],[width*.5+markW*.8,y+markH],[width*.5-markW*.8,y+markH]], "#f9e8b2", null);
  }
  for (const [side, depth] of [[-1,.45],[1,.55],[-1,.74],[1,.85]]) {
    const y = horizon + (height-horizon)*depth*depth;
    const x = width*.5 + side*width*(.075+depth*.42);
    const s = .33 + depth*.54;
    line(ctx, [[x,y],[x,y-52*s]], "#314b45", 5*s);
    polygon(ctx, [[x-17*s,y-60*s],[x+19*s,y-60*s],[x+19*s,y-42*s],[x-17*s,y-42*s]], side<0?"#eab963":"#b5dce0", "#263942", 2.5*s);
    line(ctx, [[x+16*s,y-58*s],[x+16*s,y-74*s]], "#d75354", 3*s);
  }
  ctx.fillStyle = "rgba(30,55,56,.13)";
  ctx.fillRect(0,height*.96,width,height*.04);
}

function drawEnemy(ctx, enemy, width, height, time, selected) {
  const at = enemyScreen(enemy,width,height,time);
  const s = at.scale;
  ctx.save(); ctx.translate(at.x,at.y); ctx.scale(s,s);
  const walk = Math.sin(time*(enemy.kind === "skater" ? 9 : 6) + enemy.phase);
  const bruiser = enemy.kind === "bruiser";
  const skater = enemy.kind === "skater";
  const shirt = bruiser ? "#954c9d" : skater ? "#f0a946" : "#e66e62";
  const pants = bruiser ? "#343d69" : skater ? "#4c8a9b" : "#456c87";
  const skin = bruiser ? "#b47a5d" : skater ? "#d39c6b" : "#e0ad7e";
  const outline = "#263642";
  if (selected) {
    ctx.globalAlpha = .7 + .25*Math.sin(time*12);
    circle(ctx,0,-48,bruiser?68:56,"rgba(255,232,129,.17)","#fff1a2",2/s);
    ctx.globalAlpha = 1;
  }
  ctx.save(); ctx.scale(1,.32); circle(ctx,0,0,bruiser?47:38,"rgba(28,52,52,.22)"); ctx.restore();
  if (skater) {
    polygon(ctx,[[-28,3],[31,3],[24,8],[-34,8]],"#b93f63",outline,3);
    circle(ctx,-18,9,5,"#273741"); circle(ctx,19,9,5,"#273741");
  }
  for (const side of [-1,1]) {
    const legX = side*12;
    const stride = walk*side*9;
    line(ctx,[[legX,-45],[legX+stride,-8]],outline,20,"round");
    line(ctx,[[legX,-45],[legX+stride,-8]],pants,14,"round");
    polygon(ctx,[[legX+stride-13,-6],[legX+stride+13,-6],[legX+stride+18,1],[legX+stride-13,1]],"#f5e2c4",outline,3);
  }
  polygon(ctx,[[-29-(bruiser?9:0),-96],[29+(bruiser?9:0),-96],[26,-42],[-26,-42]],shirt,outline,4);
  polygon(ctx,[[-17,-95],[17,-95],[0,-77]],bruiser?"#7c3e8d":"#f7d18c",null);
  for (const side of [-1,1]) {
    const swing = walk*side*8;
    line(ctx,[[side*(bruiser?35:27),-89],[side*(bruiser?41:32)+swing,-53]],outline,16);
    line(ctx,[[side*(bruiser?35:27),-89],[side*(bruiser?41:32)+swing,-53]],skin,11);
    circle(ctx,side*(bruiser?41:32)+swing,-52,7,skin,outline,2);
  }
  circle(ctx,0,-114,22,skin,outline,4);
  polygon(ctx,[[-22,-119],[-20,-135],[-10,-142],[12,-139],[23,-124],[19,-114],[10,-126],[-5,-123],[-18,-116]],bruiser?"#293248":skater?"#394d52":"#684d42",outline,3);
  if (skater) polygon(ctx,[[-25,-130],[17,-139],[28,-127],[-20,-118]],"#4fb4a8",outline,2);
  for (const eyeX of [-8,8]) {
    line(ctx,[[eyeX-4,-114],[eyeX+2,-114]],outline,2);
  }
  line(ctx,[[-5,-103],[7,-103]],outline,2);
  if (bruiser) {
    circle(ctx,0,-82,7,"#f6c35e",outline,2);
    circle(ctx,0,-82,3,"#fff2a7");
  }
  if (enemy.flash>0) {
    ctx.globalAlpha = enemy.flash*2.6;
    polygon(ctx,[[-29,-96],[29,-96],[26,-42],[-26,-42]],"#fff5bd",null);
    circle(ctx,0,-114,22,"#fff5bd");
  }
  ctx.restore();
}

function drawReticle(ctx,scene,width,height,target) {
  const aim = currentAim(scene);
  const x = aim.x*width; const y = aim.y*height;
  const selected = Boolean(target);
  const color = selected ? "#fff0a2" : "#f9f8e3";
  ctx.save();
  ctx.shadowColor = "#172f3b"; ctx.shadowBlur = 6;
  circle(ctx,x,y,selected?20:15,"rgba(15,47,55,.2)",color,2.5);
  for (const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
    line(ctx,[[x+Math.cos(a)*22,y+Math.sin(a)*22],[x+Math.cos(a)*31,y+Math.sin(a)*31]],color,3);
  }
  circle(ctx,x,y,3,color);
  ctx.restore();
  if (selected) {
    ctx.font = "900 13px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.fillStyle = "#fff0a2";
    ctx.fillText("LOCKED",x,y-38);
  }
}

function drawSlingshot(ctx,scene,width,height) {
  const at = slingPixels(scene,width,height);
  const rest = pouchPixels(scene,width,height);
  const size = Math.min(width,height);
  const fork = size*.043;
  const top = at.y-size*.135;
  const draw = scene.draw;
  const pouch = draw ? {x:rest.x+draw.offsetX,y:rest.y+draw.offsetY} : rest;
  const handleWidth = Math.max(13,size*.026);
  ctx.save();
  ctx.shadowColor = "rgba(31,46,47,.25)"; ctx.shadowBlur = 13; ctx.shadowOffsetY = 6;
  line(ctx,[[at.x,at.y+size*.2],[at.x,at.y-size*.035]],"#273b40",handleWidth+8);
  line(ctx,[[at.x,at.y+size*.2],[at.x,at.y-size*.035]],"#a46b3d",handleWidth);
  line(ctx,[[at.x,at.y-size*.035],[at.x-fork,top]],"#273b40",handleWidth+7);
  line(ctx,[[at.x,at.y-size*.035],[at.x-fork,top]],"#bd8448",handleWidth);
  line(ctx,[[at.x,at.y-size*.035],[at.x+fork,top]],"#273b40",handleWidth+7);
  line(ctx,[[at.x,at.y-size*.035],[at.x+fork,top]],"#bd8448",handleWidth);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  line(ctx,[[at.x-fork,top],[pouch.x,pouch.y]],"#25363b",7);
  line(ctx,[[at.x+fork,top],[pouch.x,pouch.y]],"#25363b",7);
  line(ctx,[[at.x-fork,top],[pouch.x,pouch.y]],"#efcc85",3);
  line(ctx,[[at.x+fork,top],[pouch.x,pouch.y]],"#efcc85",3);
  if (draw) circle(ctx,pouch.x,pouch.y,10+draw.power*3,"#6d533f","#2a3a3d",3);
  else circle(ctx,pouch.x,pouch.y,11,"#8e6647","#2a3a3d",3);
  // The foreground hands make the weapon read as first-person rather than a floating prop.
  polygon(ctx,[[at.x-65, height+20],[at.x-52,at.y+size*.14],[at.x-24,at.y+size*.11],[at.x+3,at.y+size*.18],[at.x+26,height+20]],"#426d83","#263b45",5);
  circle(ctx,at.x-6,at.y+size*.1,size*.035,"#d59a6d","#263b45",4);
  for (let i=0;i<3;i++) circle(ctx,at.x+10+i*2,at.y+size*(.065+i*.021),size*.014,"#e3aa79","#263b45",2);
  if (draw) {
    const h = draw.hand;
    polygon(ctx,[[h.x+18,h.y+16],[h.x+47,h.y+38],[h.x+67,height+20],[h.x-39,height+20],[h.x-25,h.y+44]],"#426d83","#263b45",4);
    circle(ctx,h.x+6,h.y+17,22,"#d59a6d","#263b45",3);
    circle(ctx,h.x-6,h.y+3,10,"#e3aa79","#263b45",2);
  }
  ctx.restore();
}

function drawGestureCues(ctx,scene,width,height) {
  if (scene.source === "pointer" || scene.gameOver) return;
  const rest = pouchPixels(scene,width,height);
  if (scene.fistTime >= .1 && !scene.draw) {
    const pulse = .5+.5*Math.sin(scene.time*6);
    circle(ctx,rest.x,rest.y,18+pulse*7,"rgba(255,230,147,.12)","#ffe49a",2);
    ctx.font = "900 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff5c5";
    ctx.strokeStyle = "#29454d"; ctx.lineWidth = 4;
    ctx.strokeText("PINCH HERE",rest.x,rest.y-35);
    ctx.fillText("PINCH HERE",rest.x,rest.y-35);
  }
  if (!scene.pinchPoint) return;
  const x = scene.pinchPoint.x*width;
  const y = scene.pinchPoint.y*height;
  const close = distance({x,y},rest)<Math.min(width,height)*.13;
  circle(ctx,x,y,scene.pinchDown?13:10,"rgba(78,219,207,.23)",close?"#ffe49a":"#8eeadd",3);
  if (scene.pinchDown) circle(ctx,x,y,3,"#fff1b7");
}

function drawEffects(ctx,scene,width,height) {
  for (const shot of scene.shots) {
    const progress = clamp(shot.age/shot.duration,0,1);
    const origin = pouchPixels(scene,width,height);
    const x = origin.x+(shot.aimX-origin.x)*progress;
    const y = origin.y+(shot.aimY-origin.y)*progress - Math.sin(progress*Math.PI)*height*.12;
    circle(ctx,x,y,Math.max(3,12*(1-progress)),"#6f6658","#fff0c1",2);
    for (let i=1;i<=3;i++) {
      const p = Math.max(0,progress-i*.045);
      const px = origin.x+(shot.aimX-origin.x)*p;
      const py = origin.y+(shot.aimY-origin.y)*p - Math.sin(p*Math.PI)*height*.12;
      circle(ctx,px,py,Math.max(1,5-i),"rgba(255,244,192,.5)");
    }
  }
  for (const burst of scene.bursts) {
    ctx.globalAlpha = 1-burst.age/burst.life;
    circle(ctx,burst.x,burst.y,burst.size*(1-burst.age/burst.life),burst.color);
  }
  ctx.globalAlpha = 1;
  for (const popup of scene.popups) {
    ctx.globalAlpha = 1-popup.age/.9;
    ctx.font = "900 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5; ctx.strokeStyle = "#263c43";
    ctx.strokeText(popup.label,popup.x,popup.y);
    ctx.fillStyle = popup.color; ctx.fillText(popup.label,popup.x,popup.y);
  }
  ctx.globalAlpha = 1;
  if (scene.flash>0) {
    ctx.fillStyle = `rgba(255,112,93,${scene.flash*.3})`;
    ctx.fillRect(0,0,width,height);
  }
}

function render(ctx,scene,width,height) {
  ctx.clearRect(0,0,width,height);
  ctx.save();
  if (scene.shake>.1) ctx.translate((Math.random()-.5)*scene.shake,(Math.random()-.5)*scene.shake);
  drawStreet(ctx,width,height,scene.time);
  const target = aimTarget(scene,width,height);
  [...scene.enemies].sort((a,b)=>a.depth-b.depth).forEach((enemy)=>drawEnemy(ctx,enemy,width,height,scene.time,enemy.id===target?.id));
  drawReticle(ctx,scene,width,height,target);
  drawEffects(ctx,scene,width,height);
  drawSlingshot(ctx,scene,width,height);
  drawGestureCues(ctx,scene,width,height);
  ctx.restore();
}

function hudFrom(scene,input) {
  const camera = input.source !== "pointer";
  let instruction = "AIM AT A GOON · DRAG DOWN · RELEASE";
  if (camera) {
    if (scene.fistTime < .1) instruction = "MAKE A FIST TO HOLD THE SLINGSHOT";
    else if (scene.draw) instruction = "PULL BACK · OPEN YOUR PINCH TO FIRE";
    else if (!scene.pinchPoint) instruction = "SHOW YOUR OTHER HAND · PINCH THE POUCH";
    else instruction = "PINCH THE POUCH · PULL BACK";
  } else if (scene.draw) instruction = "DRAG DOWN FOR POWER · RELEASE TO FIRE";
  return {
    score:scene.score, combo:scene.combo, bestCombo:scene.bestCombo, hearts:scene.hearts, wave:scene.wave,
    power:scene.draw?.power??0, drawing:Boolean(scene.draw),
    instruction, message:scene.messageTime>0?scene.message:"", gameOver:scene.gameOver,
    camera, ready:camera?scene.fistTime>=.1:true, restartHold:scene.restartHold,
  };
}

export default function SlingshotStreet({ inputRef, paused }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(newGame());
  const [hud,setHud] = useState(()=>hudFrom(sceneRef.current,{source:"camera"}));

  useDemoFrame((seconds)=>{
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(1,canvas.clientWidth);
    const height = Math.max(1,canvas.clientHeight);
    const dpr = Math.min(2,window.devicePixelRatio||1);
    const pixelWidth = Math.round(width*dpr);
    const pixelHeight = Math.round(height*dpr);
    if (canvas.width!==pixelWidth||canvas.height!==pixelHeight) {canvas.width=pixelWidth;canvas.height=pixelHeight;}
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const scene = sceneRef.current;
    const input = inputRef.current;
    stepGame(scene,input,seconds,width,height);
    render(ctx,scene,width,height);
    scene.hudTime += seconds;
    if (scene.hudTime>.09) {scene.hudTime=0;setHud(hudFrom(scene,input));}
  },paused);

  const restart = (event)=>{
    event?.stopPropagation();
    sceneRef.current=newGame();
    setHud(hudFrom(sceneRef.current,inputRef.current));
  };

  return <div className="street-game">
    <style>{`
      .street-game{position:absolute;inset:0;overflow:hidden;color:#f8f5d9;font-family:system-ui,sans-serif;pointer-events:none}
      .street-game canvas{display:block;width:100%;height:100%}
      .street-hud{position:absolute;top:90px;left:24px;right:24px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;text-shadow:0 2px 1px #20343d,0 3px 8px #20343d}
      .street-hud-card{background:rgba(21,53,64,.77);border:2px solid rgba(254,243,199,.8);border-radius:14px;padding:10px 15px;box-shadow:0 6px 0 rgba(21,49,58,.23)}
      .street-hud small{display:block;color:#f5d992;font-size:11px;font-weight:900;letter-spacing:.17em}
      .street-score{font-size:30px;line-height:1;font-weight:1000;letter-spacing:.04em}
      .street-combo{color:#ffe28a;font-size:13px;font-weight:900}
      .street-right{text-align:right;min-width:110px}
      .street-hearts{color:#ff8f8e;font-size:25px;letter-spacing:3px;line-height:1.1}
      .street-wave{font-size:13px;font-weight:900;letter-spacing:.1em}
      .street-instruction{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);min-width:min(580px,calc(100% - 56px));padding:12px 22px;background:rgba(25,57,66,.88);border:2px solid #fff1c0;border-radius:12px;text-align:center;font-size:14px;font-weight:1000;letter-spacing:.11em;box-shadow:0 5px 0 rgba(24,49,55,.3);white-space:nowrap}
      .street-message{position:absolute;left:50%;top:25%;transform:translateX(-50%) rotate(-3deg);color:#fff0a0;font-size:clamp(27px,5vw,55px);font-weight:1000;white-space:nowrap;text-shadow:4px 4px 0 #2b4850,-2px -2px 0 #2b4850,0 8px 10px rgba(28,50,55,.45)}
      .street-power{position:absolute;left:50%;bottom:122px;transform:translateX(-50%);width:min(290px,55vw);height:18px;background:#294851;border:3px solid #fff1c0;border-radius:99px;overflow:hidden;box-shadow:0 4px 0 #203943}
      .street-power>i{display:block;height:100%;background:linear-gradient(90deg,#6fd1b8,#ffd668,#ff8b6e);border-radius:99px}
      .street-power-label{position:absolute;left:50%;bottom:145px;transform:translateX(-50%);font-size:12px;font-weight:1000;letter-spacing:.18em;text-shadow:0 2px 4px #253e46}
      .street-over{position:absolute;inset:0;background:rgba(18,43,51,.72);display:grid;place-items:center;pointer-events:auto}
      .street-over-card{width:min(420px,calc(100% - 40px));padding:30px;background:#f8e8be;color:#28434a;border:5px solid #2b454b;outline:5px solid #f8e8be;border-radius:19px;text-align:center;box-shadow:0 18px 0 rgba(15,34,41,.45)}
      .street-over-card h2{margin:0 0 8px;font-size:clamp(34px,5vw,50px);line-height:1;letter-spacing:-.05em}
      .street-over-card p{margin:7px 0;font-size:17px;font-weight:800}
      .street-over-card strong{font-size:33px;color:#df6f61}
      .street-over-card button{margin-top:18px;background:#f09b59;color:#263c43;border:3px solid #263c43;border-radius:11px;padding:12px 24px;font:1000 17px system-ui,sans-serif;cursor:pointer;box-shadow:0 5px 0 #263c43}
      .street-over-card button:hover{transform:translateY(2px);box-shadow:0 3px 0 #263c43}
      @media(max-width:650px){.street-hud{top:120px;left:12px;right:12px}.street-hud-card{padding:7px 10px}.street-score{font-size:22px}.street-instruction{bottom:65px;font-size:10px;letter-spacing:.06em;padding:10px}.street-hearts{font-size:19px}}
    `}</style>
    <canvas ref={canvasRef} aria-label="First person slingshot game on a suburban street" />
    <div className="street-hud">
      <div className="street-hud-card"><small>SCORE</small><div className="street-score">{hud.score.toLocaleString()}</div>{hud.combo>1?<div className="street-combo">{hud.combo}× COMBO</div>:null}</div>
      <div className="street-hud-card street-right"><small>WAVE {hud.wave}</small><div className="street-hearts">{"♥".repeat(hud.hearts)}<span style={{color:"#82999a"}}>{"♡".repeat(4-hud.hearts)}</span></div><div className="street-wave">STREET DEFENSE</div></div>
    </div>
    {hud.message&&!hud.gameOver?<div className="street-message">{hud.message}</div>:null}
    {hud.drawing?<><div className="street-power-label">POWER {Math.round(hud.power*100)}%</div><div className="street-power"><i style={{width:`${hud.power*100}%`}} /></div></>:null}
    {!hud.gameOver?<div className="street-instruction">{hud.instruction}</div>:null}
    {hud.gameOver?<div className="street-over"><div className="street-over-card"><h2>STREET OVERRUN!</h2><p>You defended the block for</p><strong>{hud.score.toLocaleString()} POINTS</strong><p>Wave {hud.wave} · Best combo {hud.bestCombo}×</p><button type="button" onPointerDown={(event)=>event.stopPropagation()} onClick={restart}>PLAY AGAIN ↗</button>{hud.camera?<p>Camera: hold a fist and pinch your other hand to retry {hud.restartHold>0?`${Math.round(hud.restartHold/.8*100)}%`:""}</p>:null}</div></div>:null}
  </div>;
}
