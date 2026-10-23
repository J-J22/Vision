import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  PixelEye — a big pixel-art eye rendered in a single WebGL shader.  */
/*  - Renders to a tiny low-res canvas, CSS scales it up (crisp pixels)*/
/*  - Iris follows the pointer, pupil dilates when the cursor is close */
/*  - Eyelids close & open: auto every 2.5-3s, and on a click anywhere */
/*  - 30fps cap, pauses off-screen / hidden tab                        */
/*  No dependencies besides React.                                     */
/* ------------------------------------------------------------------ */

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;    // canvas size in (low-res) pixels
uniform float uTime;   // seconds
uniform vec2  uLook;   // smoothed pointer direction, -1..1
uniform float uOpen;   // eyelid openness, 0 (closed) .. 1 (open)
uniform float uPupil;  // pupil radius

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// 4x4 Bayer ordered dither
float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }

// quantise a 0..1 value to 4 dithered steps
float q4(float v, vec2 fc){
  return floor(clamp(v, 0.0, 1.0) * 3.0 + bayer4(fc)) / 3.0;
}

vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d){
  if (t < 0.17) return a;
  if (t < 0.5)  return b;
  if (t < 0.83) return c;
  return d;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  float unit = min(uRes.y * 0.30, uRes.x * 0.5 / 2.05);
  vec2 p = (fc - vec2(0.5 * uRes.x, 0.56 * uRes.y)) / unit;
  float r = length(p);

  vec3 navy   = vec3(0.027, 0.008, 0.035);  // near-black, purple tint
  vec3 pink   = vec3(0.95, 0.30, 0.65);     // hot pink  (lid edge / lashes)
  vec3 purple  = vec3(0.55, 0.15, 0.62);     // purple    (socket outline)
  vec3 blush = vec3(1.00, 0.58, 0.82);     // blush pink
  vec3 violet = vec3(0.62, 0.18, 0.70);     // violet

  /* ---------- background: dithered pulsing glow + twinkling stars ---------- */
  vec3 col = navy;
  float glow = (1.0 - smoothstep(0.8, 3.4, r)) * (0.7 + 0.3 * sin(r * 8.0 - uTime * 1.5));
  col = mix(col, vec3(0.22, 0.04, 0.24), q4(glow, fc) * 0.6);

  float h = hash(fc);
  if (h > 0.9945) {
    float tw = step(0.35, fract(h * 91.7 + floor(uTime * 2.0) * 0.31));
    vec3 sc = h > 0.9978 ? blush : (h > 0.9960 ? pink : vec3(0.95, 0.88, 1.0));
    col = mix(col, sc, tw * 0.9);
  }

  /* ---------- eye geometry ---------- */
  const float W  = 1.9;    // half width
  const float H  = 0.86;   // upper lid height (fully open)
  const float HL = 0.62;   // lower lid height (fully open)
  const float TH = 0.032;  // outline thickness

  // both lids move: upper comes down, lower rises a little, they meet in the middle
  float lowerH = HL * (0.55 + 0.45 * uOpen);
  float t   = abs(p.x) / W;
  float e   = 1.0 - t * t;
  float top = e * mix(-lowerH, H, uOpen);   // upper lid line
  float bot = -e * lowerH;                  // lower lid line
  float d   = min(p.y - bot, top - p.y);
  float dt  = top - p.y - TH;               // distance below upper lid (inside eye)
  float db  = p.y - bot - TH;               // distance above lower lid (inside eye)

  if (d > TH) {
    /* ----- sclera (dithered shading) ----- */
    float sv = 0.65 * smoothstep(0.0, 0.5, dt) + 0.35 * smoothstep(0.0, 0.3, db);
    sv *= 1.0 - 0.4 * t * t;
    sv += 0.1;
    col = ramp4(q4(sv, fc),
                vec3(0.22, 0.06, 0.17), vec3(0.50, 0.22, 0.42),
                vec3(0.82, 0.62, 0.78), vec3(0.98, 0.90, 0.96));

    /* ----- iris / pupil ----- */
    vec2 off = uLook * vec2(0.85, 0.30);
    off.y -= (1.0 - uOpen) * 0.16;                 // eyeball rolls down a bit on blink
    float sq = 1.0 - 0.28 * abs(uLook.x);          // fake sphere: squash near the sides

    vec2 qd = p - off;
    qd.x /= sq;
    float ir = length(qd);
    const float IR = 0.62;

    if (ir < IR) {
      float rr  = ir / IR;
      float ang = atan(qd.y, qd.x + 0.00001);
      float streak = 0.5 + 0.5 * sin(ang * 12.0);
      float v = (1.0 - rr) * 0.95 + streak * 0.2 * rr;
      v -= 0.45 * (1.0 - smoothstep(0.0, 0.3, dt)); // upper lid casts a shadow

      vec3 ic = ramp4(q4(v, fc),
                      vec3(0.16, 0.02, 0.20), vec3(0.45, 0.05, 0.24),
                      vec3(0.88, 0.20, 0.55), vec3(1.00, 0.62, 0.82));
      if (rr > 0.88) ic = vec3(0.06, 0.01, 0.08);   // limbal ring (near-black)

      vec2 pp = p - off * 1.08;                      // pupil sits slightly ahead (parallax)
      pp.x /= sq;
      float ip = length(pp);
      float pr = uPupil;

      if (ip < pr + 0.14) {                          // golden ring around the pupil
        float qv = q4(1.0 - max(ip - pr, 0.0) / 0.14, fc);
        ic = qv > 0.8 ? blush : (qv > 0.4 ? violet : ic);
      }
      if (ip < pr) ic = vec3(0.02, 0.00, 0.03);      // pupil

      vec2 g1 = p - (off * 1.08 + vec2(-0.10, 0.12)); // square pixel glints
      if (abs(g1.x) < 0.055 && abs(g1.y) < 0.055) ic = vec3(1.0);
      vec2 g2 = p - (off * 1.08 + vec2(0.09, -0.09));
      if (abs(g2.x) < 0.028 && abs(g2.y) < 0.028) ic = vec3(1.00, 0.78, 0.93);

      col = ic;
    }
  } else if (abs(d) <= TH && e > -0.06) {
    /* ----- lid edge line ----- */
    col = pink;
  } else if (e > 0.0 && p.y < e * (H + 0.30) && p.y > -e * (HL + 0.16)) {
    /* ----- solid eyelid skin: covers the eyeball while the lids close ----- */
    bool above = p.y > top;
    float dd = above ? (p.y - top - TH) : (bot - TH - p.y);   // distance from lash line
    float v = 1.0 - clamp(dd / 0.35, 0.0, 1.0);
    col = ramp4(q4(v, fc),
                vec3(0.05, 0.01, 0.07), vec3(0.16, 0.03, 0.14),
                vec3(0.30, 0.06, 0.24), vec3(0.48, 0.10, 0.40));
    if (above && dd < 0.035) col = pink;             // thicker upper lash line
    float edge = above ? e * (H + 0.30) : -e * (HL + 0.16);
    if (abs(p.y - edge) < 0.03) col = purple;         // socket outline
  }

  /* ---------- vignette ---------- */
  vec2 uv = fc / uRes - 0.5;
  col *= 1.0 - dot(uv, uv) * 0.9;

  gl_FragColor = vec4(col, 1.0);
}
`;

const BLINK_MS = 420; // full blink: ~160ms close, short hold, ~210ms open
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (c) => c * c * (3 - 2 * c);

// b: 0..1 progress through the blink -> eyelid openness 1..0..1
const blinkOpenness = (b) => {
  if (b < 0.38) return smooth(1 - b / 0.38); // lids closing
  if (b < 0.5) return 0; // fully closed
  return smooth((b - 0.5) / 0.5); // lids opening
};

const compile = (gl, type, src) => {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || "Shader compile failed");
  }
  return s;
};

/* ------------------------------------------------------------------ */
/*  <PixelEye /> — drop it in any positioned container                 */
/* ------------------------------------------------------------------ */
const PixelEye = ({
  pixelSize = 6, // CSS px per "art pixel" (smaller on phones automatically)
  fps = 30, // frame cap — 30 suits the retro look and halves GPU work
  blinkMin = 2500, // automatic blink gap: random between blinkMin and blinkMax (ms)
  blinkMax = 3000,
  idleLook = true, // eye wanders on its own when the pointer is still
  respectReducedMotion = false, // set true to disable blink/wander for prefers-reduced-motion users
  className = "",
}) => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const reduced =
      respectReducedMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- GL setup ---------- */
    let loc = {};
    const setup = () => {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || "Program link failed");
      }
      gl.useProgram(prog);

      // one oversized triangle covers the screen (cheaper than a quad)
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

      loc = {
        res: gl.getUniformLocation(prog, "uRes"),
        time: gl.getUniformLocation(prog, "uTime"),
        look: gl.getUniformLocation(prog, "uLook"),
        open: gl.getUniformLocation(prog, "uOpen"),
        pupil: gl.getUniformLocation(prog, "uPupil"),
      };
    };

    try {
      setup();
    } catch (err) {
      console.error("[PixelEye]", err);
      return;
    }

    /* ---------- state ---------- */
    const look = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    let rect = wrap.getBoundingClientRect();
    let lastMove = -Infinity;
    let nextSaccade = 0;
    let blinkStart = -1;
    const pickGap = () => blinkMin + Math.random() * (blinkMax - blinkMin);
    let nextBlink = performance.now() + pickGap();
    const t0 = performance.now();
    let open = 1;
    let time = 0;
    let pupil = 0.26;
    let raf = 0;
    let last = 0;
    let inView = true;
    let lost = false;

    const startBlink = (now) => {
      if (reduced || blinkStart >= 0) return; // ignore while already blinking
      blinkStart = now;
      nextBlink = now + pickGap(); // restart the timer so blinks never double up
    };

    /* ---------- render ---------- */
    const render = () => {
      gl.uniform2f(loc.res, canvas.width, canvas.height);
      gl.uniform1f(loc.time, time);
      gl.uniform2f(loc.look, look.x, look.y);
      gl.uniform1f(loc.open, open);
      gl.uniform1f(loc.pupil, pupil);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frameMs = 1000 / fps;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = now - last;
      if (dt < frameMs - 1) return; // throttle
      last = now;
      const dts = Math.min(dt, 100) / 1000;

      // idle wandering when the pointer hasn't moved for a while
      if (idleLook && !reduced && now - lastMove > 3000 && now > nextSaccade) {
        target.x = (Math.random() * 2 - 1) * 0.75;
        target.y = (Math.random() * 2 - 1) * 0.45;
        nextSaccade = now + 900 + Math.random() * 1800;
      }

      // smooth follow (frame-rate independent)
      const k = 1 - Math.exp(-dts * 12);
      look.x += (target.x - look.x) * k;
      look.y += (target.y - look.y) * k;

      // automatic blink on the interval
      if (now >= nextBlink) startBlink(now);

      // eyelid animation
      open = 1;
      if (blinkStart >= 0) {
        const b = (now - blinkStart) / BLINK_MS;
        if (b >= 1) blinkStart = -1;
        else open = blinkOpenness(b);
      }

      // pupil dilates as the cursor gets close to the eye's centre
      pupil = 0.3 - 0.1 * clamp(Math.hypot(look.x, look.y), 0, 1);
      time = reduced ? 0 : (now - t0) / 1000;

      render();
    };

    const sync = () => {
      const should = inView && !document.hidden && !lost;
      if (should && !raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      } else if (!should && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    /* ---------- sizing: tiny canvas, scaled up by CSS ---------- */
    const resize = () => {
      rect = wrap.getBoundingClientRect();
      const px = rect.width < 640 ? Math.max(3, pixelSize - 2) : pixelSize;
      const w = Math.max(1, Math.round(rect.width / px));
      const h = Math.max(1, Math.round(rect.height / px));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      render(); // redraw immediately so resizing never flashes blank
    };

    /* ---------- input ---------- */
    const onMove = (e) => {
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.44; // eye centre sits slightly above middle
      target.x = clamp((e.clientX - cx) / (rect.width * 0.4), -1, 1);
      target.y = clamp(-(e.clientY - cy) / (rect.height * 0.4), -1, 1);
      lastMove = performance.now();
    };
    const onDown = (e) => {
      onMove(e);
      startBlink(performance.now()); // click anywhere = blink
    };
    const onLeave = () => {
      lastMove = -Infinity;
      if (!idleLook) {
        target.x = 0;
        target.y = 0;
      }
    };
    const onScroll = () => {
      rect = wrap.getBoundingClientRect();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", sync);

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    io.observe(wrap);

    const onLost = (e) => {
      e.preventDefault();
      lost = true;
      sync();
    };
    const onRestored = () => {
      try {
        setup();
        lost = false;
        resize();
        sync();
      } catch (err) {
        console.error("[PixelEye]", err);
      }
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    resize();
    sync();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [pixelSize, fps, blinkMin, blinkMax, idleLook, respectReducedMotion]);

  return (
    <div ref={wrapRef} className={className} aria-hidden="true">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Example hero section — swap the copy / buttons for your own        */
/*  Add to index.html:                                                 */
/*  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
/* ------------------------------------------------------------------ */
const PIXEL_FONT = { fontFamily: '"Press Start 2P", ui-monospace, monospace' };

const PixelEyeHero = ({ placeholder = "It sees everything you do", onSubmit }) => {
  const [value, setValue] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSubmit?.(text);
    setValue("");
  };

  return (
    <section
      className="relative isolate flex h-[100dvh] w-full flex-col justify-between overflow-hidden bg-[#07020a] p-4 text-pink-100 sm:p-8"
      style={PIXEL_FONT}
    >
      {/* WebGL layer */}
      <PixelEye className="absolute inset-0 -z-10 overflow-hidden" />

      {/* CRT scanlines (pure CSS, zero GPU cost) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-40 bg-[image:repeating-linear-gradient(to_bottom,transparent_0px,transparent_2px,rgba(0,0,0,0.45)_2px,rgba(0,0,0,0.45)_4px)]"
      />

      {/* top bar */}
      <header className="flex items-start justify-between gap-4">
        <h1 className="bg-pink-400 px-3 py-2 text-sm tracking-widest text-black shadow-[4px_4px_0_#6b1237] sm:px-4 sm:text-xl">
          VISION
        </h1>
        <button
          type="button"
          className="border-b-4 border-fuchsia-900 bg-pink-400 px-4 py-2 text-[10px] tracking-widest text-black transition-transform hover:translate-y-px active:translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pink-300 sm:text-xs"
        >
          Sign in
        </button>
      </header>

      {/* input */}
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 sm:gap-4">
        <form
          onSubmit={handleSubmit}
          className="flex w-full items-stretch border-2 border-fuchsia-500/60 bg-black/70 transition-colors focus-within:border-pink-400"
        >
          <label htmlFor="vision-input" className="sr-only">
            Vision input
          </label>
          <input
            id="vision-input"
            name="vision"
            type="text"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[10px] text-pink-100 caret-pink-400 outline-none placeholder:text-pink-300/60 sm:px-4 sm:py-4 sm:text-xs"
          />
          <button
            type="submit"
            className="border-b-4 border-fuchsia-900 bg-pink-400 px-4 text-[10px] tracking-widest text-black transition-transform hover:translate-y-px active:translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-200 sm:px-5 sm:text-xs"
          >
            Enter
          </button>
        </form>
        <p className="text-center text-[8px] leading-relaxed text-pink-200/60 sm:text-[10px]">
          Move your cursor. Click anywhere to make it blink.
        </p>
      </div>
    </section>
  );
};

export { PixelEye };
export default PixelEyeHero;