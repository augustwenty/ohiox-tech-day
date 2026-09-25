import { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
import * as handPoseDetection from "@tensorflow-models/hand-pose-detection";
import { emptyInput, handInput } from "./input.js";

const MODEL = handPoseDetection.SupportedModels.MediaPipeHands;
const MEDIAPIPE_ASSETS = "https://cdn.jsdelivr.net/npm/@mediapipe/hands";
const TIP_INDEXES = [4, 8, 12, 16, 20];

function normalizedPoint(point, width, height) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  const normalized = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  return {
    x: Math.max(0, Math.min(1, normalized ? 1 - point.x : 1 - point.x / width)),
    y: Math.max(0, Math.min(1, normalized ? point.y : point.y / height)),
  };
}

function extractHands(results, video) {
  const width = Math.max(1, video.videoWidth);
  const height = Math.max(1, video.videoHeight);
  return results.flatMap((hand) => {
    const points = hand.keypoints ?? [];
    const landmarks = points.map((point) => normalizedPoint(point, width, height));
    const tips = TIP_INDEXES.map((index) => normalizedPoint(points[index], width, height));
    const [thumb, index] = tips;
    if (!thumb || !index) return [];
    return [{
      index,
      tips: tips.filter(Boolean),
      landmarks,
      pinchDistance: Math.hypot(thumb.x - index.x, thumb.y - index.y),
    }];
  });
}

async function createDetector() {
  try {
    return await handPoseDetection.createDetector(MODEL, {
      runtime: "mediapipe",
      modelType: "full",
      maxHands: 2,
      solutionPath: MEDIAPIPE_ASSETS,
    });
  } catch {
    await tf.setBackend("webgl");
    await tf.ready();
    return handPoseDetection.createDetector(MODEL, {
      runtime: "tfjs",
      modelType: "full",
      maxHands: 2,
    });
  }
}

export function useCameraInput() {
  const videoRef = useRef(null);
  const inputRef = useRef(emptyInput());
  const handsRef = useRef([]);
  const [status, setStatus] = useState("Starting camera…");

  useEffect(() => {
    let active = true;
    let frameId = 0;
    let detector = null;
    let stream = null;
    let pinching = false;
    let lastMessage = "";

    const updateMessage = (message) => {
      if (message !== lastMessage && active) {
        lastMessage = message;
        setStatus(message);
      }
    };

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        updateMessage("Loading hand tracking…");
        detector = await createDetector();
        if (!active) {
          await detector.dispose?.();
          return;
        }

        const detect = async () => {
          if (!active) return;
          try {
            const results = video.readyState >= 2
              ? await detector.estimateHands(video, { flipHorizontal: false })
              : [];
            const hands = extractHands(results, video);
            handsRef.current = hands;
            const next = handInput(hands, pinching);
            pinching = next.pinching;
            inputRef.current = next.input;
            updateMessage(hands.length ? "Hand found · pinch to act" : "Show your hand to the camera");
          } catch (error) {
            handsRef.current = [];
            inputRef.current = emptyInput();
            updateMessage(`Tracking paused: ${error?.message ?? "unknown error"}`);
          }
          frameId = requestAnimationFrame(detect);
        };
        frameId = requestAnimationFrame(detect);
      } catch (error) {
        handsRef.current = [];
        inputRef.current = emptyInput();
        updateMessage(error?.name === "NotAllowedError"
          ? "Camera permission denied · pointer controls still work"
          : `${error?.message ?? "Camera unavailable"} · pointer controls still work`);
      }
    }

    void start();
    return () => {
      active = false;
      cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      void detector?.dispose?.();
    };
  }, []);

  return { videoRef, inputRef, handsRef, status };
}
