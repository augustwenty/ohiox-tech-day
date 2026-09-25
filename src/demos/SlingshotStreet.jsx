import { useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "slingshot-street",
  title: "Slingshot Street",
  kind: "GAME",
  order: 6,
  icon: "🎯",
  description: "Aim with one hand, pinch to charge your slingshot, and defend the block from zombies.",
  instructions: "Camera: move one hand to aim, pinch up to 2 seconds, release to fire. Pointer: aim, hold, release.",
};

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = (landmarks, index) => landmarks?.[index];

function handPose(hand) {
  const landmarks = hand.landmarks;
  if (!landmarks || landmarks.length < 21 || ![0, 4, 5, 8, 9, 13, 17].every((joint) => point(landmarks, joint))) return null;
  const palm = {
    x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
    y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5,
  };
  const palmWidth = Math.max(0.045, distance(landmarks[5], landmarks[17]));
  return {
    handedness: hand.handedness,
    palm,
    pinchDistance: distance(landmarks[4], landmarks[8]),
    pinchEnter: clamp(palmWidth * 0.46, 0.035, 0.11),
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
  const kind = wave > 1 && Math.random() < 0.23 ? "tank" : Math.random() < 0.27 ? "runner" : "shambler";
  return {
    id,
    kind,
    lane: (Math.random() * 1.7 - 0.85),
    depth,
    speed: (kind === "runner" ? 0.09 : kind === "tank" ? 0.052 : 0.067) * (1 + Math.min(0.5, (wave - 1) * 0.09)),
    hp: kind === "tank" ? 2 : 1,
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
    spawnIn: 3.2,
    sling: { x: 0.5, y: 0.79 },
    aim: { x: 0.5, y: 0.5 },
    handPoint: null,
    handSide: null,
    handTime: 0,
    handLost: 0,
    pinchDown: false,
    draw: null,
    pointerWasDown: false,
    source: null,
    started: false,
    flash: 0,
    shake: 0,
    message: "ZOMBIES ON THE BLOCK!",
    messageTime: 3,
    hudTime: 0,
    gameOver: false,
    restartHold: 0,
    restartArmed: false,
  };
}

function enemyScreen(enemy, width, height, time) {
  const depth = clamp(enemy.depth, 0, 1.08);
  const sway = Math.sin(time * (enemy.kind === "runner" ? 6 : 3.6) + enemy.phase) * (5 + depth * 15);
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

function aimTarget(scene, width, height) {
  const aim = scene.aim;
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

function chargeDraw(scene, seconds, width, height) {
  const draw = scene.draw;
  if (!draw) return;
  draw.held = Math.min(2, draw.held + seconds);
  draw.power = draw.held / 2;
  draw.offsetY = Math.min(width, height) * (0.025 + draw.power * 0.14);
}

function fire(scene, width, height) {
  const draw = scene.draw;
  if (!draw) return;
  scene.draw = null;
  if (draw.held < 0.06) {
    scene.message = "HOLD TO CHARGE!";
    scene.messageTime = 0.9;
    return;
  }
  const power = Math.max(0.12, draw.power);
  const aim = { ...scene.aim };
  const target = aimTarget(scene, width, height);
  const origin = pouchPixels(scene, width, height);
  origin.y += draw.offsetY;
  scene.shots.push({ x: origin.x, y: origin.y, aimX: aim.x * width, aimY: aim.y * height, age: 0, duration: 0.6 - 0.45 * power, power, targetId: target?.id ?? null });
  if (scene.shots.length > 8) scene.shots.shift();
  scene.shake = Math.max(scene.shake, 4 + power * 6);
  scene.message = power >= 0.98 ? "MAX POWER!" : power > 0.65 ? "BIG SHOT!" : "ROCK AWAY!";
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
  addBurst(scene, at.x, at.y - 48 * at.scale, enemy.kind === "tank" ? "#d2f374" : "#a4ead0", 16);
  if (enemy.hp <= 0) {
    scene.enemies = scene.enemies.filter((item) => item.id !== enemy.id);
    scene.combo = Math.min(5, scene.combo + 1);
    scene.bestCombo = Math.max(scene.bestCombo, scene.combo);
    scene.defeated += 1;
    scene.wave = 1 + Math.floor(scene.defeated / 8);
    const points = 100 * scene.combo + (enemy.kind === "tank" ? 100 : 0);
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
  const hand = poses.find((pose) => pose.handedness && pose.handedness === scene.handSide) ?? poses[0];
  if (hand) {
    scene.handSide = hand.handedness;
    scene.handPoint = smoothPoint(scene.handPoint, hand.palm, seconds, 13);
    scene.handTime = Math.min(0.25, scene.handTime + seconds);
    scene.handLost = 0;
  } else {
    scene.handLost += seconds;
    if (scene.handLost > 0.25) {
      scene.handTime = 0;
      scene.draw = null;
      scene.pinchDown = false;
    }
  }
  if (scene.handPoint) {
    scene.sling.x = clamp(scene.handPoint.x, 0.12, 0.88);
    scene.sling.y = clamp(scene.handPoint.y + 0.1, 0.62, 0.85);
    scene.aim.x = clamp(scene.handPoint.x, 0.05, 0.95);
    scene.aim.y = clamp(scene.handPoint.y - 0.08, 0.18, 0.75);
  }
  const pinched = Boolean(hand && hand.pinchDistance < hand.pinchEnter * (scene.pinchDown ? 1.35 : 1));
  scene.pinchDown = pinched;
  if (scene.draw) {
    if (!hand) {
      scene.draw.missing = (scene.draw.missing ?? 0) + seconds;
      if (scene.draw.missing > 0.25) scene.draw = null;
    } else if (!pinched) {
      scene.draw.release = (scene.draw.release ?? 0) + seconds;
      if (scene.draw.release > 0.06) fire(scene, width, height);
    } else {
      scene.draw.release = 0;
      scene.draw.missing = 0;
      chargeDraw(scene, seconds, width, height);
    }
  } else if (scene.handTime >= 0.1 && pinched) {
    scene.draw = { held: 0, power: 0, offsetY: 0, release: 0, missing: 0 };
  }
}

function pointerControls(scene, input, seconds, width, height) {
  const down = Boolean(input.action);
  if (input.active) scene.aim = { x: clamp(input.x, 0.05, 0.95), y: clamp(input.y, 0.17, 0.75) };
  scene.sling = { x: clamp(scene.aim.x, 0.12, 0.88), y: clamp(scene.aim.y + 0.24, 0.62, 0.85) };
  if (down && !scene.pointerWasDown) {
    scene.draw = { held: 0, power: 0, offsetY: 0 };
  }
  if (down) chargeDraw(scene, seconds, width, height);
  if (!down && scene.pointerWasDown && scene.draw) fire(scene, width, height);
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
    scene.handPoint = null;
    scene.handTime = 0;
  }
  if (scene.gameOver) {
    if (input.source !== "pointer") {
      const hand = (input.hands ?? []).map(handPose).filter(Boolean)[0];
      const pinched = Boolean(hand && hand.pinchDistance < hand.pinchEnter);
      if (!pinched) scene.restartArmed = true;
      scene.restartHold = scene.restartArmed && pinched ? scene.restartHold + dt : 0;
      if (scene.restartHold >= 0.8) Object.assign(scene, newGame());
    }
    return;
  }

  if (input.source === "pointer") pointerControls(scene, input, dt, width, height);
  else cameraControls(scene, input, dt, width, height);
  if (scene.draw) scene.started = true;
  const playing = scene.started && (input.source === "pointer" || scene.handTime >= 0.1);
  if (!playing) return;

  scene.spawnIn -= dt;
  if (scene.spawnIn <= 0) {
    if (scene.enemies.length < 9) scene.enemies.push(makeEnemy(scene.nextId++, scene.wave));
    scene.spawnIn = Math.max(1.25, 3.2 - scene.wave * 0.12) + Math.random() * 0.3;
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
    scene.message = scene.hearts ? "ZOMBIE BREACH!" : "STREET OVERRUN!";
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
  const walk = Math.sin(time*(enemy.kind === "runner" ? 9 : 5.5) + enemy.phase);
  const tank = enemy.kind === "tank";
  const runner = enemy.kind === "runner";
  const shirt = tank ? "#755879" : runner ? "#c87d4f" : "#718e85";
  const pants = tank ? "#4d536e" : runner ? "#4e7082" : "#536778";
  const skin = tank ? "#9eae73" : runner ? "#a4ca91" : "#b6c9a0";
  const outline = "#263642";
  if (selected) {
    ctx.globalAlpha = .7 + .25*Math.sin(time*12);
    circle(ctx,0,-48,tank?68:56,"rgba(255,232,129,.17)","#fff1a2",2/s);
    ctx.globalAlpha = 1;
  }
  ctx.save(); ctx.scale(1,.32); circle(ctx,0,0,tank?47:38,"rgba(28,52,52,.22)"); ctx.restore();
  for (const side of [-1,1]) {
    const legX = side*12;
    const stride = walk*side*(runner?13:8);
    line(ctx,[[legX,-45],[legX+stride,-8]],outline,tank?23:20);
    line(ctx,[[legX,-45],[legX+stride,-8]],pants,tank?17:14);
    polygon(ctx,[[legX+stride-13,-6],[legX+stride+13,-6],[legX+stride+18,1],[legX+stride-13,1]],side<0?"#433f4f":"#58646c",outline,3);
    line(ctx,[[legX+stride-8,-6],[legX+stride+9,-6]],"#b5b8a3",2);
  }
  polygon(ctx,[[-29-(tank?11:0),-97],[29+(tank?11:0),-97],[29,-47],[17,-42],[9,-51],[0,-43],[-10,-49],[-21,-41],[-29,-47]],shirt,outline,4);
  polygon(ctx,[[-17,-96],[17,-96],[0,-77]],"#3b5d5a",null);
  polygon(ctx,[[-10,-73],[5,-77],[12,-54],[2,-59]],"#4e7168",null);
  line(ctx,[[-20,-58],[-12,-51],[-6,-56]],"#344a51",3);
  for (const side of [-1,1]) {
    const reach = 5 + walk*side*4;
    line(ctx,[[side*(tank?37:29),-89],[side*(tank?51:43),-78],[side*(tank?56:50)+reach,-62]],outline,tank?18:15);
    line(ctx,[[side*(tank?37:29),-89],[side*(tank?51:43),-78],[side*(tank?56:50)+reach,-62]],skin,tank?13:10);
    circle(ctx,side*(tank?56:50)+reach,-61,7,skin,outline,2);
    for (let claw=0;claw<3;claw++) line(ctx,[[side*(tank?58:52)+reach,-64+claw*3],[side*(tank?68:61)+reach,-68+claw*4]],outline,2);
  }
  ctx.save(); ctx.translate(0,-114); ctx.rotate(walk*.035);
  circle(ctx,0,0,tank?25:23,skin,outline,4);
  polygon(ctx,[[-23,-5],[-22,-21],[-10,-29],[7,-27],[17,-21],[23,-8],[15,-15],[5,-13],[-4,-19],[-15,-10]],tank?"#3c4145":runner?"#384c48":"#4e5550",outline,3);
  for (const eyeX of [-9,9]) {
    circle(ctx,eyeX,-1,7,"#3c4e4e");
    circle(ctx,eyeX+1,-1,3,"#fff49d");
  }
  polygon(ctx,[[-10,10],[-4,7],[4,8],[11,11],[7,18],[-7,18]],"#3d4948",outline,2);
  for (const toothX of [-5,0,5]) line(ctx,[[toothX,10],[toothX+1,14]],"#f3ebc5",2);
  line(ctx,[[-20,7],[-14,9],[-18,13]],"#617b6d",2);
  ctx.restore();
  if (tank) {
    polygon(ctx,[[-17,-83],[-8,-88],[0,-79],[-10,-70]],"#a8b988",outline,2);
    line(ctx,[[12,-68],[22,-61]],"#2d4548",3);
  }
  if (enemy.flash>0) {
    ctx.globalAlpha = enemy.flash*2.6;
    polygon(ctx,[[-29,-96],[29,-96],[26,-42],[-26,-42]],"#fff5bd",null);
    circle(ctx,0,-114,23,"#fff5bd");
  }
  ctx.restore();
}

function drawReticle(ctx,scene,width,height,target) {
  const aim = scene.aim;
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
  const pouch = draw ? {x:rest.x,y:rest.y+draw.offsetY} : rest;
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
  if (draw) {
    circle(ctx,pouch.x,pouch.y,19+draw.power*9,"rgba(255,227,142,.12)","#ffe49a",2);
    ctx.beginPath();
    ctx.arc(pouch.x,pouch.y,26+draw.power*8,-Math.PI/2,-Math.PI/2+TAU*draw.power);
    ctx.strokeStyle="#ffca66";ctx.lineWidth=4;ctx.stroke();
  }
  // One foreground hand carries the slingshot while its pinch charges the pouch.
  polygon(ctx,[[at.x-65, height+20],[at.x-52,at.y+size*.14],[at.x-24,at.y+size*.11],[at.x+3,at.y+size*.18],[at.x+26,height+20]],"#426d83","#263b45",5);
  circle(ctx,at.x-6,at.y+size*.1,size*.035,"#d59a6d","#263b45",4);
  for (let i=0;i<3;i++) circle(ctx,at.x+10+i*2,at.y+size*(.065+i*.021),size*.014,"#e3aa79","#263b45",2);
  ctx.restore();
}

function drawGestureCues(ctx,scene,width,height) {
  if (scene.source === "pointer" || scene.gameOver || !scene.handPoint || scene.handTime < .1) return;
  const x = scene.handPoint.x*width;
  const y = scene.handPoint.y*height;
  circle(ctx,x,y,scene.pinchDown?18:13,"rgba(78,219,207,.15)",scene.pinchDown?"#ffe49a":"#8eeadd",3);
  circle(ctx,x,y,3,scene.pinchDown?"#ffe49a":"#8eeadd");
}

function drawEffects(ctx,scene,width,height) {
  for (const shot of scene.shots) {
    const progress = clamp(shot.age/shot.duration,0,1);
    const origin = shot;
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
  let instruction = "AIM AT ZOMBIES · HOLD TO CHARGE · RELEASE TO FIRE";
  if (camera) {
    if (scene.handTime < .1) instruction = "SHOW ONE HAND TO AIM";
    else if (scene.draw) instruction = "HOLD PINCH TO CHARGE · RELEASE TO FIRE";
    else instruction = "MOVE HAND TO AIM · PINCH TO CHARGE";
  } else if (scene.draw) instruction = "HOLD TO CHARGE · RELEASE TO FIRE";
  return {
    score:scene.score, combo:scene.combo, bestCombo:scene.bestCombo, hearts:scene.hearts, wave:scene.wave,
    power:scene.draw?.power??0, chargeTime:scene.draw?.held??0, drawing:Boolean(scene.draw),
    instruction, message:scene.messageTime>0?scene.message:"", gameOver:scene.gameOver,
    camera, restartHold:scene.restartHold,
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
      .street-power{position:absolute;left:50%;top:192px;transform:translateX(-50%);width:min(290px,55vw);height:18px;background:#294851;border:3px solid #fff1c0;border-radius:99px;overflow:hidden;box-shadow:0 4px 0 #203943}
      .street-power>i{display:block;height:100%;background:linear-gradient(90deg,#6fd1b8,#ffd668,#ff8b6e);border-radius:99px}
      .street-power-label{position:absolute;left:50%;top:166px;transform:translateX(-50%);font-size:12px;font-weight:1000;letter-spacing:.12em;white-space:nowrap;text-shadow:0 2px 4px #253e46}
      .street-over{position:absolute;inset:0;background:rgba(18,43,51,.72);display:grid;place-items:center;pointer-events:auto}
      .street-over-card{width:min(420px,calc(100% - 40px));padding:30px;background:#f8e8be;color:#28434a;border:5px solid #2b454b;outline:5px solid #f8e8be;border-radius:19px;text-align:center;box-shadow:0 18px 0 rgba(15,34,41,.45)}
      .street-over-card h2{margin:0 0 8px;font-size:clamp(34px,5vw,50px);line-height:1;letter-spacing:-.05em}
      .street-over-card p{margin:7px 0;font-size:17px;font-weight:800}
      .street-over-card strong{font-size:33px;color:#df6f61}
      .street-over-card button{margin-top:18px;background:#f09b59;color:#263c43;border:3px solid #263c43;border-radius:11px;padding:12px 24px;font:1000 17px system-ui,sans-serif;cursor:pointer;box-shadow:0 5px 0 #263c43}
      .street-over-card button:hover{transform:translateY(2px);box-shadow:0 3px 0 #263c43}
      @media(max-width:650px){.street-hud{top:120px;left:12px;right:12px}.street-hud-card{padding:7px 10px}.street-score{font-size:22px}.street-instruction{bottom:65px;font-size:10px;letter-spacing:.06em;padding:10px}.street-hearts{font-size:19px}.street-power-label{top:206px;font-size:10px}.street-power{top:228px}}
    `}</style>
    <canvas ref={canvasRef} aria-label="First person slingshot game on a suburban street" />
    <div className="street-hud">
      <div className="street-hud-card"><small>SCORE</small><div className="street-score">{hud.score.toLocaleString()}</div>{hud.combo>1?<div className="street-combo">{hud.combo}× COMBO</div>:null}</div>
      <div className="street-hud-card street-right"><small>WAVE {hud.wave}</small><div className="street-hearts">{"♥".repeat(hud.hearts)}<span style={{color:"#82999a"}}>{"♡".repeat(4-hud.hearts)}</span></div><div className="street-wave">STREET DEFENSE</div></div>
    </div>
    {hud.message&&!hud.gameOver&&!hud.drawing?<div className="street-message">{hud.message}</div>:null}
    {hud.drawing?<><div className="street-power-label">CHARGE {Math.round(hud.power*100)}% · {hud.chargeTime.toFixed(1)} / 2.0s · RELEASE TO FIRE</div><div className="street-power"><i style={{width:`${hud.power*100}%`}} /></div></>:null}
    {!hud.gameOver&&!hud.drawing?<div className="street-instruction">{hud.instruction}</div>:null}
    {hud.gameOver?<div className="street-over"><div className="street-over-card"><h2>STREET OVERRUN!</h2><p>You defended the block for</p><strong>{hud.score.toLocaleString()} POINTS</strong><p>Wave {hud.wave} · Best combo {hud.bestCombo}×</p><button type="button" onPointerDown={(event)=>event.stopPropagation()} onClick={restart}>PLAY AGAIN ↗</button>{hud.camera?<p>Camera: release, then hold one pinch to retry {hud.restartHold>0?`${Math.round(hud.restartHold/.8*100)}%`:""}</p>:null}</div></div>:null}
  </div>;
}
