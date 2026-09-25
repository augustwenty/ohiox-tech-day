import { useEffect, useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "jumping-jacks",
  title: "Jumping Jack Counter",
  kind: "GAME",
  order: 5,
  icon: "🙌",
  description: "Use full-body pose detection to count jumping jacks.",
  instructions: "Keep your full body visible. Move from READY to IN MOTION and return to READY to count one repetition.",
};

const POSE_SCRIPT = "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js";
const POSE_ASSETS = "https://cdn.jsdelivr.net/npm/@mediapipe/pose";
const HOLD_SECONDS = 0.09;
const LOST_SECONDS = 0.45;
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32],
];
const TRACKED_JOINTS = new Set(POSE_CONNECTIONS.flat());

let poseScriptPromise;

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function loadPoseScript() {
  if (window.Pose) return Promise.resolve();
  if (poseScriptPromise) return poseScriptPromise;
  poseScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = POSE_SCRIPT;
    script.crossOrigin = "anonymous";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the pose model"));
    document.head.appendChild(script);
  }).catch((error) => {
    poseScriptPromise = null;
    throw error;
  });
  return poseScriptPromise;
}

function visible(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= 0.45;
}

export function readBodyPose(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 33) return { pose: "missing", confidence: 0 };
  const required = [11, 12, 15, 16, 23, 24, 27, 28].map((index) => landmarks[index]);
  if (!required.every(visible)) return { pose: "missing", confidence: 0 };

  const [leftShoulder, rightShoulder, leftWrist, rightWrist, leftHip, rightHip, leftAnkle, rightAnkle] = required;
  const shoulders = midpoint(leftShoulder, rightShoulder);
  const hips = midpoint(leftHip, rightHip);
  const torso = distance(shoulders, hips);
  if (torso < 0.06) return { pose: "missing", confidence: 0 };

  const wristsBelow = Math.min(leftWrist.y - leftShoulder.y, rightWrist.y - rightShoulder.y) / torso;
  const footSpread = Math.abs(leftAnkle.x - rightAnkle.x) / torso;
  const ready = wristsBelow > 0.18 && footSpread < 0.9;

  if (ready) return { pose: "ready", confidence: clamp(Math.min(wristsBelow / 0.7, (1.2 - footSpread) / 0.6)) };
  return { pose: "motion", confidence: 1 };
}

function readPointerPose(input) {
  if (!input.active) return { pose: "missing", confidence: 0 };
  return { pose: input.y > 0.62 ? "ready" : "motion", confidence: 1 };
}

function displayLandmarks(landmarks, video) {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const videoWidth = Math.max(1, video.videoWidth);
  const videoHeight = Math.max(1, video.videoHeight);
  const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);
  const drawnWidth = videoWidth * scale;
  const drawnHeight = videoHeight * scale;
  const offsetX = (viewportWidth - drawnWidth) / 2;
  const offsetY = (viewportHeight - drawnHeight) / 2;
  return landmarks.map((point) => ({
    ...point,
    x: (viewportWidth - offsetX - point.x * drawnWidth) / viewportWidth,
    y: (offsetY + point.y * drawnHeight) / viewportHeight,
  }));
}

function initialHud() {
  return { count: 0, phase: "Stand in view", pose: "missing", progress: 0, flash: 0, landmarks: [] };
}

export default function JumpingJacks({ inputRef, videoRef, paused }) {
  const engineRef = useRef(null);
  const busyRef = useRef(false);
  const latestPoseRef = useRef({ landmarks: [], display: [], at: 0 });
  const trackerRef = useRef({ stablePose: null, candidate: null, held: 0, lost: 0, hasReady: false, count: 0, flash: 0, hudTime: 0, lastSend: 0 });
  const hudRef = useRef(initialHud());
  const [hud, setHud] = useState(hudRef.current);
  const [modelStatus, setModelStatus] = useState("Loading full-body model…");

  useEffect(() => {
    let active = true;
    let engine;

    void loadPoseScript().then(() => {
      if (!active) return;
      engine = new window.Pose({ locateFile: (file) => `${POSE_ASSETS}/${file}` });
      engine.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      engine.onResults((results) => {
        if (!active) return;
        const landmarks = results.poseLandmarks ?? [];
        const video = videoRef.current;
        latestPoseRef.current = {
          landmarks,
          display: video && landmarks.length ? displayLandmarks(landmarks, video) : [],
          at: performance.now(),
        };
        setModelStatus(landmarks.length ? "Full body found" : "Keep your full body in view");
      });
      engineRef.current = engine;
      setModelStatus("Keep your full body in view");
    }).catch((error) => {
      if (active) setModelStatus(error.message);
    });

    return () => {
      active = false;
      engineRef.current = null;
      latestPoseRef.current = { landmarks: [], display: [], at: 0 };
      void engine?.close?.();
    };
  }, [videoRef]);

  useDemoFrame((seconds, now) => {
    const input = inputRef.current;
    const video = videoRef.current;
    const tracker = trackerRef.current;
    const isCamera = input.source === "camera";

    if (isCamera && engineRef.current && video?.readyState >= 2 && !busyRef.current && now - tracker.lastSend >= 66) {
      tracker.lastSend = now;
      busyRef.current = true;
      void engineRef.current.send({ image: video }).catch(() => {
        setModelStatus("Pose tracking paused");
      }).finally(() => {
        busyRef.current = false;
      });
    }

    const latest = latestPoseRef.current;
    const reading = isCamera
      ? now - latest.at < 400 ? readBodyPose(latest.landmarks) : { pose: "missing", confidence: 0 }
      : readPointerPose(input);

    tracker.flash = Math.max(0, tracker.flash - seconds);
    if (reading.pose === "missing") {
      tracker.lost += seconds;
      if (tracker.lost >= LOST_SECONDS) {
        tracker.candidate = null;
        tracker.held = 0;
        tracker.stablePose = null;
        tracker.hasReady = false;
      }
    } else {
      tracker.lost = 0;
    }

    if (reading.pose === "ready" || reading.pose === "motion") {
      if (tracker.candidate === reading.pose) tracker.held += seconds;
      else {
        tracker.candidate = reading.pose;
        tracker.held = 0;
      }

      if (tracker.held >= HOLD_SECONDS && tracker.stablePose !== reading.pose) {
        const previousPose = tracker.stablePose;
        tracker.stablePose = reading.pose;
        if (reading.pose === "ready") {
          if (previousPose === "motion" && tracker.hasReady) {
            tracker.count += 1;
            tracker.flash = 0.42;
          }
          tracker.hasReady = true;
        }
      }
    }

    let phase = reading.pose === "ready" ? "READY" : "IN MOTION";
    if (reading.pose === "missing") phase = "BODY NOT FOUND";
    const progress = tracker.candidate === reading.pose ? clamp(tracker.held / HOLD_SECONDS) : 0;

    tracker.hudTime += seconds;
    if (tracker.hudTime >= 0.05 || tracker.flash > hudRef.current.flash) {
      tracker.hudTime = 0;
      const next = { count: tracker.count, phase, pose: reading.pose, progress, flash: tracker.flash, landmarks: isCamera ? latest.display : [] };
      hudRef.current = next;
      setHud(next);
    }
  }, paused);

  const isCamera = inputRef.current.source === "camera";
  const readyActive = hud.pose === "ready";
  const motionActive = hud.pose === "motion";
  const glow = hud.flash > 0;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", color: "#f7fbff", background: isCamera ? "radial-gradient(circle at 50% 45%, rgba(20,45,88,.12), rgba(3,8,20,.48) 72%)" : "radial-gradient(circle at 50% 42%, #24366b 0, #101934 48%, #070b18 100%)", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1, overflow: "visible", pointerEvents: "none" }}>
        {POSE_CONNECTIONS.map(([from, to]) => {
          const start = hud.landmarks[from];
          const end = hud.landmarks[to];
          return visible(start) && visible(end) ? <line key={`${from}-${to}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={glow ? "#ffe66d" : "#65dcff"} strokeWidth="0.006" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null;
        })}
        {hud.landmarks.map((point, index) => TRACKED_JOINTS.has(index) && visible(point) ? <circle key={index} cx={point.x} cy={point.y} r="0.009" fill={glow ? "#ffe66d" : "white"} stroke="#102449" strokeWidth="0.003" vectorEffect="non-scaling-stroke" /> : null)}
      </svg>

      <div style={{ position: "absolute", top: "clamp(76px, 10vh, 112px)", left: "50%", zIndex: 3, width: "min(760px, calc(100% - 32px))", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ color: "#9ee8ff", fontSize: "clamp(.72rem, 1.3vw, .92rem)", fontWeight: 900, letterSpacing: ".24em", textTransform: "uppercase" }}>Full-body jumping jacks</div>
        <div aria-live="polite" style={{ marginTop: 4, fontSize: "clamp(5rem, 15vh, 9.5rem)", fontWeight: 950, lineHeight: 0.96, letterSpacing: "-.07em", color: glow ? "#fff7b1" : "white", textShadow: glow ? "0 0 45px #ffd84d" : "0 12px 40px rgba(0,0,0,.5)", transform: glow ? "scale(1.08)" : "scale(1)", transition: "color .12s, transform .12s, text-shadow .12s" }}>{hud.count}</div>
        <div style={{ display: "inline-block", minWidth: "min(310px, 80vw)", marginTop: 12, padding: "10px 22px", border: `2px solid ${readyActive ? "#67f5b5" : motionActive ? "#ffe66d" : "rgba(255,255,255,.45)"}`, borderRadius: 999, color: readyActive ? "#91ffd0" : motionActive ? "#fff3a0" : "#e3e9ef", background: "rgba(3,8,20,.78)", boxShadow: readyActive ? "0 0 28px rgba(103,245,181,.2)" : motionActive ? "0 0 28px rgba(255,230,109,.2)" : "none", fontSize: "clamp(1.1rem, 2.8vw, 1.7rem)", fontWeight: 950, letterSpacing: ".12em", textShadow: "0 2px 8px #000" }}>{hud.phase}</div>
        <div style={{ width: "min(330px, 70vw)", height: 7, margin: "12px auto 0", overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,.2)" }}>
          <div style={{ width: `${hud.progress * 100}%`, height: "100%", borderRadius: "inherit", background: "linear-gradient(90deg, #65dcff, #ffe66d)", transition: "width .05s linear" }} />
        </div>
        {isCamera ? <div style={{ display: "inline-block", marginTop: 10, padding: "6px 12px", borderRadius: 999, color: modelStatus === "Full body found" ? "#91ffd0" : "#dceaf3", background: "rgba(3,8,20,.68)", fontSize: ".76rem", fontWeight: 800 }}>{modelStatus}</div> : null}
      </div>

      {!isCamera ? (
        <div style={{ position: "absolute", inset: "42% 7% 7%", zIndex: 2, display: "grid", gridTemplateRows: "1fr 1fr", gap: "clamp(14px, 3vh, 28px)", maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "grid", placeItems: "center", border: `3px dashed ${motionActive ? "#ffe66d" : "rgba(158,232,255,.34)"}`, borderRadius: 32, background: motionActive ? "rgba(255,230,109,.15)" : "rgba(15,25,53,.38)" }}><strong style={{ color: motionActive ? "#fff3a0" : "#d8eff8", fontSize: "clamp(1rem, 2vw, 1.35rem)", letterSpacing: ".18em" }}>🙌 IN MOTION</strong></div>
          <div style={{ display: "grid", placeItems: "center", border: `3px dashed ${readyActive ? "#67f5b5" : "rgba(158,232,255,.34)"}`, borderRadius: 32, background: readyActive ? "rgba(103,245,181,.13)" : "rgba(15,25,53,.38)" }}><strong style={{ color: readyActive ? "#91ffd0" : "#d8eff8", fontSize: "clamp(1rem, 2vw, 1.35rem)", letterSpacing: ".18em" }}>🧍 READY</strong></div>
        </div>
      ) : null}

      <div style={{ position: "absolute", zIndex: 3, right: 18, bottom: 12, color: "rgba(225,241,250,.75)", fontSize: ".74rem", fontWeight: 750, textAlign: "right", textShadow: "0 2px 6px #000" }}>
        {isCamera ? "Count: READY → IN MOTION → READY" : "Pointer · READY → IN MOTION → READY"}
      </div>
    </div>
  );
}
