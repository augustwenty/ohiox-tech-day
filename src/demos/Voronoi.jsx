import { useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "voronoi",
  title: "Voronoi",
  kind: "VISUAL",
  order: 2,
  icon: "🔷",
  description: "Turn your fingertips into a shifting stained-glass mosaic.",
  instructions: "Move your hand or pointer. Each fingertip becomes a colored region.",
};

const COLORS = ["#ff557f", "#ffb84c", "#ffe66d", "#58e6ad", "#4ec5ff", "#9d7bff"];

function clip(polygon, nx, ny, offset) {
  const result = [];
  const inside = (point) => nx * point.x + ny * point.y <= offset + 1e-6;
  const intersection = (start, end) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const amount = (offset - nx * start.x - ny * start.y) / (nx * dx + ny * dy);
    return { x: start.x + dx * amount, y: start.y + dy * amount };
  };
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (inside(start) && inside(end)) result.push(end);
    else if (inside(start)) result.push(intersection(start, end));
    else if (inside(end)) result.push(intersection(start, end), end);
  }
  return result;
}

function cell(site, sites) {
  let polygon = [{ x: 0, y: 0 }, { x: 960, y: 0 }, { x: 960, y: 600 }, { x: 0, y: 600 }];
  for (const other of sites) {
    if (other.id === site.id) continue;
    const nx = other.x - site.x;
    const ny = other.y - site.y;
    if (Math.abs(nx) + Math.abs(ny) < 1e-6) continue;
    polygon = clip(polygon, nx, ny, (other.x ** 2 + other.y ** 2 - site.x ** 2 - site.y ** 2) / 2);
  }
  return polygon;
}

function pointerSites(input) {
  const x = input.x * 960;
  const y = input.y * 600;
  return [
    { id: "center", x, y },
    { id: "left", x: Math.max(0, x - 180), y: Math.min(600, y + 105) },
    { id: "right", x: Math.min(960, x + 180), y: Math.min(600, y + 105) },
    { id: "top", x, y: Math.max(0, y - 180) },
    { id: "opposite", x: 960 - x, y: 600 - y },
  ];
}

export default function Voronoi({ inputRef, paused }) {
  const [sites, setSites] = useState(() => pointerSites({ x: 0.5, y: 0.5 }));
  useDemoFrame(() => {
    const input = inputRef.current;
    if (!input.active) return;
    setSites(input.tips.length > 1
      ? input.tips.map((tip) => ({ id: tip.id, x: tip.x * 960, y: tip.y * 600 }))
      : pointerSites(input));
  }, paused);

  return (
    <svg className="voronoi" viewBox="0 0 960 600" preserveAspectRatio="none" aria-label="Interactive Voronoi mosaic">
      {sites.map((site, index) => <polygon key={site.id} points={cell(site, sites).map((point) => `${point.x},${point.y}`).join(" ")} fill={COLORS[index % COLORS.length]} fillOpacity=".72" stroke="white" strokeWidth="3" />)}
      {sites.map((site) => <circle key={`${site.id}-dot`} cx={site.x} cy={site.y} r="8" fill="white" />)}
    </svg>
  );
}
