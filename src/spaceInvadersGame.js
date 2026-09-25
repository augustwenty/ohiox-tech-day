const WIDTH = 960;
const HEIGHT = 600;
const ENEMY_WIDTH = 62;
const ENEMY_HEIGHT = 34;
const SHIP_Y = 540;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function createEnemies() {
  return Array.from({ length: 32 }, (_, index) => {
    const row = Math.floor(index / 8);
    const column = index % 8;
    return {
      id: `enemy-${index}`,
      row,
      x: 130 + column * 92,
      y: 76 + row * 58,
      width: ENEMY_WIDTH,
      height: ENEMY_HEIGHT,
      alive: true,
    };
  });
}

export function createGame(score = 0) {
  return {
    ship: { x: WIDTH / 2, y: SHIP_Y, width: 82, height: 38 },
    enemies: createEnemies(),
    playerShots: [],
    enemyShots: [],
    direction: 1,
    fireCooldown: 0,
    enemyCooldown: 0.8,
    restartCooldown: 0.7,
    nextId: 1,
    score,
    status: "playing",
    message: "Pinch to fire",
  };
}

export function stepGame(state, seconds, targetX, action, random = Math.random) {
  const dt = clamp(seconds, 0, 0.05);
  if (dt === 0) return state;
  if (state.status !== "playing") {
    const restartCooldown = Math.max(0, state.restartCooldown - dt);
    return action && restartCooldown === 0
      ? createGame(state.score)
      : { ...state, restartCooldown };
  }

  const ship = {
    ...state.ship,
    x: state.ship.x + (clamp(targetX, 48, WIDTH - 48) - state.ship.x) * (1 - Math.exp(-18 * dt)),
  };
  let fireCooldown = Math.max(0, state.fireCooldown - dt);
  let enemyCooldown = Math.max(0, state.enemyCooldown - dt);
  let nextId = state.nextId;
  let playerShots = state.playerShots.map((shot) => ({ ...shot, y: shot.y - 520 * dt }));
  let enemyShots = state.enemyShots.map((shot) => ({ ...shot, y: shot.y + 245 * dt }));
  let enemies = state.enemies.map((enemy) => ({ ...enemy }));

  if (action && fireCooldown === 0) {
    playerShots.push({ id: `player-${nextId++}`, x: ship.x - 4, y: ship.y - 28, width: 8, height: 22 });
    fireCooldown = 0.24;
  }

  const alive = enemies.filter((enemy) => enemy.alive);
  const left = Math.min(...alive.map((enemy) => enemy.x));
  const right = Math.max(...alive.map((enemy) => enemy.x + enemy.width));
  let direction = state.direction;
  const move = direction * 74 * dt;
  if (left + move < 22 || right + move > WIDTH - 22) {
    direction *= -1;
    enemies = enemies.map((enemy) => enemy.alive ? { ...enemy, y: enemy.y + 26 } : enemy);
  } else {
    enemies = enemies.map((enemy) => enemy.alive ? { ...enemy, x: enemy.x + move } : enemy);
  }

  if (enemyCooldown === 0 && alive.length > 0) {
    const shooter = alive[Math.floor(random() * alive.length)];
    enemyShots.push({
      id: `enemy-shot-${nextId++}`,
      x: shooter.x + shooter.width / 2 - 4,
      y: shooter.y + shooter.height,
      width: 8,
      height: 20,
    });
    enemyCooldown = 0.75 + random() * 0.5;
  }

  let score = state.score;
  playerShots = playerShots.filter((shot) => {
    if (shot.y + shot.height < 0) return false;
    const enemy = enemies.find((candidate) => candidate.alive && overlaps(shot, candidate));
    if (!enemy) return true;
    enemy.alive = false;
    score += 125;
    return false;
  });
  enemyShots = enemyShots.filter((shot) => shot.y < HEIGHT + shot.height);

  const shipRect = { x: ship.x - ship.width / 2, y: ship.y - ship.height / 2, width: ship.width, height: ship.height };
  const hitShip = enemyShots.some((shot) => overlaps(shot, shipRect));
  const invaded = enemies.some((enemy) => enemy.alive && enemy.y + enemy.height >= ship.y - 38);
  const cleared = enemies.every((enemy) => !enemy.alive);
  const status = cleared ? "cleared" : hitShip || invaded ? "gameover" : "playing";

  return {
    ...state,
    ship,
    enemies,
    playerShots,
    enemyShots,
    direction,
    fireCooldown,
    enemyCooldown,
    nextId,
    score,
    status,
    restartCooldown: status === "playing" ? state.restartCooldown : 0.7,
    message: cleared ? "Wave cleared! Pinch to restart." : status === "gameover" ? "Game over. Pinch to restart." : "Pinch to fire",
  };
}
