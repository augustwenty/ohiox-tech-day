const clamp = (value) => Math.max(0, Math.min(1, value));

export function emptyInput(source = "camera") {
  return { active: source === "pointer", source, x: 0.5, y: 0.5, action: false, tips: [] };
}

export function handInput(hands, wasPinching = false) {
  const primary = hands[0];
  if (!primary) return { input: emptyInput(), pinching: false };

  const pinching = wasPinching
    ? primary.pinchDistance < 0.06
    : primary.pinchDistance < 0.045;
  return {
    pinching,
    input: {
      active: true,
      source: "camera",
      x: primary.index.x,
      y: primary.index.y,
      action: pinching,
      tips: hands.flatMap((hand, handIndex) =>
        hand.tips.map((tip, tipIndex) => ({
          id: `${handIndex}-${tipIndex}`,
          x: tip.x,
          y: tip.y,
        })),
      ),
    },
  };
}

export function pointerInput(event, rect, action = false) {
  return {
    ...emptyInput("pointer"),
    x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((event.clientY - rect.top) / Math.max(1, rect.height)),
    action,
  };
}

export function moveInput(input, key) {
  const dx = key === "ArrowLeft" ? -0.035 : key === "ArrowRight" ? 0.035 : 0;
  const dy = key === "ArrowUp" ? -0.035 : key === "ArrowDown" ? 0.035 : 0;
  return { ...input, active: true, source: "pointer", x: clamp(input.x + dx), y: clamp(input.y + dy) };
}
