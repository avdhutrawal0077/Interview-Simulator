import React, { useRef, useEffect } from 'react';

// ---------- Config ----------
const IDLE_COLOR = [229, 229, 234];
const PARTICLE_COUNT = 900;
const BASE_RADIUS_FACTOR = 0.30;
const JITTER = 0.035;
const ROTATE_SPEED = 0.0009;
const SMOOTHING = 0.85;

function makeParticles(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const jx = (Math.random() - 0.5) * JITTER;
    const jy = (Math.random() - 0.5) * JITTER;
    const jz = (Math.random() - 0.5) * JITTER;
    pts.push({
      x: x + jx,
      y: y + jy,
      z: z + jz,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.2,
      size: 1.1 + Math.random() * 1.4,
      reactivity: 0.4 + Math.random() * 1.0,
    });
  }
  return pts;
}

function project(px, py, pz, radius, cx, cy) {
  const perspective = 620;
  const scale = perspective / (perspective + pz * radius);
  return {
    x: cx + px * radius * scale,
    y: cy + py * radius * scale,
    scale,
  };
}

function rotatePoint(x, y, z, ry, rx) {
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const y1 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  return [x1, y1, z2];
}

/**
 * VoiceSphere - Voice-reactive 3D particle sphere canvas component.
 *
 * @param {Object} props
 * @param {number} [props.voiceLevel=0] - Audio level between 0 and 1.
 * @param {[number, number, number]} [props.bandLevels] - Optional low/mid/high audio band levels.
 * @param {boolean} [props.active=false] - Listening state flag (reserved for future use).
 */
export const VoiceSphere = ({
  voiceLevel = 0,
  bandLevels,
  active = false,
}) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const propsRef = useRef({ voiceLevel, bandLevels, active });

  useEffect(() => {
    propsRef.current = { voiceLevel, bandLevels, active };
  }, [voiceLevel, bandLevels, active]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Media query for prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let isReducedMotion = mediaQuery.matches;
    const handleMotionChange = (e) => {
      isReducedMotion = e.matches;
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMotionChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleMotionChange);
    }

    let W = 0;
    let H = 0;
    let DPR = Math.min(window.devicePixelRatio || 1, 2);
    let sphereRadius = 200;

    const particles = makeParticles(PARTICLE_COUNT);

    let rotY = 0;
    let rotX = 0.15;
    let dragging = false;
    let lastPX = 0;
    let lastPY = 0;
    let velY = ROTATE_SPEED;
    let velX = 0;

    let level = 0;
    let smoothedBands = [0, 0, 0];

    const resize = () => {
      W = container.clientWidth;
      H = container.clientHeight;
      if (W === 0 || H === 0) return;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      sphereRadius = Math.min(W, H) * BASE_RADIUS_FACTOR;
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(container);
    resize();

    // Pointer event handlers for drag-to-rotate
    const handlePointerDown = (e) => {
      dragging = true;
      lastPX = e.clientX;
      lastPY = e.clientY;
    };

    const handlePointerMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastPX;
      const dy = e.clientY - lastPY;
      lastPX = e.clientX;
      lastPY = e.clientY;
      velY = dx * 0.0025;
      velX = dy * 0.0025;
    };

    const handlePointerUp = () => {
      dragging = false;
    };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('pointermove', handlePointerMove);

    let t0 = performance.now();
    let rafId;

    function frame(now) {
      const dt = Math.min(64, now - t0) / 16.67;
      t0 = now;

      // Update voice level driver from propsRef
      const { voiceLevel: inputLevel = 0, bandLevels: inputBands } = propsRef.current;
      const clampedLevel = Math.max(0, Math.min(1, inputLevel));
      level = level * SMOOTHING + clampedLevel * (1 - SMOOTHING);

      const targetBands = inputBands || [clampedLevel, clampedLevel, clampedLevel];
      smoothedBands = smoothedBands.map(
        (b, i) => b * SMOOTHING + (targetBands[i] ?? clampedLevel) * (1 - SMOOTHING)
      );

      if (!dragging) {
        if (!isReducedMotion) {
          const damp = 1 - level * 0.35;
          rotY += ROTATE_SPEED * damp * dt;
        }
      } else {
        rotY += velY * dt;
        rotX += velX * dt;
        velY *= 0.9;
        velX *= 0.9;
      }
      rotX = Math.max(-0.9, Math.min(0.9, rotX));

      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;

      const pulseMult = isReducedMotion ? 0 : 1;
      const shimmerMult = isReducedMotion ? 0 : 1;

      const pulseR = sphereRadius * (1 + level * 0.1 * pulseMult);
      const tNow = now / 1000;
      const renderList = [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const bandMix = smoothedBands[0] * 0.4 + smoothedBands[1] * 0.4 + smoothedBands[2] * 0.2;
        const shimmer =
          1 +
          (Math.sin(tNow * p.speed + p.phase) * 0.01 + bandMix * p.reactivity * 0.09) *
            shimmerMult;

        const [rx, ry, rz] = rotatePoint(p.x, p.y, p.z, rotY, rotX);
        const proj = project(rx * shimmer, ry * shimmer, rz * shimmer, pulseR, cx, cy);

        renderList.push({ proj, z: rz, p });
      }

      renderList.sort((a, b) => a.z - b.z);

      for (const item of renderList) {
        const { proj, z, p } = item;
        const depthFade = (z + 1) / 2;
        const alpha = 0.25 + depthFade * 0.65;
        const size = p.size * proj.scale * (0.85 + depthFade * 0.5);

        const mix = Math.min(1, level * 1.4 * (0.5 + p.reactivity * 0.5));
        const r = IDLE_COLOR[0] + (48 - IDLE_COLOR[0]) * mix;
        const g = IDLE_COLOR[1] + (209 - IDLE_COLOR[1]) * mix;
        const b = IDLE_COLOR[2] + (88 - IDLE_COLOR[2]) * mix;

        ctx.beginPath();
        ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`;
        ctx.arc(proj.x, proj.y, Math.max(0.4, size), 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('pointermove', handlePointerMove);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMotionChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleMotionChange);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

export default VoiceSphere;
