import { useEffect, useRef, useState } from 'react';

export interface VisionMetrics {
  eyeContact: number; // 0 - 100
  blinkRate: number; // blinks per minute
  headStability: number; // 0 - 100
}

interface MediaPipeHookProps {
  active: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
}

export function useMediaPipe({ active, videoRef }: MediaPipeHookProps) {
  const [metrics, setMetrics] = useState<VisionMetrics>({
    eyeContact: 85,
    blinkRate: 15,
    headStability: 90,
  });

  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accumulators for turn-based metrics averaging
  const turnMetricsRef = useRef<{
    eyeContactSum: number;
    headStabilitySum: number;
    frameCount: number;
    blinkCount: number;
    startTime: number;
  }>({
    eyeContactSum: 0,
    headStabilitySum: 0,
    frameCount: 0,
    blinkCount: 0,
    startTime: Date.now(),
  });

  const blinkStateRef = useRef<{
    wasClosed: boolean;
    blinkCount: number;
  }>({
    wasClosed: false,
    blinkCount: 0,
  });

  const previousNoseRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef<any>(null);
  const faceMeshRef = useRef<any>(null);

  // Helper to calculate Euclidean distance in 3D
  const getDistance = (p1: any, p2: any) => {
    return Math.sqrt(
      Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2)
    );
  };

  // Helper to calculate distance in 2D
  const getDistance2D = (p1: any, p2: any) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  // Reset metrics accumulation for a new turn
  const resetTurnMetrics = () => {
    turnMetricsRef.current = {
      eyeContactSum: 0,
      headStabilitySum: 0,
      frameCount: 0,
      blinkCount: 0,
      startTime: Date.now(),
    };
    blinkStateRef.current.blinkCount = 0;
  };

  // Get aggregated metrics for submission
  const getAggregatedMetrics = (): VisionMetrics => {
    const { eyeContactSum, headStabilitySum, frameCount, startTime } = turnMetricsRef.current;
    const durationMin = (Date.now() - startTime) / 60000;
    
    const finalBlinkCount = blinkStateRef.current.blinkCount;
    // Calculate blinks per minute (default to 15 if duration is negligible)
    const calculatedBlinkRate = durationMin > 0.05 ? finalBlinkCount / durationMin : 15;

    const avgEyeContact = frameCount > 0 ? eyeContactSum / frameCount : 85;
    const avgHeadStability = frameCount > 0 ? headStabilitySum / frameCount : 90;

    return {
      eyeContact: Math.round(Math.max(0, Math.min(100, avgEyeContact))),
      blinkRate: Math.round(Math.max(2, Math.min(60, calculatedBlinkRate))),
      headStability: Math.round(Math.max(0, Math.min(100, avgHeadStability))),
    };
  };

  useEffect(() => {
    if (!active || !videoRef.current) {
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
        setCameraActive(false);
      }
      return;
    }

    const W = window as any;
    if (!W.FaceMesh || !W.Camera) {
      setError('MediaPipe library not loaded yet.');
      return;
    }

    const videoElement = videoRef.current;

    try {
      // 1. Initialize FaceMesh
      const faceMesh = new W.FaceMesh({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results: any) => {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
          return;
        }

        const landmarks = results.multiFaceLandmarks[0];

        // --- BLINK DETECTION ---
        // Left Eye Aspect Ratio (EAR)
        const leftEAR = getDistance(landmarks[159], landmarks[145]) / getDistance(landmarks[33], landmarks[133]);
        // Right Eye Aspect Ratio (EAR)
        const rightEAR = getDistance(landmarks[386], landmarks[374]) / getDistance(landmarks[362], landmarks[263]);
        const avgEAR = (leftEAR + rightEAR) / 2;

        const isClosed = avgEAR < 0.22;
        if (isClosed && !blinkStateRef.current.wasClosed) {
          blinkStateRef.current.wasClosed = true;
        } else if (!isClosed && blinkStateRef.current.wasClosed) {
          blinkStateRef.current.wasClosed = false;
          blinkStateRef.current.blinkCount += 1;
          turnMetricsRef.current.blinkCount += 1;
        }

        // --- EYE CONTACT ANALYSIS ---
        // Left eye horizontal & vertical centers
        const leftEyeCenterX = (landmarks[33].x + landmarks[133].x) / 2;
        const leftEyeCenterY = (landmarks[159].y + landmarks[145].y) / 2;
        const leftIris = landmarks[468];
        const leftDevX = (leftIris.x - leftEyeCenterX) / getDistance2D(landmarks[33], landmarks[133]);
        const leftDevY = (leftIris.y - leftEyeCenterY) / getDistance2D(landmarks[159], landmarks[145]);

        // Right eye horizontal & vertical centers
        const rightEyeCenterX = (landmarks[362].x + landmarks[263].x) / 2;
        const rightEyeCenterY = (landmarks[386].y + landmarks[374].y) / 2;
        const rightIris = landmarks[473];
        const rightDevX = (rightIris.x - rightEyeCenterX) / getDistance2D(landmarks[362], landmarks[263]);
        const rightDevY = (rightIris.y - rightEyeCenterY) / getDistance2D(landmarks[386], landmarks[374]);

        // Aggregate eye deviation
        const dev = Math.sqrt(
          leftDevX * leftDevX + leftDevY * leftDevY + rightDevX * rightDevX + rightDevY * rightDevY
        );

        // Normalize eye contact to a 0-100 scale
        // High contact is centered (small dev); mapping typical deviations to 60-100
        const frameEyeContact = Math.max(0, Math.min(100, 100 - dev * 180));

        // --- HEAD STABILITY ---
        const nose = landmarks[4];
        let frameStability = 95;
        if (previousNoseRef.current) {
          const delta = getDistance2D(nose, previousNoseRef.current);
          // Small delta = high stability. Limit maximum delta effect.
          frameStability = Math.max(0, Math.min(100, 100 - delta * 4000));
        }
        previousNoseRef.current = { x: nose.x, y: nose.y };

        // Accumulate turn data
        turnMetricsRef.current.eyeContactSum += frameEyeContact;
        turnMetricsRef.current.headStabilitySum += frameStability;
        turnMetricsRef.current.frameCount += 1;

        // Smooth metrics presentation for the UI
        setMetrics(() => {
          // Calculate running averages
          const currentCount = turnMetricsRef.current.frameCount;
          const avgEye = turnMetricsRef.current.eyeContactSum / currentCount;
          const avgStability = turnMetricsRef.current.headStabilitySum / currentCount;

          return {
            eyeContact: Math.round(avgEye),
            blinkRate: blinkStateRef.current.blinkCount, // Raw counter, scaled at turn end
            headStability: Math.round(avgStability),
          };
        });
      });

      faceMeshRef.current = faceMesh;

      // 2. Initialize Camera Utility
      const camera = new W.Camera(videoElement, {
        onFrame: async () => {
          if (faceMeshRef.current) {
            await faceMeshRef.current.send({ image: videoElement });
          }
        },
        width: 640,
        height: 480,
      });

      camera.start().then(() => {
        setCameraActive(true);
      }).catch((err: any) => {
        console.error('Camera start failed:', err);
        setError('Failed to access webcam.');
      });

      cameraRef.current = camera;

    } catch (err: any) {
      console.error('Failed to setup MediaPipe:', err);
      setError(err.message || 'MediaPipe initialization failed.');
    }

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
        faceMeshRef.current = null;
      }
      setCameraActive(false);
    };
  }, [active, videoRef]);

  return {
    metrics,
    cameraActive,
    error,
    resetTurnMetrics,
    getAggregatedMetrics,
  };
}
