// Tornado — Originkit
// Originkit — props baked into the default export.
'use client'

import * as React from 'react'
import * as THREE from 'three'

/** Whether the reader has asked for less movement. Read straight off the media
 *  query rather than through framer-motion: it is one boolean, and the import is
 *  a dependency this component otherwise has no use for. Starts false so the
 *  server and the first client render agree, then corrects on mount. */
function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

// One DEFAULTS drives both the destructure fallbacks and the prop defaults.
// Every slider is a whole number where it can be. The values they actually mean
// live beside the engine as *_MAX constants and are mapped in one place, below.
const DEFAULTS = {
  background: '#000000',
  topRadius: 380,
  waistRadius: 53,
  waistPosition: 50,
  bottomRadius: 1150,
  twist: 3,
  zoom: 75,
  speed: 10,
  direction: 'right' as 'right' | 'left',
  lineOptions: {
    count: 240,
    color: '#ffffff',
    glow: 10,
  },
  dots: true,
  dotOptions: {
    count: 8000,
    size: 20,
    color: '#ffffff',
    glow: 10,
    flicker: 10,
  },
  comets: true,
  cometOptions: {
    count: 10,
    speed: 6,
    color: '#F9731A',
    glow: 6,
    tail: 19,
    delay: 8,
    collide: 6,
  },
  repel: false,
  repelOptions: {
    radius: 60,
    strength: 10,
  },
}

type VortexEngineConfig = {
  floorRadius: number
  waistRadius: number
  crownRadius: number
  waistAt: number
  twist: number
  zoom: number
  flowDir: number
  flowSpeed: number
  lineCount: number
  lineColor: string
  lineGlow: number
  showDots: boolean
  dotCount: number
  dotSize: number
  dotColor: string
  dotGlow: number
  dotFlicker: number
  showComets: boolean
  cometCount: number
  cometSpeed: number
  cometColor: string
  cometGlow: number
  cometTail: number
  cometDelay: number
  collideForce: number
  hoverRepel: boolean
  repelRadius: number
  repelStrength: number
  running: boolean
}

/* ============================================================ constants */

const TAU = Math.PI * 2

// The three radii and every other reach read in screen pixels on the panel and
// world units on the wire. The camera frames the form's full height to the
// component's height, so at the 600px intrinsic height ten world units span the
// frame — sixty pixels to the unit. Bottom 900px is the 15 the effect was
// authored with, waist 30px its 0.5, top 300px its 5.
const PX_PER_WORLD = 60

// Samples in each baked curve, and segments along each strand. Neither is worth
// a control: they only ever trade smoothness for memory, and there is no reason
// to ship anything but the smooth end.
const CURVE_SAMPLES = 1024
const STRAND_SEGMENTS = 400

// How far the strands sway off their ideal path, as a share of the local radius.
const WOBBLE = 0.008
// The share of each strand's length that fades out at either end, so the form
// dissolves rather than stopping on a cut edge.
const FADE_ZONE = 0.15

// The form's height in world units. The camera is solved to frame exactly this,
// so the component's own height is what sizes the vortex.
const FORM_HEIGHT = 10

// The zoom the framing is solved for, and the default. Above it we push
// in, below it the view widens.
const BASE_ZOOM = 67
// zoom prop -> camera FOV. The prop reads as a zoom (higher is closer), which
// is the inverse of what FOV does, so it is mirrored — around BASE_ZOOM rather
// than the slider's midpoint, which keeps the tuned default a fixed point.
const fovForZoom = (zoom: number) => clamp(2 * BASE_ZOOM - zoom, 1, 175)

// 0..10 sliders onto the values their top ends mean.
const LINE_GLOW_MAX = 1
const DOT_GLOW_MAX = 4.2
const COMET_SPEED_MAX = 0.15
const COMET_GLOW_MAX = 1
const DOT_SIZE_SCALE = 1000

// The ripple. A burst shoves every dot inside its radius, and each dot is then
// sprung back to where it belongs — position and size on their own springs, so
// a dot swells as it is pushed and settles as it returns.
//
// Reach and force are constants rather than dials: a comet strike is the only
// thing that throws one now, and it wants the same ripple every time.
const RIPPLE_RADIUS = 2
const RIPPLE_STRENGTH = 0.5
const RIPPLE_SPRING = 50
const RIPPLE_DAMPING = 9
const SCALE_SPRING = 65
const SCALE_DAMPING = 11
const SCALE_PEAK = 1.8

// The shockwave that runs out from a burst: a ring travelling at WAVE_SPEED,
// this wide, fading over DECAY and gone by MAX_LIFE. It moves the STRANDS, not
// the dots — the dots have their springs.
const WAVE_SPEED = 5
const WAVE_WIDTH = 1.2
const WAVE_DECAY = 0.8
const WAVE_LIFE = 2.5
const WAVE_STRENGTH = 0.04
const MAX_WAVES = 16

// The stretch of a strand a comet runs, and how much of either end it fades
// over. Turning right it climbs from LOW to HIGH; turning left it starts at
// HIGH and comes back down, which is the same run read backwards.
const RUN_LOW = 0.03
const RUN_HIGH = 0.95
const RUN_FADE = 0.1

// A comet running into a dot: how close counts, how much faster it goes and for
// how long, how brightly the dot flashes and how long it stays gone.
const HIT_RADIUS = 0.8
const HIT_BOOST = 1.6
const HIT_BOOST_TIME = 0.4
const HIT_FLASH = 6
const HIT_FADE = 0.6
const HIT_POP = 1.3
const HIT_RESPAWN = 8

// Strands are rewritten at this rate rather than every frame. Four hundred
// points across eighty strands is thirty-two thousand vertices to lay out, and
// at a flow this slow nobody can tell it from sixty.
const STRAND_HZ = 1 / 30

// The layers do not all arrive at once. Seconds from the first frame.
const ENTRANCE = {
  strandStart: 0,
  strandEnd: 2,
  dotStart: 1.2,
  dotEnd: 3,
  cometStart: 3,
  cometEnd: 5,
}

// What Repel Strength 100% comes to in NDC.
const REPEL_MAX_NDC = 0.45

/* ============================================================ maths */

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b)

/** Ease used by the entrance fades — quick off the mark, long tail. */
function ramp(now: number, from: number, to: number) {
  if (now <= from) return 0
  if (now >= to) return 1
  const t = (now - from) / (to - from)
  return 1 - (1 - t) * (1 - t) * (1 - t)
}

/**
 * Monotone cubic interpolation through a set of points.
 *
 * Monotone specifically, not a plain spline: the radius profile has a hard pinch
 * at the waist, and an ordinary cubic overshoots either side of a corner like
 * that — the strands would bulge back OUT just before the neck and cross each
 * other doing it. The Fritsch-Carlson limiter below is what stops that.
 */
function monotone(points: [number, number][]) {
  const n = points.length
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    slope[i] = (points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0])
  }
  const m: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  m[n - 1] = slope[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(slope[i]) < 1e-12) {
      m[i] = m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      m[i] = k * a * slope[i]
      m[i + 1] = k * b * slope[i]
    }
  }
  return (x: number) => {
    if (x <= points[0][0]) return points[0][1]
    if (x >= points[n - 1][0]) return points[n - 1][1]
    let i = 0
    while (i < n - 2 && points[i + 1][0] < x) i++
    const h = points[i + 1][0] - points[i][0]
    const t = (x - points[i][0]) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * points[i][1] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * points[i + 1][1] +
      (t3 - t2) * h * m[i + 1]
    )
  }
}

/** Bake a curve to a lookup table — it is read millions of times a second. */
function bake(fn: (x: number) => number) {
  const table = new Float32Array(CURVE_SAMPLES)
  for (let i = 0; i < CURVE_SAMPLES; i++) table[i] = fn(i / (CURVE_SAMPLES - 1))
  return table
}

function sample(table: Float32Array, t: number) {
  if (t <= 0) return table[0]
  const last = table.length - 1
  if (t >= 1) return table[last]
  const x = t * last
  const i = x | 0
  return table[i] + (table[i + 1] - table[i]) * (x - i)
}

/* ============================================================ shape */

type Shape = ReturnType<typeof makeShape>

/**
 * The vortex as three curves against distance along a strand: how far out it is,
 * how high, and how far round.
 *
 * The intermediate radius points are placed as fractions of wherever the waist
 * sits rather than at fixed heights. At the middle they land exactly on the
 * numbers the effect was authored with, and anywhere else the profile keeps its
 * shape instead of the control points crossing over each other — which the
 * spline above cannot be built from at all.
 */
function makeShape(cfg: VortexEngineConfig) {
  const w = clamp(cfg.waistAt, 0.08, 0.92)
  const floor = cfg.floorRadius
  const crown = cfg.crownRadius
  const turn = cfg.twist * TAU

  const radius = bake(
    monotone([
      [0, floor],
      [0.24 * w, floor * 0.667],
      [0.5 * w, floor * 0.3],
      [0.76 * w, floor * 0.08],
      [w, cfg.waistRadius],
      [w + 0.3 * (1 - w), crown * 0.2],
      [w + 0.6 * (1 - w), crown * 0.44],
      [1, crown],
    ]),
  )
  const height = bake(
    monotone([
      [0, 0],
      [0.1, 0.2],
      [0.2, 0.8],
      [0.35, 2],
      [0.5, FORM_HEIGHT * 0.38],
      [0.75, FORM_HEIGHT * 0.7],
      [1, FORM_HEIGHT],
    ]),
  )
  const angle = bake(
    monotone([
      [0, 0],
      [0.15, 0.15 * turn],
      [0.25, 0.25 * turn],
      [0.45, 0.55 * turn],
      [0.6, 0.7 * turn],
      [0.8, 0.88 * turn],
      [1, turn],
    ]),
  )

  return {
    /** Write one point of a strand into `out` at `at`. */
    writePoint(
      out: Float32Array,
      at: number,
      s: number,
      lane: number,
      flow: number,
      wobble: number,
      phase: number,
      time: number,
    ) {
      const r = sample(radius, s)
      const y = sample(height, s)
      const a = sample(angle, s) + lane + flow
      // The sway is a share of the local radius, not a fixed distance: a
      // fixed one is nothing against the floor plate and violent at the
      // waist, which is exactly where every strand converges.
      const rr = r + Math.sin(s * 25 + phase + time * 0.3) * wobble * r
      out[at] = Math.cos(a) * rr
      out[at + 1] = y
      out[at + 2] = Math.sin(a) * rr
    },
    lane: (i: number, total: number) => (i / total) * TAU,
  }
}

/* ============================================================ engine */

type VortexAPI = {
  rebuild: () => void
  dispose: () => void
}

/**
 * The engine holds the GL context for as long as the component is mounted, and
 * reads its settings from a ref rather than a snapshot. Two kinds of edit come
 * out of the config and they cost very different things:
 *
 *  - Speed, glow, colours, the ripple: read off the ref inside the loop, so they
 *    land on the next frame and cost nothing.
 *  - Anything deciding how many things there are or what shape they sit on:
 *    needs the buffers laid out again, which is what rebuild() does — inside the
 *    context that is already open, never by opening another one. A canvas whose
 *    context has been released will not hand out a second one, so tearing the
 *    engine down per edit means a component that goes blank at the first change.
 */
function createVortex(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  cfgRef: { current: VortexEngineConfig },
): VortexAPI {
  /* ---------------------------------------- renderer, kept for good */
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.toneMapping = THREE.ReinhardToneMapping
  renderer.toneMappingExposure = 1.25

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(fovForZoom(cfgRef.current.zoom), 1, 0.1, 500)
  const group = new THREE.Group()
  scene.add(group)

  /* ---------------------------------------- hover repulsion
   * One set of uniforms shared by every material, so the pointer moves the
   * whole form as one field. The materials are stock three ones — the snippet
   * is patched into each at compile time rather than the layers being rebuilt
   * as custom shaders, which would mean reimplementing instancing and vertex
   * colours to get back exactly what three already draws. */
  const repelUniforms = {
    uMouse: { value: new THREE.Vector2(0, 0) },
    uAspect: { value: 1 },
    uRadius: { value: 0.2 },
    uStrength: { value: 0 },
  }
  const withRepel = <T extends THREE.Material>(material: T): T => {
    material.onBeforeCompile = (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string }) => {
      shader.uniforms.uMouse = repelUniforms.uMouse
      shader.uniforms.uAspect = repelUniforms.uAspect
      shader.uniforms.uRadius = repelUniforms.uRadius
      shader.uniforms.uStrength = repelUniforms.uStrength
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `
                    uniform vec2 uMouse;
                    uniform float uAspect;
                    uniform float uRadius;
                    uniform float uStrength;
                    void main() {
                    `,
        )
        // Last thing before the vertex is done with: the shove is in
        // clip space, so it is a fixed number of screen pixels whatever
        // the depth and wherever the spin has carried the vertex to.
        .replace(
          '#include <fog_vertex>',
          `
                    #include <fog_vertex>
                    if (uStrength > 0.0 && uRadius > 0.0 && gl_Position.w > 0.0) {
                        vec2 ndc = gl_Position.xy / gl_Position.w;
                        vec2 off = ndc - uMouse;
                        float dist = length(off * vec2(uAspect, 1.0));
                        float f = uStrength * exp(-(dist * dist) / (2.0 * uRadius * uRadius));
                        float m = length(off);
                        if (m > 1e-4) {
                            ndc += (off / m) * f;
                            gl_Position.xy = ndc * gl_Position.w;
                        }
                    }
                    `,
        )
    }
    return material
  }

  /* ---------------------------------------- per-build state */
  type Strand = {
    lane: number
    speed: number
    pulse: number
    wobblePhase: number
    from: number
    to: number
    bright: number
    offset: number
    pts: Float32Array
    cols: Float32Array
  }
  type Dot = {
    s: number
    lane: number
    strand: number
    pulse: number
    flickerRate: number
    bright: number
  }
  type Comet = {
    bright: number
    lane: number
    speed: number
    pulse: number
    wobblePhase: number
    base: number
    boost: number
    boostMul: number
    racing: boolean
    s: number
    idle: number
    idleFor: number
    trail: Float32Array
    trailCol: Float32Array
    geo: THREE.BufferGeometry
    line: THREE.Line
    head: THREE.Sprite
  }
  type Wave = {
    active: boolean
    x: number
    y: number
    z: number
    at: number
    // How hard the strike that threw it was, so a soft hit ripples softly.
    amp: number
  }

  let shape: Shape
  let disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x)
    return x
  }

  let strands: Strand[] = []
  let strandPos = new Float32Array(0)
  let strandCol = new Float32Array(0)
  let strandGeo: THREE.BufferGeometry | null = null

  let dotList: Dot[] = []
  let dotCount = 0
  let dotMesh: THREE.InstancedMesh | null = null
  let dotColors = new Float32Array(0)
  let dotHome = new Float32Array(0) // where the flow says it should be
  let dotShift = new Float32Array(0) // how far the ripple has pushed it
  let dotVel = new Float32Array(0)
  let dotScale = new Float32Array(0)
  let dotScaleVel = new Float32Array(0)
  let dotHitAt = new Float32Array(0)
  let dotFlash = new Float32Array(0)
  let dotAlive = new Float32Array(0)
  let rippleAwake = false

  let cometList: Comet[] = []
  let cometTex: THREE.Texture | null = null

  let waves: Wave[] = []
  let wavesAwake = false

  const dummy = new THREE.Matrix4()
  const tint = {
    strand: new THREE.Color(),
    dot: new THREE.Color(),
    comet: new THREE.Color(),
  }
  // What the tints were last parsed from. Colours arrive as strings, and
  // re-parsing three of them every frame to find out they have not changed is
  // work for nothing.
  let lastColors = { line: '', dot: '', comet: '' }

  /** Pick up any colour the config has changed since the last frame. The comet
   *  heads carry their own material, so they are re-tinted alongside. */
  function syncColors(cfg: VortexEngineConfig) {
    if (cfg.lineColor !== lastColors.line) {
      tint.strand.set(cfg.lineColor)
      lastColors.line = cfg.lineColor
    }
    if (cfg.dotColor !== lastColors.dot) {
      tint.dot.set(cfg.dotColor)
      lastColors.dot = cfg.dotColor
    }
    if (cfg.cometColor !== lastColors.comet) {
      tint.comet.set(cfg.cometColor)
      lastColors.comet = cfg.cometColor
      for (const comet of cometList) {
        ;(comet.head.material as THREE.SpriteMaterial).color.setRGB(
          tint.comet.r * 1.2,
          tint.comet.g * 1.2,
          tint.comet.b * 1.2,
        )
      }
    }
  }

  /** A soft round blob on a canvas, for the sprites. */
  function blob(size: number, stops: [number, string][]) {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx2d = c.getContext('2d')
    if (ctx2d) {
      const g = ctx2d.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      for (const [at, color] of stops) g.addColorStop(at, color)
      ctx2d.fillStyle = g
      ctx2d.fillRect(0, 0, size, size)
    }
    const tex = new THREE.Texture(c)
    tex.needsUpdate = true
    return tex
  }

  /* ---------------------------------------- build */
  function build() {
    const cfg = cfgRef.current

    for (let i = group.children.length - 1; i >= 0; i--) {
      group.remove(group.children[i])
    }
    for (const d of disposables) d.dispose()
    disposables = []

    shape = makeShape(cfg)
    camera.fov = fovForZoom(cfg.zoom)
    camera.updateProjectionMatrix()

    syncColors(cfg)

    /* -------------------------------- strands */
    const count = Math.max(3, Math.round(cfg.lineCount))
    const segs = STRAND_SEGMENTS - 1
    const verts = count * segs * 2
    strandPos = new Float32Array(verts * 3)
    strandCol = new Float32Array(verts * 3)
    strandGeo = track(new THREE.BufferGeometry())
    strandGeo.setAttribute('position', new THREE.BufferAttribute(strandPos, 3).setUsage(THREE.DynamicDrawUsage))
    strandGeo.setAttribute('color', new THREE.BufferAttribute(strandCol, 3).setUsage(THREE.DynamicDrawUsage))
    const strandMat = track(
      withRepel(
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    )
    const strandLines = new THREE.LineSegments(strandGeo, strandMat)
    strandLines.frustumCulled = false
    group.add(strandLines)

    strands = []
    for (let i = 0; i < count; i++) {
      // Every strand runs the full height at the same brightness. The
      // slight spread in speed and phase below is what keeps that from
      // reading as one rigid mesh.
      strands.push({
        lane: shape.lane(i, count),
        speed: 0.95 + Math.random() * 0.1,
        pulse: Math.random() * TAU,
        wobblePhase: Math.random() * TAU,
        from: 0,
        to: 1,
        bright: 0.5,
        offset: i * segs * 2 * 3,
        pts: new Float32Array(STRAND_SEGMENTS * 3),
        cols: new Float32Array(STRAND_SEGMENTS * 3),
      })
    }

    /* -------------------------------- dots */
    dotCount = cfg.showDots ? Math.max(0, Math.round(cfg.dotCount)) : 0
    dotList = []
    for (let i = 0; i < dotCount; i++) {
      // Half of them crowd the middle of a strand, the rest spread over
      // nearly all of it.
      const s = Math.random() < 0.5 ? 0.2 + Math.random() * 0.4 : 0.05 + Math.random() * 0.9
      const strand = Math.floor(Math.random() * strands.length)
      dotList.push({
        s,
        lane: strands[strand].lane,
        strand,
        pulse: Math.random() * TAU,
        // Its own flicker rate, from a slow breath to a fast twinkle.
        flickerRate: 0.15 + Math.random() * 4.5,
        bright: 0.04 + Math.random() ** 1.5 * 0.96,
      })
    }

    dotHome = new Float32Array(dotCount * 3)
    dotShift = new Float32Array(dotCount * 3)
    dotVel = new Float32Array(dotCount * 3)
    dotScale = new Float32Array(dotCount).fill(1)
    dotScaleVel = new Float32Array(dotCount)
    dotHitAt = new Float32Array(dotCount)
    dotFlash = new Float32Array(dotCount)
    dotAlive = new Float32Array(dotCount).fill(1)
    dotColors = new Float32Array(dotCount * 3)
    rippleAwake = false

    if (dotCount > 0) {
      const dotGeo = track(new THREE.PlaneGeometry(1, 1))
      const dotMat = track(
        withRepel(
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      )
      dotMesh = new THREE.InstancedMesh(dotGeo, dotMat, dotCount)
      dotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      dotMesh.instanceColor = new THREE.InstancedBufferAttribute(dotColors, 3)
      dotMesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
      dotMesh.frustumCulled = false
      group.add(dotMesh)
    } else {
      dotMesh = null
    }

    /* -------------------------------- waves */
    waves = []
    for (let i = 0; i < MAX_WAVES; i++) {
      waves.push({ active: false, x: 0, y: 0, z: 0, at: 0, amp: 1 })
    }
    wavesAwake = false

    /* -------------------------------- comets */
    cometTex = track(
      blob(32, [
        [0, 'rgba(255,255,255,0.9)'],
        [0.3, 'rgba(255,120,255,0.4)'],
        [0.7, 'rgba(200,50,200,0.08)'],
        [1, 'rgba(0,0,0,0)'],
      ]),
    )
    const cometTotal = cfg.showComets ? Math.max(0, Math.round(cfg.cometCount)) : 0
    const tailLen = Math.max(2, Math.round(cfg.cometTail))
    cometList = []
    for (let i = 0; i < cometTotal; i++) {
      const trail = new Float32Array(tailLen * 3)
      const trailCol = new Float32Array(tailLen * 3)
      const geo = track(new THREE.BufferGeometry())
      geo.setAttribute('position', new THREE.BufferAttribute(trail, 3).setUsage(THREE.DynamicDrawUsage))
      geo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3).setUsage(THREE.DynamicDrawUsage))
      const lineMat = track(
        withRepel(
          new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      )
      const line = new THREE.Line(geo, lineMat)
      line.frustumCulled = false

      const headMat = track(
        new THREE.SpriteMaterial({
          map: cometTex,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          color: new THREE.Color(tint.comet.r * 1.2, tint.comet.g * 1.2, tint.comet.b * 1.2),
        }),
      )
      const head = new THREE.Sprite(headMat)
      head.scale.set(0.35, 0.35, 1)

      group.add(line)
      group.add(head)

      const home = strands[Math.floor(Math.random() * strands.length)]
      const speed = cfg.cometSpeed * (0.7 + Math.random() * 0.6)
      cometList.push({
        bright: 0.7 + Math.random() * 0.3,
        lane: home.lane,
        speed,
        pulse: home.speed,
        wobblePhase: home.wobblePhase,
        base: speed,
        boost: 0,
        boostMul: 1,
        racing: false,
        s: 0,
        idle: 0,
        // Spread across one Delay so the first flight reads the same as
        // every one after it. A fixed stagger here instead meant Delay
        // did nothing at all until a comet had run the strand end to
        // end — half a minute at the default speed.
        idleFor: 0.4 + (i / cometTotal) * cfg.cometDelay,
        trail,
        trailCol,
        geo,
        line,
        head,
      })
    }

    born = 0
    resize()
  }

  /* ---------------------------------------- camera */
  const distance = FORM_HEIGHT / 2 / Math.tan((BASE_ZOOM * Math.PI) / 180 / 2)
  const viewDir = new THREE.Vector3(3.4, -0.6, 10).normalize()
  const lookTarget = new THREE.Vector3(0, FORM_HEIGHT / 2, 0)
  camera.position.copy(lookTarget).addScaledVector(viewDir, distance)
  camera.lookAt(lookTarget)

  /* ---------------------------------------- resize */
  // Kept from the last resize so the loop can solve the repel radius against
  // it without reading layout — asking the DOM for a height every frame is a
  // forced reflow, sixty times a second.
  let viewHeight = 1

  function resize() {
    const cfg = cfgRef.current
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    viewHeight = h
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    repelUniforms.uAspect.value = w / h
    repelUniforms.uRadius.value = clamp(cfg.repelRadius / (h / 2), 0.01, 3)
    if (!cfg.running) renderer.render(scene, camera)
  }
  const observer = new ResizeObserver(resize)

  /* ---------------------------------------- pointer */
  let repelTarget = 0
  const onPointerMove = (e: PointerEvent) => {
    const cfg = cfgRef.current
    const rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    repelUniforms.uMouse.value.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    )
    repelTarget = cfg.hoverRepel && cfg.running ? clamp(cfg.repelStrength / 100, 0, 1) * REPEL_MAX_NDC : 0
  }
  const onPointerLeave = () => {
    repelTarget = 0
  }
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerleave', onPointerLeave)
  container.addEventListener('pointercancel', onPointerLeave)

  /* ---------------------------------------- ripple */

  /** A shockwave, thrown from a dot that has just been hit. */
  function addWave(x: number, y: number, z: number, at: number, amp: number) {
    wavesAwake = true
    let slot = 0
    let oldest = Infinity
    for (let i = 0; i < MAX_WAVES; i++) {
      if (!waves[i].active) {
        slot = i
        break
      }
      if (waves[i].at < oldest) {
        oldest = waves[i].at
        slot = i
      }
    }
    waves[slot] = { active: true, x, y, z, at, amp }
  }

  /** The ring's push on one strand vertex, added in place. */
  function waveAt(x: number, y: number, z: number, now: number, out: Float32Array, at: number, radius: number) {
    let ox = 0
    let oy = 0
    let oz = 0
    let any = false
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = waves[i]
      if (!w.active) continue
      const age = now - w.at
      if (age > WAVE_LIFE) {
        w.active = false
        continue
      }
      any = true
      const dx = x - w.x
      const dy = y - w.y
      const dz = z - w.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d < 0.001 || d > radius * 1.5) continue
      // Only the shell of the ring moves anything.
      const front = Math.abs(d - WAVE_SPEED * age)
      if (front > WAVE_WIDTH) continue
      const shell = Math.cos(((front / WAVE_WIDTH) * Math.PI) / 2)
      const fade = Math.exp(-age / WAVE_DECAY)
      const near = 1 / Math.max(d, 0.3)
      const push = RIPPLE_STRENGTH * w.amp * WAVE_STRENGTH * shell * fade * near
      ox += (dx / d) * push
      oy += (dy / d) * push
      oz += (dz / d) * push
    }
    if (!any) wavesAwake = false
    out[at] += ox
    out[at + 1] += oy
    out[at + 2] += oz
  }

  /** Shove every dot around one that has gone off, and swell it. `force` is
   *  the strike's strength, 0..1, and scales the whole thing. */
  function burstAt(i: number, now: number, force: number) {
    rippleAwake = true
    const x = dotHome[i * 3]
    const y = dotHome[i * 3 + 1]
    const z = dotHome[i * 3 + 2]
    addWave(x, y, z, now, force)
    const radius = RIPPLE_RADIUS
    const maxSq = radius * radius
    for (let j = 0; j < dotCount; j++) {
      const dx = dotHome[j * 3] - x
      const dy = dotHome[j * 3 + 1] - y
      const dz = dotHome[j * 3 + 2] - z
      const sq = dx * dx + dy * dy + dz * dz
      if (sq > maxSq || sq < 1e-4) continue
      const d = Math.sqrt(sq)
      const f = 1 - d / radius
      const push = (RIPPLE_STRENGTH * force * f * f) / Math.max(d, 0.1)
      dotVel[j * 3] += dx * push
      dotVel[j * 3 + 1] += dy * push
      dotVel[j * 3 + 2] += dz * push
      const swell = 1 + (SCALE_PEAK - 1) * force * f * f
      if (swell > dotScale[j]) {
        dotScale[j] = swell
        dotScaleVel[j] = 0
      }
    }
  }

  /** Every dot on its own spring, back toward where the flow put it. */
  function settle(dt: number) {
    let moving = false
    for (let i = 0; i < dotCount; i++) {
      const at = i * 3
      for (let k = 0; k < 3; k++) {
        const a = -RIPPLE_SPRING * dotShift[at + k] - RIPPLE_DAMPING * dotVel[at + k]
        dotVel[at + k] += a * dt
        dotShift[at + k] += dotVel[at + k] * dt
      }
      const restSq = dotShift[at] ** 2 + dotShift[at + 1] ** 2 + dotShift[at + 2] ** 2
      const velSq = dotVel[at] ** 2 + dotVel[at + 1] ** 2 + dotVel[at + 2] ** 2
      if (restSq < 1e-8 && velSq < 1e-8) {
        dotShift[at] = dotShift[at + 1] = dotShift[at + 2] = 0
        dotVel[at] = dotVel[at + 1] = dotVel[at + 2] = 0
      } else {
        moving = true
      }
      const sa = -SCALE_SPRING * (dotScale[i] - 1) - SCALE_DAMPING * dotScaleVel[i]
      dotScaleVel[i] += sa * dt
      dotScale[i] += dotScaleVel[i] * dt
      if (Math.abs(dotScale[i] - 1) < 0.001 && Math.abs(dotScaleVel[i]) < 0.001) {
        dotScale[i] = 1
        dotScaleVel[i] = 0
      } else {
        moving = true
      }
    }
    if (!moving) rippleAwake = false
  }

  /* ---------------------------------------- loop */
  let frame = 0
  let born = 0
  let elapsed = 0
  let flow = 0
  let strandClock = 0
  let heldFrame = false
  let tick = 0
  let lastTime = performance.now()

  function drawStrand(strand: Strand, now: number, entrance: number) {
    const cfg = cfgRef.current
    const spin = flow * strand.speed
    const bright = strand.bright * cfg.lineGlow
    const lift = 0.15 + bright * 1.5
    const alpha =
      Math.min(bright * 0.5 * (0.9 + 0.1 * Math.sin(now * 0.18 + strand.pulse)), 0.7) * Math.min(entrance * 3, 1)
    // The strand grows along its own length as the entrance runs.
    const reach = strand.from + entrance * (strand.to - strand.from)
    const tipFade = 0.15 * (strand.to - strand.from)
    const { pts, cols } = strand

    for (let i = 0; i < STRAND_SEGMENTS; i++) {
      const u = i / (STRAND_SEGMENTS - 1)
      const s = strand.from + u * (strand.to - strand.from)
      const at = i * 3
      shape.writePoint(pts, at, s, strand.lane, spin, WOBBLE, strand.wobblePhase, now)
      if (wavesAwake) {
        waveAt(pts[at], pts[at + 1], pts[at + 2], now, pts, at, RIPPLE_RADIUS)
      }
      // Ends taper away, and the growing tip fades in.
      let edge = 1
      if (u < FADE_ZONE) {
        const k = u / FADE_ZONE
        edge = k * k
      } else if (u > 1 - FADE_ZONE) {
        const k = (1 - u) / FADE_ZONE
        edge = k * k
      }
      let tip = 1
      if (s > reach) tip = 0
      else if (s > reach - tipFade) {
        tip = (reach - s) / tipFade
        tip *= tip
      }
      const v = edge * lift * tip * alpha
      cols[at] = tint.strand.r * v
      cols[at + 1] = tint.strand.g * v
      cols[at + 2] = tint.strand.b * v
    }

    // One point per segment becomes two vertices per segment: a line list,
    // so a strand can go dark in the middle without the whole thing going.
    let w = strand.offset
    for (let i = 0; i < STRAND_SEGMENTS - 1; i++) {
      const a = i * 3
      const b = (i + 1) * 3
      strandPos[w] = pts[a]
      strandPos[w + 1] = pts[a + 1]
      strandPos[w + 2] = pts[a + 2]
      strandCol[w] = cols[a]
      strandCol[w + 1] = cols[a + 1]
      strandCol[w + 2] = cols[a + 2]
      w += 3
      strandPos[w] = pts[b]
      strandPos[w + 1] = pts[b + 1]
      strandPos[w + 2] = pts[b + 2]
      strandCol[w] = cols[b]
      strandCol[w + 1] = cols[b + 1]
      strandCol[w + 2] = cols[b + 2]
      w += 3
    }
  }

  function driveComet(comet: Comet, now: number, dt: number, entrance: number) {
    const cfg = cfgRef.current
    const tailLen = comet.trail.length / 3

    if (!comet.racing) {
      ;(comet.head.material as THREE.SpriteMaterial).opacity = 0
      if (entrance < 0.3) return
      comet.idle += dt
      if (comet.idle > comet.idleFor) {
        comet.racing = true
        // Turning left, a comet sets off at the crown and runs down.
        comet.s = cfg.flowDir < 0 ? RUN_HIGH : RUN_LOW
        comet.base = cfg.cometSpeed * (0.7 + Math.random() * 0.6)
        comet.speed = comet.base
        comet.boost = 0
        comet.boostMul = 1
        const home = strands[Math.floor(Math.random() * strands.length)]
        comet.lane = home.lane
        comet.pulse = home.speed
        comet.wobblePhase = home.wobblePhase
      }
      return
    }

    if (comet.boost > 0) {
      comet.boost -= dt
      if (comet.boost <= 0) {
        comet.boost = 0
        comet.boostMul = 1
      } else {
        comet.boostMul = 1 + (HIT_BOOST - 1) * (comet.boost / HIT_BOOST_TIME)
      }
      comet.speed = comet.base * comet.boostMul
    }

    comet.s += dt * comet.speed * cfg.flowDir
    // Spent once it has run off the far end — which end that is depends on
    // the way it set off, so testing both would retire it on frame one.
    if (cfg.flowDir < 0 ? comet.s < RUN_LOW : comet.s > RUN_HIGH) {
      comet.racing = false
      comet.idle = 0
      comet.idleFor = cfg.cometDelay * (0.6 + Math.random() * 0.8)
      comet.trailCol.fill(0)
      ;(comet.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true
      ;(comet.head.material as THREE.SpriteMaterial).opacity = 0
      return
    }

    const spin = flow * comet.pulse
    // Fades in off the end it set off from and out at the far one. Clamped
    // both ways: unclamped it goes negative past an end, and a negative
    // colour is a comet that never appears at all.
    const ends = clamp((comet.s - RUN_LOW) / RUN_FADE, 0, 1) * clamp((RUN_HIGH - comet.s) / RUN_FADE, 0, 1)

    for (let i = 0; i < tailLen; i++) {
      // The tail hangs off the back, so it is laid the way the comet
      // came from — which flips with the direction.
      const s = clamp(comet.s - i * 0.005 * cfg.flowDir, 0.005, 0.995)
      const at = i * 3
      shape.writePoint(comet.trail, at, s, comet.lane, spin, WOBBLE, comet.wobblePhase, now)
      const along = (1 - i / tailLen) ** 2
      const v = comet.bright * cfg.cometGlow * along * ends
      // The first few segments run hotter, which is what gives the head
      // its core rather than a line that simply starts.
      const hot = entrance * (i < 3 ? 1.3 : 1)
      comet.trailCol[at] = tint.comet.r * v * hot
      comet.trailCol[at + 1] = tint.comet.g * v * hot
      comet.trailCol[at + 2] = tint.comet.b * v * hot
    }

    comet.head.position.set(comet.trail[0], comet.trail[1], comet.trail[2])
    const swell = comet.boost > 0 ? 1 + (comet.boostMul - 1) * 0.8 : 1
    ;(comet.head.material as THREE.SpriteMaterial).opacity = ends * 0.35 * entrance * swell
    comet.head.scale.set(0.35 * swell, 0.35 * swell, 1)
    ;(comet.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(comet.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  /** Comets running over dots: close enough is a hit — the dot flashes out
   *  and the comet is thrown forward by it. */
  function collide(now: number) {
    const cfg = cfgRef.current
    // Collide Force 0 means they pass straight through each other.
    const force = cfg.collideForce
    if (force <= 0) return
    const hitSq = HIT_RADIUS * HIT_RADIUS
    for (const comet of cometList) {
      if (!comet.racing) continue
      const x = comet.trail[0]
      const y = comet.trail[1]
      const z = comet.trail[2]
      if (x === 0 && y === 0 && z === 0) continue
      // Every third dot. The dots are a cloud, not a wall — checking all
      // of them against every comet is most of a frame for a difference
      // nobody can see.
      for (let i = 0; i < dotCount; i += 3) {
        const dx = dotHome[i * 3] - x
        const dy = dotHome[i * 3 + 1] - y
        const dz = dotHome[i * 3 + 2] - z
        const sq = dx * dx + dy * dy + dz * dz
        if (sq < hitSq && dotHitAt[i] === 0) {
          // Everything the strike does is scaled by the one force:
          // how brightly the dot flashes, how far it pops, how hard
          // the ripple leaves, and the shove the comet takes back.
          dotHitAt[i] = 0.001
          dotFlash[i] = HIT_FLASH * force
          dotScale[i] = 1 + (HIT_POP - 1) * force
          burstAt(i, now, force)
          comet.boost = HIT_BOOST_TIME
          comet.boostMul = 1 + (HIT_BOOST - 1) * force
          comet.speed = comet.base * comet.boostMul
        }
      }
    }
  }

  function step(now: number) {
    frame = requestAnimationFrame(step)
    const cfg = cfgRef.current
    const dt = Math.min((now - lastTime) / 1000, 0.04)
    lastTime = now

    // Reduced motion: one frame, held. The loop keeps ticking so the setting
    // can go back on without a rebuild, but no time passes.
    if (!cfg.running) {
      if (!heldFrame) {
        renderer.render(scene, camera)
        heldFrame = true
      }
      return
    }
    heldFrame = false

    // The clock starts on the first drawn frame, not when the engine was
    // built — the entrance should play when the thing is first seen.
    if (born === 0) born = now
    elapsed = (now - born) / 1000
    const t = elapsed

    const fadeStrand = ramp(t, ENTRANCE.strandStart, ENTRANCE.strandEnd)
    const fadeDot = ramp(t, ENTRANCE.dotStart, ENTRANCE.dotEnd)
    const fadeComet = ramp(t, ENTRANCE.cometStart, ENTRANCE.cometEnd)

    // Zoom, colours and repel reach are read here rather than baked at
    // build time, so dragging any of them does not restart the entrance.
    syncColors(cfg)
    const fov = fovForZoom(cfg.zoom)
    if (camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    repelUniforms.uRadius.value = clamp(cfg.repelRadius / (viewHeight / 2), 0.01, 3)

    // The flow accumulates rather than being solved from elapsed time:
    // `t * speed` re-reads the whole history at the new rate, so nudging
    // Speed snaps the form to wherever it would have been all along.
    flow += dt * cfg.flowSpeed
    const us = repelUniforms.uStrength
    us.value += (repelTarget - us.value) * Math.min(1, dt * 12)

    /* strands, at their own rate */
    strandClock += dt
    if (strandClock >= STRAND_HZ && strandGeo) {
      strandClock -= STRAND_HZ
      for (const strand of strands) drawStrand(strand, t, fadeStrand)
      ;(strandGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true
      ;(strandGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true
    }

    if (rippleAwake) settle(dt)

    /* dots */
    if (dotMesh && dotCount > 0) {
      const size = cfg.dotSize
      for (let i = 0; i < dotCount; i++) {
        const dot = dotList[i]
        const strand = strands[dot.strand] ?? strands[0]
        const spin = flow * strand.speed
        const at = i * 3
        shape.writePoint(dotHome, at, dot.s, dot.lane, spin, WOBBLE, strand.wobblePhase, t)

        // A dot a comet has run through: flashes, shrinks out, and is
        // gone until its respawn comes round.
        if (dotHitAt[i] > 0) {
          dotHitAt[i] += dt
          const age = dotHitAt[i]
          if (age < HIT_FADE) {
            const k = age / HIT_FADE
            dotAlive[i] = (1 + (HIT_POP - 1) * (1 - k)) * (1 - k * k)
            dotFlash[i] = HIT_FLASH * (1 - k * k) * (1 - k * k)
          } else {
            dotAlive[i] = 0
            dotFlash[i] = 0
          }
          if (age > HIT_RESPAWN) {
            dotHitAt[i] = 0
            dotAlive[i] = 1
            dotFlash[i] = 0
          }
        }

        const alive = dotAlive[i]
        const scale = size * dotScale[i] * alive
        dummy.makeScale(scale, scale, scale)
        dummy.setPosition(
          dotHome[at] + dotShift[at],
          dotHome[at + 1] + dotShift[at + 1],
          dotHome[at + 2] + dotShift[at + 2],
        )
        dotMesh.setMatrixAt(i, dummy)

        // The flicker. A sine raised to a power spends most of its time
        // near nothing and spikes briefly, which is what reads as a
        // twinkle rather than a throb — and the floor keeps a dot from
        // ever going fully out.
        const beat =
          1 -
          cfg.dotFlicker +
          cfg.dotFlicker * (0.08 + 0.92 * Math.max(0, Math.sin(t * dot.flickerRate + dot.pulse)) ** 2.5)
        const swollen = dotScale[i] > 1.02 ? 1 + (dotScale[i] - 1) * 0.5 : 1
        const v = dot.bright * beat * cfg.dotGlow * swollen * fadeDot * (1 + dotFlash[i]) * alive
        dotColors[at] = tint.dot.r * v
        dotColors[at + 1] = tint.dot.g * v
        dotColors[at + 2] = tint.dot.b * v
      }
      dotMesh.instanceMatrix.needsUpdate = true
      if (dotMesh.instanceColor) dotMesh.instanceColor.needsUpdate = true
      ;(dotMesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * fadeDot
    }

    /* comets */
    for (const comet of cometList) driveComet(comet, t, dt, fadeComet)
    tick++
    // Every other frame: the comets have not moved far enough in one to
    // slip past a dot they would otherwise have hit.
    if (tick % 2 === 0 && dotCount > 0) collide(t)

    renderer.render(scene, camera)
  }

  /* ---------------------------------------- boot */
  build()
  observer.observe(container)
  lastTime = performance.now()
  frame = requestAnimationFrame(step)

  return {
    rebuild() {
      build()
    },
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerleave', onPointerLeave)
      container.removeEventListener('pointercancel', onPointerLeave)
      for (const d of disposables) d.dispose()
      renderer.dispose()
      // Free the GL context at once; browsers cap how many can be open.
      const loseContext = (renderer as { forceContextLoss?: () => void }).forceContextLoss
      loseContext?.()
    },
  }
}

/* ============================================================ component */

export interface VortexProps {
  background?: string
  topRadius?: number
  waistRadius?: number
  waistPosition?: number
  bottomRadius?: number
  twist?: number
  zoom?: number
  speed?: number
  direction?: 'right' | 'left'
  lineOptions?: Partial<typeof DEFAULTS.lineOptions>
  dots?: boolean
  dotOptions?: Partial<typeof DEFAULTS.dotOptions>
  comets?: boolean
  cometOptions?: Partial<typeof DEFAULTS.cometOptions>
  repel?: boolean
  repelOptions?: Partial<typeof DEFAULTS.repelOptions>
  style?: React.CSSProperties
}

/**
 * Vortex — a particle tornado on a fixed camera. Place it behind a hero section.
 *
 * Strands spiral up a pinched hyperboloid, dots ride them and flicker, and
 * comets race along them — a strike flashes the dot out and throws a ripple
 * through everything around it.
 */
function __OriginkitBase_Vortex(props: VortexProps) {
  const {
    background = DEFAULTS.background,
    topRadius = DEFAULTS.topRadius,
    waistRadius = DEFAULTS.waistRadius,
    waistPosition = DEFAULTS.waistPosition,
    bottomRadius = DEFAULTS.bottomRadius,
    twist = DEFAULTS.twist,
    zoom = DEFAULTS.zoom,
    speed = DEFAULTS.speed,
    direction = DEFAULTS.direction,
    lineOptions = DEFAULTS.lineOptions,
    dots = DEFAULTS.dots,
    dotOptions = DEFAULTS.dotOptions,
    comets = DEFAULTS.comets,
    cometOptions = DEFAULTS.cometOptions,
    repel = DEFAULTS.repel,
    repelOptions = DEFAULTS.repelOptions,
    style,
  } = props

  const containerRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  // The canvas turns whatever the reader's motion setting says.
  const reducedMotion = useReducedMotion()
  const running = !reducedMotion

  // Prop units in, engine units out — the one place the two meet. A caller
  // may pass only part of a group, so each is laid over its defaults: a
  // missing field is a NaN radius and a form that never draws.
  const line = { ...DEFAULTS.lineOptions, ...lineOptions }
  const dot = { ...DEFAULTS.dotOptions, ...dotOptions }
  const comet = { ...DEFAULTS.cometOptions, ...cometOptions }
  const shove = { ...DEFAULTS.repelOptions, ...repelOptions }

  const config = {
    floorRadius: bottomRadius / PX_PER_WORLD,
    waistRadius: waistRadius / PX_PER_WORLD,
    crownRadius: topRadius / PX_PER_WORLD,
    // Measured DOWN from the top — 0% pinches at the crown, 100% at the
    // floor. The shape measures up from the floor, so the two run opposite
    // ways and the prop's number is flipped here.
    waistAt: 1 - waistPosition / 100,
    twist,
    zoom,
    // Direction is the sign on the flow, so the whole form — strands, dots
    // and comets alike — turns the other way off the one value. Comets read
    // the sign on its own: it decides which end of a strand they start from
    // as well as how fast they get there.
    flowDir: direction === 'left' ? -1 : 1,
    flowSpeed: (speed / 100) * (direction === 'left' ? -1 : 1),
    lineCount: line.count,
    lineColor: line.color,
    lineGlow: (line.glow / 10) * LINE_GLOW_MAX,
    showDots: dots,
    dotCount: dot.count,
    dotSize: dot.size / DOT_SIZE_SCALE,
    dotColor: dot.color,
    dotGlow: (dot.glow / 10) * DOT_GLOW_MAX,
    dotFlicker: dot.flicker / 10,
    showComets: comets,
    cometCount: comet.count,
    cometSpeed: (comet.speed / 10) * COMET_SPEED_MAX,
    cometColor: comet.color,
    cometGlow: (comet.glow / 10) * COMET_GLOW_MAX,
    cometTail: comet.tail,
    cometDelay: comet.delay,
    collideForce: comet.collide / 10,
    hoverRepel: repel,
    repelRadius: shove.radius,
    repelStrength: shove.strength,
    running,
  }

  // A fresh object arrives on every render, so identity says nothing about
  // whether anything changed — the config is compared by contents instead.
  // The ref is what the engine reads, so the loop always has the current
  // values rather than the ones it was built with.
  //
  // Only the values deciding how many things there are, or the shape they sit
  // on, are in the key: a rebuild lays every buffer out again and starts the
  // entrance over, which for a colour or a delay is both waste and a visible
  // stutter. Everything left out is read off the ref inside the loop and
  // lands on the next frame.
  const buildKey = JSON.stringify([
    config.floorRadius,
    config.waistRadius,
    config.crownRadius,
    config.waistAt,
    config.twist,
    config.lineCount,
    config.showDots,
    config.dotCount,
    config.showComets,
    config.cometCount,
    config.cometTail,
  ])
  const configRef = React.useRef(config)
  configRef.current = config

  const apiRef = React.useRef<VortexAPI | null>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    try {
      apiRef.current = createVortex(canvas, container, configRef)
    } catch (err) {
      // WebGL can be unavailable (blocked, out of contexts, software
      // render). Fail to a transparent canvas rather than taking the page
      // down with it.
      console.warn('[Vortex] init failed:', err)
      return
    }
    return () => {
      apiRef.current?.dispose()
      apiRef.current = null
    }
  }, [])

  // Anything changing what there is, or the shape it sits on, is rebuilt here.
  // Everything the loop reads per frame picks itself up from the ref.
  //
  // The first run is skipped: the effect above has just built the scene from
  // this very config, and building it again before a frame has been drawn is
  // pure waste — and would restart the entrance.
  const built = React.useRef(false)
  React.useEffect(() => {
    if (!built.current) {
      built.current = true
      return
    }
    apiRef.current?.rebuild()
  }, [buildKey])

  return (
    <div
      ref={containerRef}
      style={{
        ...style,
        position: 'relative',
        width: '100%',
        height: '100%',
        background,
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}

const __originkitPresetProps: VortexProps = {
  background: '#000000',
  topRadius: 380,
  waistRadius: 53,
  waistPosition: 50,
  bottomRadius: 1150,
  twist: 3,
  zoom: 75,
  speed: 10,
  direction: 'right',
  dots: true,
  comets: true,
}

export default function Vortex(props: VortexProps) {
  return <__OriginkitBase_Vortex {...__originkitPresetProps} {...props} />
}
