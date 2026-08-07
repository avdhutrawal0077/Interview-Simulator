import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { SphereState } from '../types/interview';

// ─── Props ──────────────────────────────────────────────
interface InterviewSphereProps {
  state: SphereState;
  audioLevel?: number; // 0–1, externally supplied
}

// ─── State color/parameter presets ──────────────────────
interface StateParams {
  color1: THREE.Color;
  color2: THREE.Color;
  amplitude: number;
  frequency: number;
  rotationSpeed: number;
  glowIntensity: number;
}

const STATE_PRESETS: Record<SphereState, StateParams> = {
  idle: {
    color1: new THREE.Color('#F5F5F7'),
    color2: new THREE.Color('#8E8E93'),
    amplitude: 0.08,
    frequency: 1.5,
    rotationSpeed: 0.3,
    glowIntensity: 0.6,
  },
  listening: {
    color1: new THREE.Color('#F5F5F7'),
    color2: new THREE.Color('#30D158'),
    amplitude: 0.08,
    frequency: 2.0,
    rotationSpeed: 0.4,
    glowIntensity: 0.7,
  },
  thinking: {
    color1: new THREE.Color('#F5F5F7'),
    color2: new THREE.Color('#F5F5F7'),
    amplitude: 0.15,
    frequency: 2.5,
    rotationSpeed: 0.6,
    glowIntensity: 1.0,
  },
  speaking: {
    color1: new THREE.Color('#F5F5F7'),
    color2: new THREE.Color('#30D158'),
    amplitude: 0.10,
    frequency: 2.0,
    rotationSpeed: 0.4,
    glowIntensity: 0.8,
  },
};

// ─── GLSL: Simplex noise (Ashima/webgl-noise) ──────────
const SIMPLEX_NOISE_GLSL = /* glsl */ `
//
// Description : Array and textureless GLSL 2D/3D/4D simplex noise.
//      Author : Ian McEwan, Ashima Arts.
//  Maintainer : stegu
//     Lastmod : 20201014 (stegu)
//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
//               Distributed under the MIT License.
//

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// ─── Vertex shader ──────────────────────────────────────
const vertexShader = /* glsl */ `
${SIMPLEX_NOISE_GLSL}

uniform float uTime;
uniform float uAmplitude;
uniform float uFrequency;

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);

  // Noise-based displacement along normals
  vec3 pos = position;
  float noise = snoise(pos * uFrequency + uTime * 0.4);
  float displacement = noise * uAmplitude;
  pos += normal * displacement;

  vPosition = (modelViewMatrix * vec4(pos, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// ─── Fragment shader (fresnel rim glow) ─────────────────
const fragmentShader = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uGlowIntensity;

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  // View direction
  vec3 viewDir = normalize(-vPosition);
  vec3 normal = normalize(vNormal);

  // Fresnel — stronger at edges
  float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 2.5);

  // Core to glow gradient
  vec3 color = mix(uColor1, uColor2, fresnel);

  // Apply glow intensity to the rim
  float rim = fresnel * uGlowIntensity;
  color += uColor2 * rim * 0.4;

  // Slight ambient to avoid pure black on faces pointing away
  color += uColor1 * 0.05;

  gl_FragColor = vec4(color, 1.0);
}
`;

// ─── Lerp helpers ───────────────────────────────────────
function lerpFloat(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─── Component ──────────────────────────────────────────
export const InterviewSphere: React.FC<InterviewSphereProps> = ({
  state,
  audioLevel = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Refs to persist across rAF without re-renders
  const stateRef = useRef(state);
  const audioRef = useRef(audioLevel);

  // Keep refs in sync
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { audioRef.current = audioLevel; }, [audioLevel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ─── Renderer ────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // ─── Scene + Camera ──────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 3.5;

    // ─── Geometry + Material ─────────────────────
    const geometry = new THREE.IcosahedronGeometry(1, 64);
    const uniforms = {
      uTime: { value: 0 },
      uAmplitude: { value: STATE_PRESETS.idle.amplitude },
      uFrequency: { value: STATE_PRESETS.idle.frequency },
      uColor1: { value: STATE_PRESETS.idle.color1.clone() },
      uColor2: { value: STATE_PRESETS.idle.color2.clone() },
      uGlowIntensity: { value: STATE_PRESETS.idle.glowIntensity },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // ─── Smooth transition state ─────────────────
    const current = {
      color1: STATE_PRESETS.idle.color1.clone(),
      color2: STATE_PRESETS.idle.color2.clone(),
      amplitude: STATE_PRESETS.idle.amplitude,
      frequency: STATE_PRESETS.idle.frequency,
      rotationSpeed: STATE_PRESETS.idle.rotationSpeed,
      glowIntensity: STATE_PRESETS.idle.glowIntensity,
    };

    // ─── Sizing ──────────────────────────────────
    const handleResize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();

    // ─── Animation loop ──────────────────────────
    const clock = new THREE.Clock();
    let rafId: number;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      const st = stateRef.current;
      const al = audioRef.current;
      const target = STATE_PRESETS[st];
      const lerpSpeed = Math.min(1, delta * 2.5); // ~0.4s transition

      // ─── Compute target values with audio modulation ───
      let targetAmp = target.amplitude;
      let targetGlow = target.glowIntensity;
      const targetColor1 = target.color1.clone();

      if (st === 'listening') {
        targetAmp += al * 0.25;
        targetGlow += al * 0.8;
        // Lerp core color toward green based on audio
        targetColor1.lerp(new THREE.Color('#30D158'), al * 0.6);
      } else if (st === 'speaking') {
        targetAmp += al * 0.2;
        targetGlow += al * 0.6;
        // Oscillate core between white and green
        const osc = Math.sin(elapsed * 3.0) * 0.5 + 0.5;
        targetColor1.lerp(new THREE.Color('#30D158'), osc * 0.5 + al * 0.3);
      } else if (st === 'thinking') {
        // Pulse amplitude and glow
        const pulse = Math.sin(elapsed * 4.0) * 0.5 + 0.5;
        targetAmp = 0.08 + pulse * 0.12;
        targetGlow = 0.7 + pulse * 0.5;
      }

      // ─── Smooth lerp current → target ──────────
      current.amplitude = lerpFloat(current.amplitude, targetAmp, lerpSpeed);
      current.frequency = lerpFloat(current.frequency, target.frequency, lerpSpeed);
      current.rotationSpeed = lerpFloat(current.rotationSpeed, target.rotationSpeed, lerpSpeed);
      current.glowIntensity = lerpFloat(current.glowIntensity, targetGlow, lerpSpeed);
      current.color1.lerp(targetColor1, lerpSpeed);
      current.color2.lerp(target.color2, lerpSpeed);

      // ─── Apply to uniforms ─────────────────────
      uniforms.uTime.value = elapsed;
      uniforms.uAmplitude.value = current.amplitude;
      uniforms.uFrequency.value = current.frequency;
      uniforms.uColor1.value.copy(current.color1);
      uniforms.uColor2.value.copy(current.color2);
      uniforms.uGlowIntensity.value = current.glowIntensity;

      // ─── Auto-rotation ─────────────────────────
      mesh.rotation.y += current.rotationSpeed * delta;
      mesh.rotation.x += current.rotationSpeed * delta * 0.3;

      renderer.render(scene, camera);
    };

    animate();

    // ─── Cleanup ─────────────────────────────────
    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full max-w-[360px] max-h-[360px] min-w-[200px] min-h-[200px]"
      style={{ aspectRatio: '1' }}
    />
  );
};
