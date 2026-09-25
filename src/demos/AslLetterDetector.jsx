import { useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "asl-letter-detector",
  title: "ASL Letter Detector",
  kind: "GAME",
  order: 3,
  icon: "🤟",
  description: "Recognize the ASL fingerspelled letters Y and R.",
  instructions: "Hold up Y or R steadily, or use the pointer buttons to test the display.",
};

const HOLD_SECONDS = .38;
const LOST_SECONDS = .24;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function straightness(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const length = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (length < .000001) return 0;
  return clamp((1 - (abx * cbx + aby * cby) / length) / 2);
}

function fingerExtension(points, mcp, pip, dip, tip) {
  const wrist = points[0];
  const reach = distance(points[tip], wrist) / Math.max(.001, distance(points[pip], wrist));
  const reachScore = clamp((reach - .92) / .38);
  return .48 * straightness(points[mcp], points[pip], points[dip])
    + .32 * straightness(points[pip], points[dip], points[tip])
    + .2 * reachScore;
}

function sideOfLine(a, b, point) {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function segmentsCross(a, b, c, d) {
  const first = sideOfLine(a, b, c) * sideOfLine(a, b, d);
  const second = sideOfLine(c, d, a) * sideOfLine(c, d, b);
  return first < 0 && second < 0;
}

function crossingScore(points, palmWidth) {
  const indexPip = points[6];
  const indexTip = points[8];
  const middlePip = points[10];
  const middleTip = points[12];
  if (segmentsCross(indexPip, indexTip, middlePip, middleTip)) return 1;

  const palmAxis = {
    x: points[17].x - points[5].x,
    y: points[17].y - points[5].y,
  };
  const baseOrder = (indexPip.x - middlePip.x) * palmAxis.x
    + (indexPip.y - middlePip.y) * palmAxis.y;
  const tipOrder = (indexTip.x - middleTip.x) * palmAxis.x
    + (indexTip.y - middleTip.y) * palmAxis.y;
  const swappedSides = baseOrder * tipOrder < 0;
  const tipGap = distance(indexTip, middleTip) / palmWidth;
  if (swappedSides) return clamp(1.15 - tipGap);
  return tipGap < .22 ? .28 : 0;
}

// A deliberately small landmark classifier. It uses hand-relative geometry,
// so it works for either hand and is not tied to a location in the camera.
export function classifyAslLetter(points) {
  if (!Array.isArray(points) || points.length !== 21 || points.some((point) => !point)) {
    return { label: null, yScore: 0, rScore: 0 };
  }

  const palmCenter = {
    x: (points[0].x + points[5].x + points[9].x + points[13].x + points[17].x) / 5,
    y: (points[0].y + points[5].y + points[9].y + points[13].y + points[17].y) / 5,
  };
  const palmWidth = Math.max(.001, distance(points[5], points[17]));
  const thumbReach = distance(points[4], palmCenter) / palmWidth;
  const thumb = .58 * straightness(points[2], points[3], points[4])
    + .42 * clamp((thumbReach - .72) / .72);
  const index = fingerExtension(points, 5, 6, 7, 8);
  const middle = fingerExtension(points, 9, 10, 11, 12);
  const ring = fingerExtension(points, 13, 14, 15, 16);
  const pinky = fingerExtension(points, 17, 18, 19, 20);
  const crossed = crossingScore(points, palmWidth);

  const yScore = .25 * thumb + .25 * pinky
    + .18 * (1 - index) + .17 * (1 - middle) + .15 * (1 - ring);
  const rScore = .22 * index + .22 * middle
    + .18 * (1 - ring) + .16 * (1 - pinky) + .22 * crossed;

  let label = null;
  if (yScore >= .69 && yScore > rScore + .08) label = "Y";
  if (rScore >= .7 && rScore > yScore + .06 && crossed >= .48) label = "R";
  return { label, yScore, rScore };
}

function emptyReading() {
  return { detected: null, candidate: null, progress: 0, yScore: 0, rScore: 0, hasHand: false };
}

export default function AslLetterDetector({ inputRef, paused }) {
  const trackerRef = useRef({ candidate: null, held: 0, lost: 0, detected: null, hudTime: 0 });
  const readingRef = useRef(emptyReading());
  const [reading, setReading] = useState(readingRef.current);

  function publish(next) {
    const previous = readingRef.current;
    const changed = previous.detected !== next.detected
      || previous.candidate !== next.candidate
      || previous.hasHand !== next.hasHand
      || Math.abs(previous.progress - next.progress) >= .03
      || Math.abs(previous.yScore - next.yScore) >= .03
      || Math.abs(previous.rScore - next.rScore) >= .03;
    if (changed) {
      readingRef.current = next;
      setReading(next);
    }
  }

  useDemoFrame((seconds) => {
    const input = inputRef.current;
    if (input.source !== "camera") return;
    const tracker = trackerRef.current;
    const hand = input.hands?.[0];
    const result = classifyAslLetter(hand?.landmarks);

    if (result.label) {
      tracker.lost = 0;
      if (result.label === tracker.candidate) tracker.held += seconds;
      else {
        tracker.candidate = result.label;
        tracker.held = 0;
      }
      if (tracker.held >= HOLD_SECONDS) tracker.detected = result.label;
    } else {
      tracker.candidate = null;
      tracker.held = 0;
      tracker.lost += seconds;
      if (tracker.lost >= LOST_SECONDS) tracker.detected = null;
    }

    tracker.hudTime += seconds;
    if (tracker.hudTime >= .07) {
      tracker.hudTime = 0;
      publish({
        detected: tracker.detected,
        candidate: tracker.candidate,
        progress: result.label ? clamp(tracker.held / HOLD_SECONDS) : 0,
        yScore: result.yScore,
        rScore: result.rScore,
        hasHand: Boolean(hand),
      });
    }
  }, paused);

  function chooseWithPointer(letter) {
    if (inputRef.current.source !== "pointer") return;
    trackerRef.current.detected = letter;
    publish({ detected: letter, candidate: letter, progress: 1, yScore: letter === "Y" ? 1 : 0, rScore: letter === "R" ? 1 : 0, hasHand: false });
  }

  const activeLetter = reading.detected;
  const isPointer = inputRef.current.source === "pointer";
  const message = isPointer
    ? "Choose a letter below"
    : !reading.hasHand
      ? "Show one hand to the camera"
      : reading.candidate
        ? `Hold ${reading.candidate} steady…`
        : "Make a Y or cross two fingers for R";

  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", overflow: "hidden", color: "#f7fbff", background: "radial-gradient(circle at 50% 48%, rgba(30, 82, 112, .38), rgba(3, 8, 18, .78) 55%, rgba(2, 6, 14, .94))" }}>
      <div aria-live="polite" style={{ width: "min(760px, calc(100% - 36px))", marginTop: 58, textAlign: "center" }}>
        <div style={{ color: "#8be9fd", fontSize: "clamp(.8rem, 1.5vw, 1rem)", fontWeight: 900, letterSpacing: ".22em", textTransform: "uppercase" }}>Detected ASL letter</div>
        <div style={{ minHeight: "clamp(210px, 38vh, 390px)", display: "grid", placeItems: "center", margin: "12px auto 18px", border: `2px solid ${activeLetter ? "#67e8f9" : "rgba(148, 210, 236, .28)"}`, borderRadius: 36, background: activeLetter ? "rgba(8, 47, 67, .78)" : "rgba(5, 14, 28, .66)", boxShadow: activeLetter ? "0 0 70px rgba(34, 211, 238, .28), inset 0 0 45px rgba(34, 211, 238, .08)" : "0 24px 70px rgba(0, 0, 0, .3)", backdropFilter: "blur(14px)", transition: ".18s ease" }}>
          <strong style={{ fontSize: "clamp(9rem, 28vw, 19rem)", lineHeight: .8, color: activeLetter ? "#ffffff" : "rgba(184, 211, 228, .22)", textShadow: activeLetter ? "0 0 30px rgba(103, 232, 249, .55)" : "none" }}>{activeLetter ?? "?"}</strong>
        </div>

        <div style={{ height: 8, overflow: "hidden", borderRadius: 999, background: "rgba(152, 188, 210, .2)" }}>
          <div style={{ width: `${reading.progress * 100}%`, height: "100%", borderRadius: "inherit", background: "linear-gradient(90deg, #38bdf8, #67e8f9)", transition: "width .07s linear" }} />
        </div>
        <p style={{ margin: "12px 0 16px", color: "#d7e7f2", fontSize: "clamp(1rem, 2vw, 1.3rem)", fontWeight: 700 }}>{activeLetter ? `That looks like ${activeLetter}` : message}</p>

        <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
          {["Y", "R"].map((letter) => (
            <button key={letter} type="button" disabled={!isPointer} onClick={() => chooseWithPointer(letter)} aria-pressed={activeLetter === letter} style={{ minWidth: 112, padding: "12px 24px", color: activeLetter === letter ? "#071018" : "#eaf8ff", border: "1px solid #67e8f9", borderRadius: 999, background: activeLetter === letter ? "#67e8f9" : "rgba(6, 22, 35, .72)", opacity: isPointer ? 1 : .42, cursor: isPointer ? "pointer" : "default", fontSize: "1.1rem", fontWeight: 900 }}>{isPointer ? "Test" : "Pointer:"} {letter}</button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 22, marginTop: 15, color: "rgba(210, 230, 241, .7)", font: "700 .78rem ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          <span>Y {Math.round(reading.yScore * 100)}%</span>
          <span>R {Math.round(reading.rScore * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
