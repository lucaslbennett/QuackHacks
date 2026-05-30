import { useEffect, useRef } from "react";
import * as THREE from "three";
// @ts-expect-error - p5 ships without bundled type declarations; only passed through to Vanta
import p5 from "p5";
// Vanta ships untyped; TRUNK renders organic branching/spiraling line tendrils
// that flow and grow (powered by p5.js). Tuned soft blue over white. Its own
// canvas is used as a live texture and warped by the liquid shader below.
// @ts-expect-error - no type declarations published for vanta effects
import TRUNK from "vanta/dist/vanta.trunk.min";

interface VantaEffect {
  destroy: () => void;
}

// --- Liquid ripple tuning ----------------------------------------------------
const MAX_RIPPLES = 12; // must match #define MAXR in the shader
const RIPPLE_LIFE = 2.4; // seconds before a ripple fully fades
const SPAWN_GAP = 18; // px the cursor travels before emitting a ripple
const AMPLITUDE = 0.05; // peak UV displacement at a wave front (subtle)
const TEX_MAX = 1280; // cap the texture upload size for performance

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Each ripple expands as a ring; where the ring front crosses a pixel we bend
// that pixel's sample coordinate, so the actual tendril image deforms like the
// surface of water rather than having anything drawn on top of it.
const fragmentShader = /* glsl */ `
  precision highp float;
  #define MAXR ${MAX_RIPPLES}
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uAspect;
  uniform float uAmp;
  uniform int uCount;
  uniform vec4 uRipples[MAXR]; // xy = center (uv), z = age (s), w = strength

  void main() {
    vec2 uv = vUv;
    vec2 disp = vec2(0.0);

    for (int i = 0; i < MAXR; i++) {
      if (i >= uCount) break;
      vec4 r = uRipples[i];
      vec2 d = uv - r.xy;
      d.x *= uAspect; // keep the ripple circular on screen
      float dist = length(d);
      float radius = r.z * 0.55; // expansion speed (uv / s)
      float ring = abs(dist - radius);
      float env = smoothstep(0.09, 0.0, ring) * exp(-r.z * 2.0) * r.w;
      if (dist > 0.0001) {
        vec2 dir = d / dist;
        dir.x /= uAspect;
        disp += dir * env * uAmp * sin((dist - radius) * 55.0);
      }
    }

    // Pass the tendril colour through with its own alpha so transparent areas
    // stay transparent (the page's white shows through, just like the original).
    gl_FragColor = texture2D(uTex, uv + disp);
  }
`;

export default function AnimatedBackground() {
  const trunkRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectRef = useRef<VantaEffect | null>(null);

  // --- Base TRUNK tendrils (the existing image, used as the source texture) --
  useEffect(() => {
    if (effectRef.current || !trunkRef.current) return;

    effectRef.current = TRUNK({
      el: trunkRef.current,
      p5,
      // The liquid shader owns mouse interaction; TRUNK's own mouseControls
      // only slowed the tendrils on hover, so it's off.
      mouseControls: false,
      touchControls: false,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      scale: 1,
      scaleMobile: 1,
      color: 0x6b8cff,
      backgroundColor: 0xffffff,
      spacing: 0,
      chaos: 1.2,
    }) as VantaEffect;

    return () => {
      effectRef.current?.destroy();
      effectRef.current = null;
    };
  }, []);

  // --- Liquid distortion layer ----------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = trunkRef.current;
    if (!canvas || !host) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduceMotion) return; // TRUNK shows through undistorted underneath

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: false, // p5 canvas uses straight alpha
      });
      renderer.setClearColor(0x000000, 0);
    } catch {
      return; // no WebGL → the TRUNK canvas remains visible beneath
    }

    let disposed = false;
    let cleanup = () => {};

    const start = (srcCanvas: HTMLCanvasElement) => {
      // Keep the p5 canvas rendering (it's our live texture) but hide it
      // visually so only the distorted copy shows — no double image. CSS
      // opacity doesn't affect pixel readback for the texture.
      srcCanvas.style.opacity = "0";

      const scene = new THREE.Scene();
      const camera = new THREE.Camera();

      // Re-upload a downscaled copy of the tendrils rather than the full
      // (retina) p5 canvas every frame — keeps the GPU upload cheap & smooth.
      const texCanvas = document.createElement("canvas");
      const texCtx = texCanvas.getContext("2d")!;
      const texture = new THREE.CanvasTexture(texCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;

      const ripples = Array.from(
        { length: MAX_RIPPLES },
        () => new THREE.Vector4(0, 0, 999, 0)
      );
      const uniforms = {
        uTex: { value: texture },
        uAspect: { value: 1 },
        uAmp: { value: AMPLITUDE },
        uCount: { value: 0 },
        uRipples: { value: ripples },
      };

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      scene.add(mesh);

      const active: { x: number; y: number; born: number; strength: number }[] =
        [];
      const last = { x: -1, y: -1 };
      let rafId = 0;
      let frame = 0;

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(rect.width, rect.height, false);
        uniforms.uAspect.value = rect.width / rect.height || 1;
        const w = Math.min(Math.round(rect.width), TEX_MAX);
        const h = Math.round(w * (rect.height / rect.width || 1));
        texCanvas.width = w;
        texCanvas.height = h;
      };

      const onMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;
        const moved = Math.hypot(x - last.x, y - last.y);
        if (last.x >= 0 && moved < SPAWN_GAP) return;
        active.push({
          x: x / rect.width,
          y: 1 - y / rect.height, // flip to match the texture's orientation
          born: performance.now() / 1000,
          strength: Math.min(1, 0.35 + moved / 60),
        });
        if (active.length > MAX_RIPPLES) active.shift();
        last.x = x;
        last.y = y;
      };

      const render = () => {
        if (disposed) return;
        const now = performance.now() / 1000;

        for (let i = active.length - 1; i >= 0; i--) {
          if (now - active[i].born > RIPPLE_LIFE) active.splice(i, 1);
        }
        for (let i = 0; i < MAX_RIPPLES; i++) {
          const a = active[i];
          if (a) ripples[i].set(a.x, a.y, now - a.born, a.strength);
          else ripples[i].set(0, 0, 999, 0);
        }
        uniforms.uCount.value = active.length;

        // Refresh the tendril texture at ~30fps; ripples still animate at 60.
        frame++;
        if (frame % 2 === 0 && texCanvas.width > 0) {
          texCtx.clearRect(0, 0, texCanvas.width, texCanvas.height);
          texCtx.drawImage(srcCanvas, 0, 0, texCanvas.width, texCanvas.height);
          texture.needsUpdate = true;
        }

        renderer.render(scene, camera);
        rafId = requestAnimationFrame(render);
      };

      resize();
      window.addEventListener("resize", resize);
      window.addEventListener("mousemove", onMove);
      rafId = requestAnimationFrame(render);

      cleanup = () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", resize);
        window.removeEventListener("mousemove", onMove);
        srcCanvas.style.opacity = "";
        material.dispose();
        mesh.geometry.dispose();
        texture.dispose();
        renderer.dispose();
      };
    };

    // Vanta may not have created its canvas yet; wait briefly for it.
    let tries = 0;
    const waitForSource = () => {
      if (disposed) return;
      const src = host.querySelector("canvas");
      if (src) {
        start(src as HTMLCanvasElement);
      } else if (tries++ < 180) {
        requestAnimationFrame(waitForSource);
      }
    };
    waitForSource();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    // Confined to the right side with a soft edge fade so the motion lives in
    // one area and melts into the white rather than washing over everything.
    <div
      aria-hidden
      className="pointer-events-none fixed inset-y-0 right-0 z-0 w-full opacity-70 sm:w-[60%]"
      style={{
        WebkitMaskImage:
          "linear-gradient(to left, #000 30%, transparent 85%), linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        WebkitMaskComposite: "source-in",
        maskImage:
          "linear-gradient(to left, #000 30%, transparent 85%), linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        maskComposite: "intersect",
      }}
    >
      <div ref={trunkRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
