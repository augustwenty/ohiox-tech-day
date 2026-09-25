import test from "node:test";
import assert from "node:assert/strict";
import { emptyInput, handInput, moveInput, pointerInput } from "../src/input.js";

test("camera input includes the primary point, pinch, and all tips", () => {
  const result = handInput([{ index: { x: .25, y: .75 }, pinchDistance: .03, tips: [{ x: .2, y: .7 }, { x: .25, y: .75 }] }]);
  assert.equal(result.pinching, true);
  assert.equal(result.input.action, true);
  assert.deepEqual([result.input.x, result.input.y], [.25, .75]);
  assert.equal(result.input.tips.length, 2);
});

test("pointer and keyboard input stay normalized", () => {
  const pointer = pointerInput({ clientX: 60, clientY: 45 }, { left: 10, top: 20, width: 100, height: 50 }, true);
  assert.deepEqual([pointer.x, pointer.y, pointer.action], [.5, .5, true]);
  assert.ok(moveInput(emptyInput("pointer"), "ArrowRight").x > .5);
});
