// Renderer, camera, neon bloom pipeline and the 3D server-room corridor.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { A } from './assets.js';

export const world = {
  renderer: null,
  scene: null,
  camera: null,
  composer: null,
  bloom: null,
  useBloom: true,
  width: 1,
  height: 1,
  halfW: 10,  // visible half-extent of the play plane (z = 0) in world units
  halfH: 8,
  scale: 1,  // >1 when the camera is pulled back (portrait)
  time: { value: 0 },
  racksL: null,
  racksR: null,
};

const CAM_Z = 22;
const FOV = 42;
const MIN_HALF_W = 8.5;

export function initWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  world.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07051a);
  scene.fog = new THREE.FogExp2(0x0b0726, 0.014);
  world.scene = scene;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 300);
  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);
  world.camera = camera;

  world.composer = new EffectComposer(renderer);
  world.composer.addPass(new RenderPass(scene, camera));
  world.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.75, 0.45, 0.78);
  world.composer.addPass(world.bloom);
  world.composer.addPass(new OutputPass());

  resize();
  window.addEventListener('resize', resize);
  return world;
}

export function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  world.width = w;
  world.height = h;
  const { renderer, camera, composer } = world;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // portrait phones: pull the camera back so the play field stays wide enough
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camZ = Math.max(CAM_Z, MIN_HALF_W / (tan * camera.aspect));
  camera.position.z = camZ;
  world.halfH = camZ * tan;
  world.halfW = world.halfH * camera.aspect;
  world.scale = world.halfH / (CAM_Z * tan); // 1 on landscape screens
  placeRacks();
}

export function render() {
  if (world.useBloom) world.composer.render();
  else world.renderer.render(world.scene, world.camera);
}

const _v = new THREE.Vector3();
/** world position -> CSS pixel coordinates */
export function toScreen(p, out = { x: 0, y: 0 }) {
  _v.copy(p).project(world.camera);
  out.x = (_v.x * 0.5 + 0.5) * world.width;
  out.y = (-_v.y * 0.5 + 0.5) * world.height;
  return out;
}

/** CSS pixel -> world point on plane z = 0 */
export function toWorld(x, y, out = new THREE.Vector3()) {
  out.set((x / world.width) * 2 - 1, -(y / world.height) * 2 + 1, 0.5).unproject(world.camera);
  const dir = out.sub(world.camera.position).normalize();
  const t = -world.camera.position.z / dir.z;
  return out.copy(world.camera.position).addScaledVector(dir, t);
}

// ==========================================================================
// Environment
// ==========================================================================
export function buildEnvironment() {
  const { scene, renderer } = world;

  // --- neon reflection environment for chrome / gold connector parts
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x05040c);
  const panel = (color, intensity, w, h, pos, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.rotation.y = rotY;
    envScene.add(m);
  };
  panel(0x33c8ff, 3, 6, 14, [-9, 0, 0], Math.PI / 2);
  panel(0x9a4dff, 2.5, 6, 14, [9, 0, 0], -Math.PI / 2);
  panel(0xffffff, 4, 14, 2, [0, 9, 0]);
  panel(0xff3a8a, 1.6, 10, 5, [0, -2, -9]);
  panel(0x6dff6a, 1.2, 4, 4, [3, 3, 9], Math.PI);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ color: 0xbfd8ff }));
  top.position.set(0, 9.5, 0);
  top.rotation.x = Math.PI / 2;
  envScene.add(top);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  // --- lights
  scene.add(new THREE.HemisphereLight(0x7a6bff, 0x12081e, 0.8));
  const key = new THREE.DirectionalLight(0xd8e8ff, 1.5);
  key.position.set(4, 10, 14);
  scene.add(key);
  const rimL = new THREE.PointLight(0x2fb8ff, 30, 40, 1.4);
  rimL.position.set(-12, 3, 6);
  scene.add(rimL);
  const rimR = new THREE.PointLight(0xa24dff, 30, 40, 1.4);
  rimR.position.set(12, 3, 6);
  scene.add(rimR);
  // corridor fill lights so the rack fronts pick up blue / purple
  const fillA = new THREE.PointLight(0x5a6bff, 40, 60, 1.2);
  fillA.position.set(0, 7, -12);
  scene.add(fillA);
  const fillB = new THREE.PointLight(0xb04dff, 40, 70, 1.2);
  fillB.position.set(0, 3, -34);
  scene.add(fillB);

  // --- server racks
  // back wall of racks closing the corridor (faces the camera)
  const back = new THREE.Group();
  for (let i = -6; i <= 6; i++) {
    const geo = new THREE.BoxGeometry(3.1, 21, 2.6);
    const uv = geo.attributes.uv;
    const off = Math.random();
    for (let k = 16; k < 20; k++) uv.setY(k, uv.getY(k) * 2.1 + off); // +z face
    const m = new THREE.Mesh(geo, [rackBodyMat(), rackBodyMat(), rackBodyMat(), rackBodyMat(), rackMaterial(), rackBodyMat()]);
    m.position.set(i * 3.2, 0.5, -90);
    back.add(m);
  }
  scene.add(back);

  world.racksL = buildRackRow(1);
  world.racksR = buildRackRow(-1);
  scene.add(world.racksL, world.racksR);

  // --- floor + ceiling
  const floorTex = A.tex.floor_grid.clone();
  floorTex.repeat.set(10, 30);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 180),
    new THREE.MeshStandardMaterial({ map: floorTex, color: 0x6a5aa8, metalness: 0.75, roughness: 0.32 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -10.5, -70);
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(60, 180), new THREE.MeshStandardMaterial({ color: 0x0b0a1a, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 12, -70);
  scene.add(ceil);

  // neon light bars along the corridor (bloom candy)
  const barGeo = new THREE.BoxGeometry(0.25, 0.12, 170);
  const addBar = (x, y, color, intensity) => {
    const m = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
    m.position.set(x, y, -80);
    scene.add(m);
  };
  addBar(-6.5, 11.8, 0x7fd6ff, 0.9);
  addBar(6.5, 11.8, 0xb38bff, 0.9);
  addBar(-9, -10.4, 0x2fb8ff, 0.9);
  addBar(9, -10.4, 0x9a4dff, 0.9);

  // purple haze at the end of the corridor
  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 50),
    new THREE.MeshBasicMaterial({ map: radialTexture(['rgba(110,60,255,0.35)', 'rgba(50,25,140,0.15)', 'rgba(10,6,40,0)']), transparent: true, depthWrite: false, fog: false }),
  );
  haze.position.set(0, 0, -82);
  scene.add(haze);

  // droopy background cables hanging between the racks
  const bgCables = new THREE.Group();
  const cols = [0x2f7dff, 0xffc21a, 0xff3552, 0x1fdc55, 0x6a4dff];
  for (let i = 0; i < 16; i++) {
    const z = -18 - Math.random() * 70;
    const x0 = (Math.random() - 0.5) * 22;
    const x1 = x0 + (Math.random() - 0.5) * 10;
    const sag = 3 + Math.random() * 6;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, 12, z),
      new THREE.Vector3((x0 + x1) / 2 + (Math.random() - 0.5) * 3, 12 - sag, z + (Math.random() - 0.5) * 4),
      new THREE.Vector3(x1, 12, z + (Math.random() - 0.5) * 6),
    ]);
    const c = cols[i % cols.length];
    const m = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 30, 0.16, 6),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, roughness: 0.4 }),
    );
    bgCables.add(m);
  }
  scene.add(bgCables);

  // floating dust in the light
  const N = 500;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 40;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 22;
    pos[i * 3 + 2] = -Math.random() * 60 + 4;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x8fb8ff, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.userData.update = (dt) => {
    const a = dustGeo.attributes.position;
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) + dt * 0.25;
      if (y > 11) y = -11;
      a.setY(i, y);
    }
    a.needsUpdate = true;
  };
  scene.add(dust);
  world.dust = dust;

  placeRacks();
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach((s, i) => grd.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let rackFrontMat = null;

function rackMaterial() {
  if (rackFrontMat) return rackFrontMat;
  const mat = new THREE.MeshStandardMaterial({
    map: A.tex.rack_front,
    emissiveMap: A.tex.rack_emissive,
    emissive: 0xffffff,
    emissiveIntensity: 1.6,
    color: 0x7a74c8,
    metalness: 0.55,
    roughness: 0.45,
  });
  // blinking status LEDs: each LED cell gets its own random blink rhythm
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = world.time;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nfloat h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 cell = floor(vEmissiveMapUv * vec2(128.0, 384.0));
        float seed = h21(cell);
        float rate = 1.5 + seed * 9.0;
        float on = step(0.3, h21(cell + floor(uTime * rate)));
        totalEmissiveRadiance *= mix(0.12, 1.0, on);`);
  };
  rackFrontMat = mat;
  return mat;
}

let bodyMat = null;
function rackBodyMat() {
  if (!bodyMat) bodyMat = new THREE.MeshStandardMaterial({ color: 0x141428, metalness: 0.6, roughness: 0.5 });
  return bodyMat;
}

function buildRackRow(side) {
  // side = +1 => left row (faces +x), -1 => right row (faces -x)
  const group = new THREE.Group();
  const body = rackBodyMat();
  const front = rackMaterial();
  const trimCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3aa0ff).multiplyScalar(1.3) });
  const trimPurple = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a4dff).multiplyScalar(1.3) });
  const W = 3.2; // rack width along z
  const H = 21;
  const D = 2.6;
  for (let i = 0; i < 26; i++) {
    const geo = new THREE.BoxGeometry(D, H, W - 0.12);
    // randomise which slice of the tall rack texture each rack shows
    const uv = geo.attributes.uv;
    const off = Math.random();
    const flip = Math.random() < 0.5;
    for (let k = 0; k < 4; k++) { // +x face = first 4 vertices
      uv.setY(k, uv.getY(k) * 2.1 + off);
      if (flip) uv.setX(k, 1 - uv.getX(k));
    }
    const mats = [front, body, body, body, body, body];
    const rack = new THREE.Mesh(geo, mats);
    const z = 1.5 - i * W;
    rack.position.set(0, 0.5, z);
    if (side < 0) rack.rotation.y = Math.PI; // turn the front face towards the corridor
    group.add(rack);
    // neon edge trims on the corridor-facing side
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), i % 3 === 0 ? trimPurple : trimCyan);
    trim.position.set(side * (D / 2 + 0.02), 0.5, z + W / 2 - 0.06);
    group.add(trim);
  }
  group.userData.side = side;
  return group;
}

function placeRacks() {
  if (!world.racksL) return;
  // keep racks framing the play field like the reference art
  const x = Math.max(7.5, world.halfW * 0.9 + 1.2);
  world.racksL.position.set(-x - 1.3, 0, -3);
  world.racksR.position.set(x + 1.3, 0, -3);
  // tilt rows slightly inwards so they converge towards the vanishing point
  world.racksL.rotation.y = -0.06;
  world.racksR.rotation.y = 0.06;
}
