/*
 * Interactive water for the hero.
 *
 * A height-field wave simulation runs on the GPU (WebGL2, half-float ping-pong
 * textures). The pointer drops ripples into it, a few ambient drops keep it alive,
 * and the hero video is drawn through the surface: each pixel is refracted by the
 * slope of the waves and picks up a soft specular glint.
 *
 * If WebGL2 or float render targets are missing, or the visitor prefers reduced
 * motion, nothing happens and the plain <video> stays visible.
 */
(() => {
  const canvas = document.getElementById('heroGl');
  const video = document.getElementById('heroVideo');
  const hero = canvas && canvas.closest('.hero');
  if (!canvas || !video || !hero) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return;

  // ---------------------------------------------------------------- shaders
  const VERT = `#version 300 es
  in vec2 p; out vec2 uv;
  void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  const UPDATE = `#version 300 es
  precision highp float;
  uniform sampler2D state; uniform vec2 texel;
  in vec2 uv; out vec4 o;
  void main() {
    vec4 info = texture(state, uv);
    float avg = (
      texture(state, uv - vec2(texel.x, 0.0)).r +
      texture(state, uv + vec2(texel.x, 0.0)).r +
      texture(state, uv - vec2(0.0, texel.y)).r +
      texture(state, uv + vec2(0.0, texel.y)).r) * 0.25;
    info.g += (avg - info.r) * 2.0;   // velocity pulls toward neighbours
    info.g *= 0.992;                  // damping
    info.r += info.g;
    info.r *= 0.998;
    o = info;
  }`;

  const DROP = `#version 300 es
  precision highp float;
  uniform sampler2D state; uniform vec2 center; uniform float radius; uniform float strength; uniform float aspect;
  in vec2 uv; out vec4 o;
  void main() {
    vec4 info = texture(state, uv);
    vec2 d = (uv - center) * vec2(aspect, 1.0);
    float k = max(0.0, 1.0 - length(d) / radius);
    k = 0.5 - cos(k * 3.14159265) * 0.5;
    info.r += k * strength;
    o = info;
  }`;

  const RENDER = `#version 300 es
  precision highp float;
  uniform sampler2D state; uniform sampler2D tex; uniform vec2 texel;
  uniform vec2 scale; uniform vec2 offset; uniform float refraction;
  in vec2 uv; out vec4 o;
  void main() {
    float hL = texture(state, uv - vec2(texel.x, 0.0)).r;
    float hR = texture(state, uv + vec2(texel.x, 0.0)).r;
    float hD = texture(state, uv - vec2(0.0, texel.y)).r;
    float hU = texture(state, uv + vec2(0.0, texel.y)).r;
    vec2 slope = vec2(hR - hL, hU - hD);

    vec2 vuv = uv * scale + offset + slope * refraction;
    vec3 col = texture(tex, clamp(vuv, vec2(0.001), vec2(0.999))).rgb;

    // wave faces tilted toward the light from the surface catch a glint, the others darken
    float face = dot(slope, normalize(vec2(-0.45, 0.9)));
    col += vec3(0.65, 0.88, 1.0) * min(max(face, 0.0) * 28.0, 0.35);
    col *= 1.0 - min(max(-face, 0.0) * 14.0, 0.22);
    o = vec4(col, 1.0);
  }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(frag) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  let progUpdate, progDrop, progRender;
  try {
    progUpdate = program(UPDATE);
    progDrop = program(DROP);
    progRender = program(RENDER);
  } catch (err) {
    console.warn('Water effect disabled:', err);
    return;
  }

  // full-screen triangle
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // ---------------------------------------------------------------- simulation targets
  let sim = null; // { w, h, a: {tex, fbo}, b: {tex, fbo} }
  function target(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo };
  }
  function freeSim() {
    if (!sim) return;
    [sim.a, sim.b].forEach((t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); });
  }

  // video texture
  const vtex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, vtex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  let hasFrame = false;

  // ---------------------------------------------------------------- sizing
  let cw = 0, ch = 0, aspect = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.round(r.width * dpr));
    const h = Math.max(2, Math.round(r.height * dpr));
    if (w === cw && h === ch) return;
    cw = w; ch = h; aspect = w / h;
    canvas.width = w; canvas.height = h;
    const sh = r.width < 760 ? 200 : 300;
    const sw = Math.round(sh * aspect);
    freeSim();
    sim = { w: sw, h: sh, a: target(sw, sh), b: target(sw, sh) };
    if (hasFrame) fit = coverFit();
  }

  function run(prog, setup) {
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function step(prog, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sim.b.fbo);
    gl.viewport(0, 0, sim.w, sim.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sim.a.tex);
    run(prog, (u) => { gl.uniform1i(u.state, 0); setup(u); });
    const t = sim.a; sim.a = sim.b; sim.b = t;
  }

  // ---------------------------------------------------------------- input
  const drops = [];
  const RADIUS = 0.028;
  let last = null;
  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) { last = null; return; }
    if (last) {
      const dx = (x - last.x) * aspect, dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      const n = Math.min(12, Math.ceil(dist / (RADIUS * 0.6)));
      for (let i = 1; i <= n; i++) {
        drops.push({ x: last.x + (x - last.x) * i / n, y: last.y + (y - last.y) * i / n, r: RADIUS, s: 0.018 });
      }
    } else {
      drops.push({ x, y, r: RADIUS, s: 0.018 });
    }
    last = { x, y };
  }
  hero.addEventListener('pointermove', pointer, { passive: true });
  hero.addEventListener('pointerdown', (e) => {
    pointer(e);
    const r = canvas.getBoundingClientRect();
    drops.push({ x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, r: RADIUS * 2.4, s: 0.08 });
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { last = null; });

  // ambient drops so the water moves before anyone touches it
  let nextAmbient = 0;
  function ambient(now) {
    if (now < nextAmbient) return;
    nextAmbient = now + 700 + Math.random() * 1100;
    drops.push({ x: 0.08 + Math.random() * 0.6, y: 0.25 + Math.random() * 0.65, r: RADIUS * (1.2 + Math.random()), s: 0.012 + Math.random() * 0.01 });
  }

  // ---------------------------------------------------------------- render loop
  function coverFit() {
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const va = vw / vh;
    const pos = parseFloat(getComputedStyle(video).objectPosition) / 100 || 0.5;
    let fx = 1, fy = 1;
    if (aspect > va) fy = va / aspect; else fx = aspect / va;
    return { scale: [fx, fy], offset: [(1 - fx) * pos, (1 - fy) * 0.5] };
  }

  let raf = 0, running = false, fit = null;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    resize();

    if (video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, vtex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      if (!hasFrame) {
        hasFrame = true;
        fit = coverFit();
        hero.classList.add('has-water');
      }
    }
    if (!hasFrame) return;

    ambient(now);
    while (drops.length) {
      const d = drops.shift();
      step(progDrop, (u) => {
        gl.uniform2f(u.center, d.x, d.y);
        gl.uniform1f(u.radius, d.r);
        gl.uniform1f(u.strength, d.s);
        gl.uniform1f(u.aspect, aspect);
      });
    }
    for (let i = 0; i < 2; i++) {
      step(progUpdate, (u) => gl.uniform2f(u.texel, 1 / sim.w, 1 / sim.h));
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sim.a.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, vtex);
    run(progRender, (u) => {
      gl.uniform1i(u.state, 0);
      gl.uniform1i(u.tex, 1);
      gl.uniform2f(u.texel, 1 / sim.w, 1 / sim.h);
      gl.uniform2f(u.scale, fit.scale[0], fit.scale[1]);
      gl.uniform2f(u.offset, fit.offset[0], fit.offset[1]);
      gl.uniform1f(u.refraction, 1.6);
    });
  }

  function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  video.addEventListener('loadedmetadata', () => { if (hasFrame) fit = coverFit(); });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop();
    hero.classList.remove('has-water');
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => (en.isIntersecting ? start() : stop()), { threshold: 0 }).observe(hero);
  } else {
    start();
  }
})();
