import * as T from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const style = document.createElement("link");
style.rel = "stylesheet";
style.href = new URL("./globe.css", import.meta.url).href;
document.head.append(style);

const TAU = Math.PI * 2;
const UP = new T.Vector3(0, 1, 0);
const X = new T.Vector3(1, 0, 0);
const clamp = T.MathUtils.clamp;
const smooth = (a, b, x) => T.MathUtils.smoothstep(x, a, b);
const V = (p) => new T.Vector3().fromArray(p).normalize();
const unit = (p) =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const angle = (a, b) => Math.acos(clamp(a.dot(b), -1, 1));
const shared = new T.Vector3();

function slerp(a, b, t, out) {
  const arc = angle(a, b);
  const sin = Math.sin(arc);
  if (sin < 0.00001) return out.copy(a).lerp(b, t).normalize();
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * arc) / sin)
    .addScaledVector(b, Math.sin(t * arc) / sin);
}

// Relief is a cartographic footprint around each measured direction. Its height
// is monotone in held-out kurtosis; ridge texture and footprint width are styling.
function relief(k) {
  if (k <= 1) return 0.002;
  if (k <= 10) return 0.008 + (0.015 * Math.log(k)) / Math.log(10);
  return 0.025 + 0.097 * (1 - Math.exp(-Math.log(k / 10) / 2.1));
}

function addFootprint(grid, lithology, nx, ny, site, radius) {
  const { dir, k } = site;
  const center = Math.atan2(dir.z, dir.x);
  const latitude = Math.asin(clamp(dir.y, -1, 1));
  const dlon = TAU / nx,
    dlat = Math.PI / ny;
  const extent = radius * 1.95;
  const dy = Math.ceil(extent / dlat);
  const mid = Math.round((latitude + Math.PI / 2) / dlat);
  const peak = relief(k);
  const east = new T.Vector3(-Math.sin(center), 0, Math.cos(center));
  const north = new T.Vector3().crossVectors(east, dir);
  // A reproducible orientation in the intrinsic tangent frame of the projected axis.
  const rotation = site.strike
    ? Math.atan2(site.strike.dot(north), site.strike.dot(east))
    : Math.atan2(dir.x + dir.y, dir.z - dir.y);
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  for (let j = Math.max(0, mid - dy); j <= Math.min(ny, mid + dy); j++) {
    const lat = dlat * j - Math.PI / 2;
    const coslat = Math.cos(lat),
      sinlat = Math.sin(lat);
    const span = Math.min(
      nx / 2,
      Math.ceil(extent / (dlon * Math.max(0.005, coslat))) + 2,
    );
    const x0 = Math.round(center / dlon);
    for (let ix = x0 - span; ix <= x0 + span; ix++) {
      const i = ((ix % nx) + nx) % nx,
        lon = i * dlon;
      const px = coslat * Math.cos(lon),
        pz = coslat * Math.sin(lon);
      const dot = px * dir.x + sinlat * dir.y + pz * dir.z;
      if (dot < Math.cos(extent)) continue;
      const e = (px * east.x + pz * east.z) / radius;
      const n = (px * north.x + sinlat * north.y + pz * north.z) / radius;
      const u = e * c + n * s,
        v = -e * s + n * c;
      const bend = 0.2 * Math.sin(2.8 * u) + 0.06 * Math.sin(7 * u);
      const rough = Math.sin(6 * u + 3 * v) * Math.sin(4 * v - 2 * u);
      const d =
        Math.hypot(u * 0.66, (v - bend) * (1.13 + 0.27 * Math.cos(u * 5))) *
        (1 + 0.2 * rough);
      if (d >= 1.25) continue;
      // Raised shelf reaches below the drawn waterline to make bathymetric contours.
      const base = Math.max(0, 1 - d / 1.25);
      const profile = Math.pow(base, 1.46);
      const ribs =
        1 -
        0.18 *
          Math.abs(Math.sin(12 * v + 3 * Math.sin(5 * u))) *
          Math.min(1, d * 5);
      const index = j * (nx + 1) + i;
      const height = (peak + 0.021) * profile * ribs;
      if (height > grid[index]) {grid[index] = height; lithology[index] = k > 10 ? 1 : 0;}
    }
  }
}

function makeSurface(sites, nx, ny) {
  const geo = new T.BufferGeometry();
  const count = (nx + 1) * (ny + 1);
  const grid = new Float32Array(count), lithology = new Float32Array(count);
  const positions = new Float32Array(count * 3),
    unitDirs = new Float32Array(count * 3);
  const indices = [];
  const radius = clamp(
    1.92 / Math.sqrt(Math.max(1, sites.length)),
    0.045,
    0.28,
  );
  for (const site of sites) {
    let nearest = null,
      best = -1;
    for (const other of sites) {
      if (other === site) continue;
      const alignment = site.dir.dot(other.dir);
      if (alignment > best && alignment < 0.9999) {
        best = alignment;
        nearest = other;
      }
    }
    site.strike = nearest?.dir
      .clone()
      .addScaledVector(site.dir, -best)
      .normalize();
    const width =
      radius * clamp(0.52 + 0.245 * Math.log1p(site.k * 0.45), 0.58, 1.46);
    site.footprint = width;
    addFootprint(grid, lithology, nx, ny, site, width);
  }
  for (let j = 0; j <= ny; j++) {
    const lat = Math.PI * (j / ny - 0.5);
    for (let i = 0; i <= nx; i++) {
      const n = j * (nx + 1) + i;
      if (i === nx) grid[n] = grid[j * (nx + 1)];
      const lon = (TAU * i) / nx;
      const x = Math.cos(lat) * Math.cos(lon),
        y = Math.sin(lat),
        z = Math.cos(lat) * Math.sin(lon);
      const r = 1 + Math.max(0, grid[n] - 0.018);
      unitDirs.set([x, y, z], n * 3);
      positions.set([x * r, y * r, z * r], n * 3);
      if (i < nx && j < ny) {
        const a = n,
          b = n + 1,
          c = n + nx + 1,
          d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  geo.setIndex(indices);
  geo.setAttribute("position", new T.BufferAttribute(positions, 3));
  geo.setAttribute("direction", new T.BufferAttribute(unitDirs, 3));
  geo.setAttribute("bed", new T.BufferAttribute(grid, 1));
  geo.computeVertexNormals();
  // The longitude seam and poles carry duplicate vertices.
  const normals = geo.attributes.normal;
  for (let j = 0; j <= ny; j++) {
    const a = j * (nx + 1),
      b = a + nx;
    const m = new T.Vector3()
      .fromBufferAttribute(normals, a)
      .add(new T.Vector3().fromBufferAttribute(normals, b))
      .normalize();
    normals.setXYZ(a, m.x, m.y, m.z);
    normals.setXYZ(b, m.x, m.y, m.z);
  }
  function sample(dir) {
    const u = ((Math.atan2(dir.z, dir.x) / TAU + 1) % 1) * nx;
    const v = clamp(
      (Math.asin(clamp(dir.y, -1, 1)) / Math.PI + 0.5) * ny,
      0,
      ny - 0.00001,
    );
    const i = Math.floor(u),
      j = Math.floor(v),
      n = j * (nx + 1) + i;
    return Math.max(
      0,
      T.MathUtils.lerp(
        T.MathUtils.lerp(grid[n], grid[n + 1], u - i),
        T.MathUtils.lerp(grid[n + nx + 1], grid[n + nx + 2], u - i),
        v - j,
      ) - 0.018,
    );
  }
  return { geo, sample };
}

const surfaceVertex = `
attribute float bed;
attribute float mainland;
attribute vec3 direction;
varying float elev;
varying float continent;
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vRadial;
varying vec3 vEye;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.);
  vEye = -mv.xyz;
  elev = bed; continent = mainland;
  vDir = direction;
  vNormal = normalMatrix * normal;
  vRadial = normalMatrix * direction;
  gl_Position=projectionMatrix*mv;
}`;

const surfaceFragment = `
precision highp float;
uniform float time;
varying float elev;
varying float continent;
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vRadial;
varying vec3 vEye;
float line(float x,float width){
  float d=abs(fract(x+.5)-.5);
  return 1.-smoothstep(0.,max(.0001,fwidth(x))*width,d);
}
float hash(vec3 p){
 p=fract(p*.3183099+vec3(.11,.31,.17))*17.;
 return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float noise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+1.),f.x),f.y),f.z);
}
void main(){
 vec3 p=normalize(vDir), n=normalize(vNormal), r=normalize(vRadial), eye=normalize(vEye);
 vec3 light=normalize(vec3(-.72,.83,.57));
 float sun=dot(n,light), day=dot(r,light);
 float facing=max(0.,dot(r,eye));
 float fabric=noise(p*5.)*.50+noise(p*13.)*.26+noise(p*33.)*.16+noise(p*91.)*.08;
 float wave=sin(p.y*114.+p.z*35.+12.*fabric+time*.35);
 float crest=pow(max(0.,wave),8.);
 vec3 sea=mix(vec3(.020,.086,.144),vec3(.052,.28,.33),clamp(fabric*.9+.14*day,0.,1.));
 sea+=vec3(.015,.048,.034)*crest*(.3+.7*noise(p*41.));
 float shallow=smoothstep(.001,.019,elev);
 sea=mix(sea,vec3(.10,.32,.34),shallow*.62);
 float land=smoothstep(.016,.022,elev);
 vec3 reef=mix(vec3(.09,.43,.423),vec3(.48,.58,.405),smoothstep(.019,.04,elev));
 vec3 rock=mix(vec3(.335,.345,.24),vec3(.74,.56,.32),smoothstep(.035,.066,elev));
 rock=mix(rock,vec3(.99,.82,.50),smoothstep(.072,.113,elev));
 vec3 soil=mix(reef,rock,continent*smoothstep(.022,.038,elev));
 float grain = noise(p*147.)-.5;
 soil *= (.80+fabric*.33+grain*.17);
 vec3 shade=mix(sea,soil,land)*(.56+.52*max(0.,sun)+.14*max(0.,day));
 float contours=line(elev/.0045,.75)*smoothstep(.002,.01,elev);
 shade=mix(shade,vec3(.28,.60,.57),contours*(1.-land)*.29);
 shade=mix(shade,vec3(.15,.17,.125),contours*land*.38);
 float beach=1.-smoothstep(.0005,.0026,abs(elev-.019));
 shade+=vec3(.11,.16,.11)*beach;
 float lon=atan(p.z,p.x), lat=asin(clamp(p.y,-1.,1.));
 float grid=max(line(lon/0.261799,.85)*(1.-smoothstep(1.35,1.57,abs(lat))),line(lat/0.261799,.85));
 shade=mix(shade,vec3(.40,.63,.64),grid*(.33-.17*land)*smoothstep(.025,.25,facing));
 float rim=pow(1.-facing,4.);
 shade+=vec3(.10,.29,.31)*rim;
 gl_FragColor=vec4(shade,1.);
}`;

function makeShip(color) {
  const ship = new T.Group();
  const hull = new T.BufferGeometry();
  // Local +Y is the deck's upward normal; +Z is the bow.
  const pts = [
    [0, 0.002, 0.032],
    [-0.01, 0.002, 0.004],
    [-0.008, 0.002, -0.022],
    [0.008, 0.002, -0.022],
    [0.01, 0.002, 0.004],
    [0, -0.007, -0.005],
  ];
  hull.setAttribute("position", new T.Float32BufferAttribute(pts.flat(), 3));
  hull.setIndex([
    0, 1, 4, 1, 2, 3, 1, 3, 4, 0, 4, 5, 0, 5, 1, 1, 5, 2, 2, 5, 3, 3, 5, 4,
  ]);
  hull.computeVertexNormals();
  const body = new T.Mesh(
    hull,
    new T.MeshBasicMaterial({ color: 0xffead0, side: T.DoubleSide }),
  );
  ship.add(body);
  const cabin = new T.Mesh(
    new T.BoxGeometry(0.01, 0.008, 0.014),
    new T.MeshBasicMaterial({ color }),
  );
  cabin.position.set(0, 0.006, -0.002);
  ship.add(cabin);
  const keel = new T.Line(
    new T.BufferGeometry().setFromPoints([
      new T.Vector3(-0.007, 0.003, -0.022),
      new T.Vector3(-0.01, 0.003, 0.004),
      new T.Vector3(0, 0.003, 0.032),
      new T.Vector3(0.01, 0.003, 0.004),
      new T.Vector3(0.007, 0.003, -0.022),
    ]),
    new T.LineBasicMaterial({ color }),
  );
  ship.add(keel);
  return ship;
}

function release(obj) {
  obj.traverse((child) => {
    child.geometry?.dispose();
    if (child.material) child.material.dispose();
  });
  obj.removeFromParent();
}

function cameraDirection(dir) {
  const east = new T.Vector3().crossVectors(UP, dir);
  if (east.lengthSq() < 0.001) east.copy(X);
  return dir
    .clone()
    .addScaledVector(east.normalize(), 0.13)
    .addScaledVector(UP, 0.08)
    .normalize();
}

export function createGlobe(container, { onPick, onHover } = {}) {
  container.classList.add("atlas-planet");
  const scene = new T.Scene();
  const renderer = new T.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  container.append(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    "三维海图。拖动旋转，滚轮或双指缩放。方向键旋转，回车检查当前主岛。",
  );
  const camera = new T.PerspectiveCamera(38, 1, 0.05, 30);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.75;
  controls.minDistance = 1.48;
  controls.maxDistance = 8;
  camera.position.set(0.2, 0.45, 3.5);
  controls.update();

  const surfaceMat = new T.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    uniforms: { time: { value: 0 } },
    extensions: { derivatives: true },
  });
  const materialCache = new Map();
  let surface = null,
    sampler = () => 0,
    layer = null,
    islandRegistry = {},
    layerCatalog = [],
    sitesByLayer = new Map();
  let frames = [],
    coords = [],
    frame = 0,
    primaryColor = "#efad60",
    follow = false,
    tide = 4.64,
    comparisons = [];
  let dirtySelection = true,
    sizeDistance = 3.5,
    camGoal = null,
    transition = 0;
  const voyage = new T.Group(),
    signals = new T.Group(),
    fleet = new T.Group();
  scene.add(voyage, signals, fleet);
  let ship = makeShip(primaryColor);
  fleet.add(ship);
  let wake,
    lookAhead,
    turnArc,
    activeRing,
    signalDots,
    referenceLines = [],
    peerShips = [];
  let angleAnchor = null;
  const turnTag = document.createElement("span");
  turnTag.className = "turn-bearing";
  turnTag.hidden = true;
  container.append(turnTag);
  const glintCanvas = document.createElement("canvas");
  glintCanvas.width = glintCanvas.height = 64;
  const glowContext = glintCanvas.getContext("2d"),
    glowGradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  glowGradient.addColorStop(0, "rgba(255,255,255,1)");
  glowGradient.addColorStop(0.12, "rgba(255,255,255,1)");
  glowGradient.addColorStop(0.35, "rgba(255,255,255,.48)");
  glowGradient.addColorStop(1, "rgba(255,255,255,0)");
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 64, 64);
  const wakeDot = new T.Sprite(
    new T.SpriteMaterial({
      map: new T.CanvasTexture(glintCanvas),
      color: 0xfff1b0,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    }),
  );
  wakeDot.scale.setScalar(0.07);
  scene.add(wakeDot);
  let shipPrev = null,
    shipNext = null,
    settleTime = 0;
  let snapChase = false;
  const pickRay = new T.Raycaster();
  const label = document.createElement("button");
  label.className = "planet-marker";
  label.type = "button";
  label.innerHTML =
    '<span class="marker-leader"></span><span class="marker-id"></span>';
  label.hidden = true;
  container.append(label);
  const trackKey = document.createElement("div");
  trackKey.className = "route-ink-key";
  container.append(trackKey);
  function legendRow(mark, text, color) {
    const row = document.createElement("span"),
      glyph = document.createElement("i");
    glyph.className = mark;
    glyph.style.setProperty("--ink", color);
    row.append(glyph, document.createTextNode(text));
    return row;
  }
  let mainSite = null,
    showHover = null,
    projectedLabel = null;
  const sceneSize = new T.Vector2();

  // View-aligned limb halo. Outside the solid silhouette the opacity decays toward space.
  const air = new T.Mesh(
    new T.SphereGeometry(1.045, 112, 72),
    new T.ShaderMaterial({
      side: T.BackSide,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: `varying vec3 N;varying vec3 E;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);N=normalMatrix*normal;E=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying vec3 N;varying vec3 E;void main(){float d=abs(dot(normalize(N),normalize(E)));float a=smoothstep(0.,.29,d)*.26;gl_FragColor=vec4(.23,.67,.70,a);}`,
    }),
  );
  scene.add(air);

  // Screen-plane azimuth reticle; it carries no experimental data.
  const dial = new T.Group(),
    ticks = [],
    inner = [];
  for (let i = 0; i < 144; i++) {
    const a = (i * TAU) / 144,
      long = i % 12 === 0,
      mid = i % 3 === 0;
    const r = 1.161,
      end = r + (long ? 0.031 : mid ? 0.017 : 0.008);
    ticks.push(
      new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0),
      new T.Vector3(Math.cos(a) * end, Math.sin(a) * end, 0),
    );
    if (i % 12 !== 11)
      inner.push(
        new T.Vector3(Math.cos(a) * 1.147, Math.sin(a) * 1.147, 0),
        new T.Vector3(
          Math.cos(a + TAU / 144) * 1.147,
          Math.sin(a + TAU / 144) * 1.147,
          0,
        ),
      );
  }
  for (const [pts, opacity] of [
    [ticks, 0.27],
    [inner, 0.115],
  ]) {
    dial.add(
      new T.LineSegments(
        new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({
          color: 0x81aaa6,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      ),
    );
  }
  scene.add(dial);

  function makeCatalog() {
    sitesByLayer = new Map();
    for (const raw of Object.values(islandRegistry)) {
      if (!unit(raw.p) || !Number.isFinite(raw.k)) continue;
      const site = { raw, id: raw.id, k: raw.k, dir: V(raw.p) };
      if (!sitesByLayer.has(raw.layer)) sitesByLayer.set(raw.layer, []);
      sitesByLayer.get(raw.layer).push(site);
    }
  }
  function activateLayer(next) {
    if (next === layer && surface) return;
    layer = next;
    layerCatalog = sitesByLayer.get(layer) || [];
    if (surface) surface.removeFromParent();
    let entry = materialCache.get(layer);
    if (!entry) {
      const fine = layerCatalog.length > 20;
      entry = makeSurface(layerCatalog, fine ? 360 : 160, fine ? 180 : 80);
      materialCache.set(layer, entry);
    }
    // A dive can visit 64 independently fitted bases. Bound GPU and heap residency.
    if (materialCache.size > 6) {
      const oldest = materialCache.keys().next().value;
      if (oldest !== layer) {
        materialCache.get(oldest).geo.dispose();
        materialCache.delete(oldest);
      }
    }
    sampler = entry.sample;
    surface = new T.Mesh(entry.geo, surfaceMat);
    scene.add(surface);
  }
  function raised(dir, off = 0.009) {
    return dir.clone().multiplyScalar(1 + sampler(dir) + off);
  }
  function lineFrom(
    directions,
    start,
    end,
    color,
    opacity,
    offset,
    { width = 0.005, fade = false, dashed = false } = {},
  ) {
    const group = new T.Group(),
      positions = [],
      inks = [],
      underlay = [],
      indices = [];
    const base = new T.Color(color);
    const aSide = new T.Vector3(),
      bSide = new T.Vector3(),
      aDir = new T.Vector3(),
      bDir = new T.Vector3();
    let travelled = 0;
    function pair(target, center, side, radial, w) {
      target.push(
        center.x * radial - side.x * w,
        center.y * radial - side.y * w,
        center.z * radial - side.z * w,
        center.x * radial + side.x * w,
        center.y * radial + side.y * w,
        center.z * radial + side.z * w,
      );
    }
    for (
      let i = Math.max(1, start + 1);
      i <= Math.min(end, directions.length - 1);
      i++
    ) {
      const a = directions[i - 1],
        b = directions[i];
      if (!a || !b) continue;
      const distance = angle(a, b),
        steps = Math.max(1, Math.ceil(distance / 0.018));
      const normal = new T.Vector3().crossVectors(a, b).normalize();
      for (let j = 0; j < steps; j++) {
        travelled += distance / steps;
        if (dashed && travelled % 0.065 > 0.035) continue;
        slerp(a, b, j / steps, aDir);
        slerp(a, b, (j + 1) / steps, bDir);
        const ra = 1 + sampler(aDir) + offset,
          rb = 1 + sampler(bDir) + offset;
        aSide.copy(normal);
        bSide.copy(normal);
        const n = positions.length / 3,
          alpha = fade
            ? 0.3 +
              (0.7 * (i - 1 + (j + 0.5) / steps - start)) /
                Math.max(1, end - start)
            : 1;
        pair(positions, aDir, aSide, ra + 0.001, width);
        pair(positions, bDir, bSide, rb + 0.001, width);
        pair(underlay, aDir, aSide, ra, width + 0.0042);
        pair(underlay, bDir, bSide, rb, width + 0.0042);
        for (let k = 0; k < 4; k++)
          inks.push(base.r * alpha, base.g * alpha, base.b * alpha);
        indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      }
    }
    for (const [points, outline] of [
      [underlay, true],
      [positions, false],
    ]) {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(points, 3));
      g.setIndex(indices);
      if (!outline)
        g.setAttribute("color", new T.Float32BufferAttribute(inks, 3));
      const material = new T.MeshBasicMaterial({
        color: outline ? 0x1c2222 : 0xffffff,
        vertexColors: !outline,
        side: T.DoubleSide,
        transparent: true,
        opacity: outline ? opacity * 0.83 : opacity,
        depthWrite: false,
      });
      const mesh = new T.Mesh(g, material);
      mesh.renderOrder = outline ? 1 : 2;
      group.add(mesh);
    }
    voyage.add(group);
    return group;
  }
  function addReferenceLines() {
    for (const line of referenceLines) release(line);
    referenceLines = [];
    for (const cmp of comparisons) {
      const j = Math.min(frame, cmp.coords.length - 1);
      referenceLines.push(
        lineFrom(cmp.coords, Math.max(0, j - 4), j, cmp.color, 0.94, 0.02, {
          width: 0.0054,
          fade: true,
        }),
      );
      referenceLines.push(
        lineFrom(
          cmp.coords,
          j,
          Math.min(j + 2, cmp.coords.length - 1),
          cmp.color,
          0.63,
          0.016,
          { width: 0.0042, dashed: true },
        ),
      );
    }
  }
  function rebuildTrail() {
    for (const o of [wake, lookAhead, turnArc]) if (o) release(o);
    turnArc = null;
    angleAnchor = null;
    wake = lineFrom(
      coords,
      Math.max(0, frame - 6),
      frame,
      primaryColor,
      0.98,
      0.021,
      { width: 0.0067, fade: true },
    );
    lookAhead = lineFrom(
      coords,
      frame,
      Math.min(frame + 3, coords.length - 1),
      primaryColor,
      0.75,
      0.018,
      { width: 0.0048, dashed: true },
    );
    // The recorded turn theta[t] is at the middle vertex of t-2, t-1, t.
    if (
      frames[frame]?.t === 146 &&
      frames[frame]?.top?.[0]?.id === "L32 C1542" &&
      frame >= 2
    ) {
      const a = coords[frame - 2],
        b = coords[frame - 1],
        c = coords[frame];
      const arrive = b.clone().multiplyScalar(a.dot(b)).sub(a).normalize();
      const depart = c.clone().addScaledVector(b, -b.dot(c)).normalize();
      const pts = [],
        width = 0.19;
      for (let j = 0; j <= 40; j++) {
        const tangent = slerp(arrive, depart, j / 40, new T.Vector3());
        pts.push(
          b
            .clone()
            .multiplyScalar(Math.cos(width))
            .addScaledVector(tangent, Math.sin(width))
            .normalize(),
        );
      }
      angleAnchor = pts[20];
      pts.unshift(b);
      pts.push(b);
      turnArc = lineFrom(pts, 0, pts.length - 1, "#ffdb7b", 1, 0.033, {
        width: 0.0038,
      });
      turnTag.textContent =
        T.MathUtils.radToDeg(frames[frame].theta).toFixed(1) + "°";
    }
    addReferenceLines();
  }

  function makeBeacons() {
    if (signalDots) release(signalDots);
    if (activeRing) release(activeRing);
    const f = frames[frame],
      scores = f?.scores || {};
    const top = new Map((f?.top || []).map((row) => [row.id, row.z]));
    const sites = layerCatalog.filter(
      (site) =>
        top.has(site.id) ||
        (Number.isFinite(scores[site.id]) && scores[site.id] >= tide),
    );
    const xyz = [],
      colors = [];
    mainSite = layerCatalog.find((s) => s.id === f?.top?.[0]?.id) || null;
    for (const site of sites) {
      const z = top.get(site.id) ?? scores[site.id];
      if (z < tide) continue;
      const pos = raised(site.dir, 0.008),
        c = new T.Color(
          site === mainSite ? 0xffdd8b : site.k > 10 ? 0xd1ab72 : 0x6fcec3,
        );
      xyz.push(pos.x, pos.y, pos.z);
      colors.push(c.r, c.g, c.b);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(xyz, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    const m = new T.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      uniforms: { dpi: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute vec3 dummy;uniform float dpi;varying vec3 rgb;void main(){rgb=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(8./(-p.z),2.,5.)*dpi;}`,
      fragmentShader: `varying vec3 rgb;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(rgb,1.-smoothstep(.55,1.,d));}`,
    });
    signalDots = new T.Points(g, m);
    signals.add(signalDots);
    activeRing = null;
    if (mainSite) {
      const pts = [];
      const dir = mainSite.dir,
        east = new T.Vector3()
          .crossVectors(Math.abs(dir.y) > 0.95 ? X : UP, dir)
          .normalize(),
        north = dir.clone().cross(east);
      for (let j = 0; j <= 48; j++) {
        const a = (j * TAU) / 48;
        const d = dir
          .clone()
          .addScaledVector(east, Math.cos(a) * 0.028)
          .addScaledVector(north, Math.sin(a) * 0.028)
          .normalize();
        pts.push(raised(d, 0.012));
      }
      activeRing = new T.Line(
        new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({
          color: 0xf1cb82,
          transparent: true,
          opacity: 0.92,
        }),
      );
      signals.add(activeRing);
      label.querySelector(".marker-id").textContent = mainSite.id;
      label.setAttribute("aria-label", "检查当前主岛 " + mainSite.id);
    }
  }
  function orient(obj, dir, heading, off) {
    const front = heading.clone().addScaledVector(dir, -dir.dot(heading));
    if (front.lengthSq() < 0.00001)
      front.crossVectors(Math.abs(dir.y) > 0.95 ? X : UP, dir);
    front.normalize();
    const right = dir.clone().cross(front).normalize();
    const pose = new T.Matrix4().makeBasis(right, dir, front);
    obj.quaternion.setFromRotationMatrix(pose);
    obj.position.copy(raised(dir, off));
  }
  function setFrame(i, immediate = false) {
    if (!frames.length) return;
    const old = frame;
    snapChase = immediate || Math.abs(i - old) > 1;
    frame = clamp(Math.round(i), 0, frames.length - 1);
    const f = frames[frame],
      dir = coords[frame];
    activateLayer(f.layer);
    rebuildTrail();
    makeBeacons();
    ship.visible = !!dir;
    if (dir) {
      shipPrev =
        !immediate && Math.abs(frame - old) === 1 && coords[old]
          ? coords[old]
          : dir;
      shipNext = dir;
      settleTime = performance.now();
      if (!follow && immediate) {
        camGoal = cameraDirection(dir);
        transition = immediate ? 1 : 0;
        if (immediate) {
          camera.position.copy(camGoal).multiplyScalar(sizeDistance);
          camera.lookAt(0, 0, 0);
          controls.update();
        }
      }
    }
    peerShips.forEach((obj, index) => {
      const cmp = comparisons[index],
        j = Math.min(frame, cmp.coords.length - 1),
        p = cmp.coords[j];
      obj.visible = !!p;
      if (p)
        orient(
          obj,
          p,
          cmp.coords[j + 1] ||
            p
              .clone()
              .multiplyScalar(2)
              .sub(cmp.coords[j - 1] || p),
          0.019 + index * 0.004,
        );
    });
    dirtySelection = true;
  }
  function setTrack(nextFrames, islands, opts = {}) {
    if (islandRegistry !== islands) {
      for (const entry of materialCache.values()) entry.geo.dispose();
      materialCache.clear();
      islandRegistry = islands || {};
      makeCatalog();
      layer = null;
    }
    frames = nextFrames || [];
    coords = frames.map((f) => (unit(f.p) ? V(f.p) : null));
    primaryColor = opts.color || "#efb765";
    comparisons = (opts.comparisons || [])
      .filter((c) => c.frames?.length)
      .map((c) => ({
        ...c,
        coords: c.frames.map((f) => (unit(f.p) ? V(f.p) : null)),
      }));
    trackKey.replaceChildren();
    if (comparisons.length) {
      const compact = (text) =>
        (text || "对照")
          .replace("自然解码", "自然")
          .replace("屏蔽 EOS", "阻断 EOS")
          .replace("机械重复", "复读");
      trackKey.append(legendRow("solid", compact(opts.label), primaryColor));
      for (const cmp of comparisons)
        trackKey.append(legendRow("solid", compact(cmp.label), cmp.color));
    } else {
      trackKey.append(
        legendRow("solid", "已航", primaryColor),
        legendRow("dashed", "前方", primaryColor),
      );
    }
    for (const obj of peerShips) release(obj);
    peerShips = comparisons.map((c) => {
      const peer = makeShip(c.color);
      fleet.add(peer);
      return peer;
    });
    release(ship);
    ship = makeShip(primaryColor);
    fleet.add(ship);
    setFrame(opts.focusIndex ?? 0, true);
    onHover?.(null, null, null);
  }
  function setFollow(value) {
    follow = !!value;
    controls.enabled = !follow;
    if (follow) {
      camGoal = null;
      snapChase = true;
    } else {
      camera.up.copy(UP);
      controls.target.set(0, 0, 0);
      resetView();
    }
    dial.visible = !follow;
    dirtySelection = true;
  }
  function setTide(z) {
    if (Number.isFinite(z)) {
      tide = z;
      if (frames.length) makeBeacons();
    }
  }
  function resetView() {
    if (!coords[frame] || follow) return;
    camGoal = cameraDirection(coords[frame]);
    camera.position.copy(camGoal).multiplyScalar(sizeDistance);
    controls.update();
    dirtySelection = true;
  }
  function resize() {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    sceneSize.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Fit the circular dial within either viewport dimension.
    const limit = Math.atan(
      Math.tan(T.MathUtils.degToRad(camera.fov * 0.5)) *
        Math.min(1, camera.aspect),
    );
    const next = 1.25 / Math.sin(limit);
    camera.position.multiplyScalar(next / sizeDistance);
    sizeDistance = next;
    controls.update();
    dirtySelection = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  function projected(dir, offset = 0.012) {
    const world = raised(dir, offset);
    if (dir.dot(camera.position.clone().sub(world)) < 0.01) return null;
    const p = world.project(camera),
      x = (p.x * 0.5 + 0.5) * sceneSize.x,
      y = (-p.y * 0.5 + 0.5) * sceneSize.y;
    if (x < 5 || y < 5 || x > sceneSize.x - 5 || y > sceneSize.y - 5)
      return null;
    return { x, y };
  }
  function placeLabel() {
    projectedLabel = mainSite ? projected(mainSite.dir) : null;
    const away = mainSite && !projectedLabel;
    if (away && !follow) {
      const center = new T.Vector3().project(camera),
        proj = mainSite.dir.clone().project(camera);
      const sx = (proj.x - center.x) * sceneSize.x,
        sy = -(proj.y - center.y) * sceneSize.y;
      const length = Math.max(0.00001, Math.hypot(sx, sy));
      const radius =
        (sceneSize.y * 0.5) /
        (Math.tan(T.MathUtils.degToRad(camera.fov * 0.5)) *
          Math.sqrt(camera.position.lengthSq() - 1));
      projectedLabel = {
        x: clamp(
          sceneSize.x * 0.5 + (sx / length) * radius,
          24,
          sceneSize.x - 24,
        ),
        y: clamp(
          sceneSize.y * 0.5 + (sy / length) * radius,
          30,
          sceneSize.y - 32,
        ),
      };
    }
    if (mainSite)
      label.querySelector(".marker-id").textContent =
        (away ? "背面 · " : "") + mainSite.id;
    label.classList.toggle("is-far", !!away);
    const tag = angleAnchor && projected(angleAnchor, 0.035);
    turnTag.hidden = !tag;
    if (tag)
      turnTag.style.transform =
        "translate(" +
        Math.round(tag.x + 4) +
        "px," +
        Math.round(tag.y - 19) +
        "px)";
    label.style.display = projectedLabel ? "flex" : "none";
    if (!projectedLabel) return;
    label.hidden = false;
    const { x, y } = projectedLabel;
    const left = x > sceneSize.x - 112;
    label.style.flexDirection = left ? "row-reverse" : "row";
    label.style.transform =
      "translate(" +
      Math.round(left ? x - label.offsetWidth : x) +
      "px," +
      Math.round(y - label.offsetHeight / 2) +
      "px)";
  }
  function focusIsland(id) {
    const site = layerCatalog.find((site) => site.id === id);
    if (site && !follow) {
      camGoal = cameraDirection(site.dir);
      transition = 0;
    }
  }
  const emitMain = () => {
    if (mainSite) {
      onPick?.(mainSite.raw, frames[frame], projectedLabel);
      if (label.classList.contains("is-far")) focusIsland(mainSite.id);
    }
  };
  label.addEventListener("click", emitMain);
  function hitAt(x, y) {
    if (!surface) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const pos = new T.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      (-(y - rect.top) / rect.height) * 2 + 1,
    );
    pickRay.setFromCamera(pos, camera);
    const cast = pickRay.intersectObject(surface, false)[0];
    if (!cast) return null;
    const p = cast.point.normalize();
    let best = null,
      score = Infinity;
    for (const site of layerCatalog) {
      const d = angle(p, site.dir),
        norm = d / Math.max(0.05, site.footprint || 0.08);
      if (norm < score) {
        score = norm;
        best = site;
      }
    }
    return score < 1.05 ? best : null;
  }
  let down = null,
    hoverAt = 0,
    pointerHeld = false;
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY };
    pointerHeld = true;
    camGoal = null;
  });
  canvas.addEventListener("pointercancel", () => {
    down = null;
    pointerHeld = false;
  });
  canvas.addEventListener("pointerleave", () => {
    showHover = null;
    onHover?.(null, null, null);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (
      pointerHeld ||
      !onHover ||
      e.pointerType === "touch" ||
      performance.now() - hoverAt < 65
    )
      return;
    hoverAt = performance.now();
    const site = hitAt(e.clientX, e.clientY);
    canvas.style.cursor = site ? "pointer" : "grab";
    if (site !== showHover) {
      showHover = site;
      onHover(
        site?.raw || null,
        frames[frame],
        site ? projected(site.dir) : null,
      );
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    pointerHeld = false;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      down = null;
      return;
    }
    down = null;
    const site = hitAt(e.clientX, e.clientY);
    onPick?.(
      site?.raw || null,
      frames[frame],
      site ? projected(site.dir) : null,
    );
  });
  canvas.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      emitMain();
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "+", "-"].includes(
        e.key,
      )
    )
      return;
    e.preventDefault();
    camGoal = null;
    const sph = new T.Spherical().setFromVector3(camera.position);
    if (e.key === "ArrowLeft") sph.theta -= 0.12;
    if (e.key === "ArrowRight") sph.theta += 0.12;
    if (e.key === "ArrowDown") sph.phi -= 0.12;
    if (e.key === "ArrowUp") sph.phi += 0.12;
    if (e.key === "+")
      sph.radius = Math.max(controls.minDistance, sph.radius * 0.9);
    if (e.key === "-")
      sph.radius = Math.min(controls.maxDistance, sph.radius * 1.1);
    sph.makeSafe();
    camera.position.setFromSpherical(sph);
    controls.update();
  });
  controls.addEventListener("change", () => {
    dirtySelection = true;
  });
  let previous = 0,
    raf = 0;
  function render(now) {
    raf = requestAnimationFrame(render);
    if (document.hidden || now - previous < 30) return;
    const dt = Math.min(0.08, (now - previous) * 0.001);
    previous = now;
    if (!follow) controls.update();
    if (!follow && camGoal && transition < 1 && !pointerHeld) {
      const d = camera.position.length(),
        dir = camera.position.clone().normalize();
      const next = slerp(dir, camGoal, 1 - Math.exp(-dt * 6), new T.Vector3());
      camera.position.copy(next).multiplyScalar(d);
      camera.lookAt(0, 0, 0);
      if (angle(next, camGoal) < 0.002) transition = 1;
      dirtySelection = true;
    }
    wakeDot.visible = !!(frame > 0 && coords[frame - 1] && coords[frame]);
    if (wakeDot.visible) {
      const t = (now * 0.00062) % 1;
      const point = slerp(coords[frame - 1], coords[frame], t, new T.Vector3());
      wakeDot.position.copy(raised(point, 0.028));
      wakeDot.material.opacity = 0.52 + 0.38 * Math.sin(t * Math.PI);
    }
    if (shipNext) {
      const t = smooth(0, 1, (now - settleTime) / 320);
      const dir = slerp(shipPrev, shipNext, t, new T.Vector3());
      const heading =
        coords[frame + 1] ||
        dir
          .clone()
          .multiplyScalar(2)
          .sub(coords[frame - 1] || dir);
      orient(ship, dir, heading, 0.022);
      if (follow) {
        // Track the stern, looking forward over the deck in its local tangent frame.
        const forward = new T.Vector3(0, 0, 1).applyQuaternion(ship.quaternion);
        const targetPosition = dir
          .clone()
          .multiplyScalar(1.63 + sampler(dir))
          .addScaledVector(forward, -0.78);
        const targetAim = dir
          .clone()
          .multiplyScalar(1.04 + sampler(dir))
          .addScaledVector(forward, 0.115);
        const ease = snapChase ? 1 : 1 - Math.exp(-dt * 6.6);
        snapChase = false;
        // Move outside the sphere even when jumping to a distant frame.
        const radius = T.MathUtils.lerp(
          camera.position.length(),
          targetPosition.length(),
          ease,
        );
        const direction = slerp(
          camera.position.clone().normalize(),
          targetPosition.normalize(),
          ease,
          new T.Vector3(),
        );
        camera.position.copy(direction).multiplyScalar(radius);
        camera.up.lerp(dir, ease).normalize();
        camera.lookAt(targetAim);
        dirtySelection = true;
      }
      // Maintain a readable silhouette at instrument scale.
      ship.scale.setScalar(
        clamp(
          camera.position.length() * (sceneSize.y < 420 ? 0.78 : 0.56),
          1.05,
          3.1,
        ),
      );
      peerShips.forEach((o) => o.scale.copy(ship.scale));
    }
    dial.quaternion.copy(camera.quaternion);
    surfaceMat.uniforms.time.value = now * 0.00045;
    if (activeRing)
      activeRing.material.opacity = 0.74 + 0.22 * Math.sin(now * 0.0026);
    if (dirtySelection) {
      placeLabel();
      dirtySelection = false;
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(render);
  return {
    setTrack,
    setFrame,
    setFollow,
    setTide,
    resetView,
    focusIsland,
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      for (const e of materialCache.values()) e.geo.dispose();
      renderer.dispose();
      canvas.remove();
      label.remove();
      turnTag.remove();
      trackKey.remove();
      wakeDot.material.map.dispose();
    },
  };
}
