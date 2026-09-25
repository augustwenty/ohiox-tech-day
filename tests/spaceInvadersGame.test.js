import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepGame } from "../src/spaceInvadersGame.js";

test("the ship follows input and firing respects cooldown", () => {
  const initial = createGame();
  const fired = stepGame(initial, .05, 800, true, () => .5);
  const held = stepGame(fired, .05, 800, true, () => .5);
  assert.ok(fired.ship.x > initial.ship.x);
  assert.equal(fired.playerShots.length, 1);
  assert.equal(held.playerShots.length, 1);
});

test("action restarts a completed game while preserving score", () => {
  const complete = { ...createGame(500), status: "cleared", restartCooldown: 0 };
  const restarted = stepGame(complete, .05, 480, true, () => .5);
  assert.equal(restarted.status, "playing");
  assert.equal(restarted.score, 500);
  assert.equal(restarted.enemies.length, 32);
});
