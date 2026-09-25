import { useEffect, useRef, useState } from "react";
import { DEMOS } from "./demoRegistry.js";
import { emptyInput, moveInput, pointerInput } from "./input.js";
import { useCameraInput } from "./useCameraInput.js";

const HAND_CONNECTIONS = [
  [0, 1], [0, 5], [0, 9], [0, 13], [0, 17],
  [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
];

function demoFromHash() {
  const id = window.location.hash.replace(/^#\/?/, "");
  return DEMOS.find((demo) => demo.id === id) ?? null;
}

export default function App() {
  const [activeDemo, setActiveDemo] = useState(demoFromHash);
  const [paused, setPaused] = useState(false);
  const [revision, setRevision] = useState(0);
  const [inputMode, setInputMode] = useState("camera");
  const [launcherPointer, setLauncherPointer] = useState({ active: false, x: 0, y: 0, id: null, progress: 0 });
  const [launcherSkeleton, setLauncherSkeleton] = useState([]);
  const [exitHold, setExitHold] = useState({ active: false, progress: 0 });
  const pointerRef = useRef(emptyInput("pointer"));
  const stageRef = useRef(null);
  const cardRefs = useRef(new Map());
  const dwellRef = useRef({ id: null, startedAt: 0 });
  const exitRef = useRef(null);
  const exitDwellRef = useRef(0);
  const camera = useCameraInput();
  const inputRef = inputMode === "camera" ? camera.inputRef : pointerRef;
  const Demo = activeDemo?.Component;

  useEffect(() => {
    const navigate = () => {
      setActiveDemo(demoFromHash());
      setPaused(false);
      setRevision(0);
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    if (activeDemo) return undefined;
    let frameId = 0;
    const tick = (now) => {
      const input = camera.inputRef.current;
      const hands = camera.handsRef.current;
      const verified = hands.some((hand) => hand.tips.length === 5);
      const x = input.x * window.innerWidth;
      const y = input.y * window.innerHeight;
      const hovered = input.active && verified
        ? DEMOS.find((demo) => {
            const rect = cardRefs.current.get(demo.id)?.getBoundingClientRect();
            return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          })
        : null;

      if (hovered?.id !== dwellRef.current.id) dwellRef.current = { id: hovered?.id ?? null, startedAt: now };
      const progress = hovered ? Math.min(1, (now - dwellRef.current.startedAt) / 1000) : 0;
      setLauncherPointer({ active: input.active && verified, x, y, id: hovered?.id ?? null, progress });
      setLauncherSkeleton(hands.map((hand, handIndex) => ({
        id: handIndex,
        joints: hand.landmarks.map((point, index) => point ? ({
          index,
          x: point.x * window.innerWidth,
          y: point.y * window.innerHeight,
        }) : null),
      })));
      if (hovered && progress >= 1) {
        dwellRef.current = { id: null, startedAt: now };
        window.location.hash = `/${hovered.id}`;
        return;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [activeDemo, camera.inputRef]);

  useEffect(() => {
    if (!activeDemo) {
      setExitHold({ active: false, progress: 0 });
      return undefined;
    }
    let frameId = 0;
    const tick = (now) => {
      const input = camera.inputRef.current;
      const verified = camera.handsRef.current.some((hand) => hand.tips.length === 5);
      const rect = exitRef.current?.getBoundingClientRect();
      const x = input.x * window.innerWidth;
      const y = input.y * window.innerHeight;
      const active = Boolean(input.active && verified && rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
      if (active && exitDwellRef.current === 0) exitDwellRef.current = now;
      if (!active) exitDwellRef.current = 0;
      const progress = active ? Math.min(1, (now - exitDwellRef.current) / 1000) : 0;
      setExitHold({ active, progress });
      if (progress >= 1) {
        exitDwellRef.current = 0;
        goHome();
        return;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [activeDemo, camera.handsRef, camera.inputRef]);

  function updatePointer(event, action = pointerRef.current.action) {
    if (inputMode !== "pointer") return;
    pointerRef.current = pointerInput(event, event.currentTarget.getBoundingClientRect(), action);
  }

  function choosePointer() {
    pointerRef.current = emptyInput("pointer");
    setInputMode("pointer");
    stageRef.current?.focus({ preventScroll: true });
  }

  function goHome() {
    window.location.hash = "/";
    if (document.fullscreenElement) void document.exitFullscreen();
  }

  return (
    <main className="app" ref={stageRef}>
      <video ref={camera.videoRef} className="camera-background" muted playsInline autoPlay />
      <div className="camera-shade" aria-hidden="true" />

      {!activeDemo ? (
        <section className="landing">
          <header className="landing-header">
            <div className="landing-title-row">
              <span className="hand-mark" aria-hidden="true" />
              <div><h1>Finger Tracking Demos</h1><p>Hover your index finger over any demo to launch it</p></div>
            </div>
            <span className="landing-instruction"><span className="clock" aria-hidden="true" /> Hover for 1 second to select</span>
          </header>

          <div className="landing-sections">
            {DEMOS.map((demo) => (
              <section className={`landing-panel ${demo.kind?.toLowerCase() ?? "demo"}`} key={demo.id}>
                <h2><span className="section-symbol" aria-hidden="true">{demo.kind === "VISUAL" ? "◉" : "⌁"}</span>{demo.kind === "VISUAL" ? "Visual Effects" : "Games"}</h2>
                <a
                  className={`landing-card ${launcherPointer.id === demo.id ? "active" : ""}`}
                  href={`#/${demo.id}`}
                  ref={(node) => node ? cardRefs.current.set(demo.id, node) : cardRefs.current.delete(demo.id)}
                  style={{ "--accent": demo.id === "voronoi" ? "#a855f7" : "#ff5a52", "--hold-progress": launcherPointer.id === demo.id ? launcherPointer.progress : 0 }}
                >
                  <span className={`mode-preview ${demo.id}`} aria-hidden="true">{demo.icon}</span>
                  <strong>{demo.title.replace("Space ", "")}</strong>
                </a>
              </section>
            ))}
          </div>

          <svg className="hand-skeleton" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`} preserveAspectRatio="none" aria-hidden="true">
            {launcherSkeleton.map((hand) => (
              <g key={hand.id}>
                {HAND_CONNECTIONS.map(([startIndex, endIndex]) => {
                  const start = hand.joints[startIndex];
                  const end = hand.joints[endIndex];
                  return start && end ? <line key={`${startIndex}-${endIndex}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} /> : null;
                })}
                {hand.joints.map((joint) => joint ? <circle key={joint.index} className={joint.index === 8 ? "index" : ""} cx={joint.x} cy={joint.y} r={joint.index === 8 ? 5 : 3} /> : null)}
              </g>
            ))}
          </svg>

          {launcherPointer.active ? <span className="finger-marker" style={{ left: launcherPointer.x, top: launcherPointer.y }} /> : null}
          <footer className="landing-footer">
            <span className={`status-pill ${camera.status.startsWith("Hand found") ? "ok" : "warn"}`}><i />{camera.status}</span>
            <span className="helper-pill">Point your <strong>index finger</strong> to explore</span>
          </footer>
        </section>
      ) : (
        <section
          className="demo-screen"
          tabIndex="0"
          onPointerMove={updatePointer}
          onPointerDown={(event) => {
            updatePointer(event, true);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.currentTarget.focus();
          }}
          onPointerUp={(event) => updatePointer(event, false)}
          onPointerCancel={(event) => updatePointer(event, false)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && document.fullscreenElement) void document.exitFullscreen();
            if (inputMode !== "pointer") return;
            if (event.key.startsWith("Arrow")) {
              event.preventDefault();
              pointerRef.current = moveInput(pointerRef.current, event.key);
            } else if (event.code === "Space") {
              event.preventDefault();
              pointerRef.current = { ...pointerRef.current, action: true };
            }
          }}
          onKeyUp={(event) => {
            if (inputMode === "pointer" && event.code === "Space") pointerRef.current = { ...pointerRef.current, action: false };
          }}
        >
          <div className="demo-layer"><Demo key={`${activeDemo.id}-${revision}`} inputRef={inputRef} paused={paused} /></div>
          <div className="demo-toolbar" onPointerDown={(event) => event.stopPropagation()}>
            <div><strong>{activeDemo.title}</strong><small>{activeDemo.instructions}</small></div>
            <button type="button" aria-pressed={inputMode === "camera"} onClick={() => setInputMode("camera")}>Camera</button>
            <button type="button" aria-pressed={inputMode === "pointer"} onClick={choosePointer}>Pointer</button>
            <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "Resume" : "Pause"}</button>
            <button type="button" onClick={() => setRevision((value) => value + 1)}>Restart</button>
            <button type="button" onClick={() => stageRef.current?.requestFullscreen?.()}>Fullscreen</button>
          </div>
          <button
            ref={exitRef}
            type="button"
            className={`exit-control ${exitHold.active ? "active" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={goHome}
            style={{ "--hold-progress": exitHold.progress }}
          >
            <strong>← Exit</strong>
            <span>{exitHold.active ? `${Math.max(0, 1 - exitHold.progress).toFixed(2)}s` : "Hold to go back"}</span>
          </button>
          <div className="demo-status"><span>{inputMode === "camera" ? camera.status : "Pointer / arrow keys · press or Space to act"}</span></div>
          {paused ? <div className="paused">Paused</div> : null}
        </section>
      )}
    </main>
  );
}
