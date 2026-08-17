/**
 * THROWAWAY SPIKE — Stage A of docs/WEBGPU_MIGRATION_PLAN.md §5. NOT SHIPPED CODE.
 *
 * The synthetic scene both arms of the benchmark render. One builder, two
 * material classes: `MeshStandardMaterial` under WebGL, `MeshStandardNodeMaterial`
 * under WebGPU. Nothing else differs, which is the whole point — the question is
 * what the RENDERER costs, not what our shaders cost.
 *
 * IT IS SHAPED TO MATCH OUR MEASURED FRAME, not to look like anything:
 *
 *   colour-pass draws     54-76      (shots/_report.json, v2.12.0)
 *   triangles           0.44M-1.03M
 *   shader programs        66-76
 *   instanced batches       <= 30    (Scatter's prop-type cap)
 *   one directional shadow map, 2048 (src/render/renderer.ts:403)
 *
 * TRIANGLES ARE HELD ROUGHLY CONSTANT ACROSS THE DRAW SWEEP, deliberately. The
 * sweep exists to isolate CPU cost per DRAW; letting triangles ride along with
 * draw count would conflate submission cost with rasterisation cost and the
 * crossover point would mean nothing. Per-mesh tessellation is scaled down as
 * the draw count goes up, and the achieved triangle count is reported at every
 * point so the reader can check the claim rather than take it.
 *
 * There is no post chain here. Adding one would be a second variable, and §0's
 * claim is specifically about draw SUBMISSION.
 */

/** Deterministic RNG — same content on both arms, run to run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Four small procedural textures, shared by every material. Small on purpose:
 * the benchmark must not turn into a texture-upload measurement.
 */
function makeTextures(THREE) {
  const mk = (draw) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    draw(g);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  return {
    map: mk((g) => {
      g.fillStyle = '#8b8f7d';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#6c705f';
      g.lineWidth = 2;
      for (let i = 0; i <= 256; i += 32) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 256);
        g.moveTo(0, i);
        g.lineTo(256, i);
        g.stroke();
      }
    }),
    normal: mk((g) => {
      g.fillStyle = '#8080ff';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#9a9aff';
      for (let i = 0; i < 256; i += 64) g.fillRect(i, 0, 8, 256);
    }),
    rough: mk((g) => {
      g.fillStyle = '#606060';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#a0a0a0';
      g.fillRect(0, 0, 128, 128);
      g.fillRect(128, 128, 128, 128);
    }),
    emissive: mk((g) => {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#ff9a3c';
      for (let i = 16; i < 256; i += 48) g.fillRect(i, 96, 20, 40);
    }),
  };
}

/**
 * ~70 DISTINCT MATERIAL CONFIGURATIONS, which is what puts 66-76 programs in
 * flight the way the real frame does.
 *
 * Seven independent boolean feature axes, each of which lands in the WebGL
 * program cache key as its own `USE_*` define (and in the node graph as its own
 * branch). 2^7 = 128 combinations; the first `count` of them are taken in Gray
 * order so consecutive materials differ in exactly one feature — the state
 * change a renderer actually has to service.
 */
function makeMaterials(THREE, MaterialClass, tex, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const g = i ^ (i >> 1); // Gray code
    const m = new MaterialClass();
    m.color = new THREE.Color().setHSL((i * 0.137) % 1, 0.35, 0.52);
    m.roughness = 0.55 + ((i % 5) * 0.07);
    m.metalness = (i % 3) * 0.2;
    if (g & 1) m.map = tex.map;
    if (g & 2) m.normalMap = tex.normal;
    if (g & 4) m.roughnessMap = tex.rough;
    if (g & 8) m.metalnessMap = tex.rough;
    if (g & 16) {
      m.emissiveMap = tex.emissive;
      m.emissive = new THREE.Color(0x332211);
    }
    if (g & 32) m.aoMap = tex.rough;
    if (g & 64) m.flatShading = true;
    out.push(m);
  }
  return out;
}

/** Sphere triangle count for a given segment resolution. */
function sphereTris(w, h) {
  return w * (h - 2) * 2 + w * 2;
}

/**
 * Builds the scene for a requested opaque-draw count.
 *
 * @param {object} THREE  the namespace — `three` or `three/webgpu`
 * @param {Function} MaterialClass  MeshStandardMaterial | MeshStandardNodeMaterial
 * @param {number} draws  target opaque draws in the colour pass
 */
export function buildScene(THREE, MaterialClass, draws) {
  const rand = mulberry32(0x5eed);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb0c4);

  const tex = makeTextures(THREE);
  const MATERIAL_COUNT = 70;
  const materials = makeMaterials(THREE, MaterialClass, tex, MATERIAL_COUNT);

  // ---- ground: one draw, fixed tessellation ------------------------------
  const GROUND_SEGS = 128;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320, GROUND_SEGS, GROUND_SEGS),
    materials[0],
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  let tris = GROUND_SEGS * GROUND_SEGS * 2;

  // ---- instanced batches: the scatter-prop analogue ----------------------
  // `Scatter` caps prop TYPES at 30 and each type is one InstancedMesh.
  const typeCount = Math.min(30, Math.max(4, Math.round(draws * 0.35)));
  const INSTANCED_TRI_BUDGET = 450_000;
  const propGeoTris = 80; // IcosahedronGeometry(r, 1)
  const perType = Math.max(1, Math.round(INSTANCED_TRI_BUDGET / (typeCount * propGeoTris)));
  const propGeo = new THREE.IcosahedronGeometry(1, 1);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const batches = [];
  for (let t = 0; t < typeCount; t++) {
    const im = new THREE.InstancedMesh(propGeo, materials[t % MATERIAL_COUNT], perType);
    for (let i = 0; i < perType; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 150;
      pos.set(Math.cos(a) * r, 0.8 + rand() * 2.2, Math.sin(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      const s = 0.5 + rand() * 1.6;
      scl.set(s, s, s);
      im.setMatrixAt(i, m4.compose(pos, q, scl));
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false; // every batch must be submitted, every frame
    scene.add(im);
    batches.push(im);
    tris += perType * propGeoTris;
  }

  // ---- singles: one draw each, tessellation scaled to hold the budget ----
  const singles = Math.max(0, draws - typeCount - 1);
  const SINGLE_TRI_BUDGET = 220_000;
  const perSingle = singles > 0 ? SINGLE_TRI_BUDGET / singles : 0;
  const seg = Math.max(3, Math.min(48, Math.round(Math.sqrt(perSingle / 2))));
  // A pool of distinct geometries, so the renderer has real vertex-buffer
  // rebinding to do rather than one buffer bound once.
  const GEO_POOL = 16;
  const geos = [];
  for (let i = 0; i < GEO_POOL; i++) {
    geos.push(new THREE.SphereGeometry(1 + i * 0.02, seg, Math.max(3, seg)));
  }
  const singleTris = sphereTris(seg, Math.max(3, seg));
  for (let i = 0; i < singles; i++) {
    const mesh = new THREE.Mesh(geos[i % GEO_POOL], materials[i % MATERIAL_COUNT]);
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 150;
    mesh.position.set(Math.cos(a) * r, 1.5 + rand() * 6, Math.sin(a) * r);
    const s = 0.8 + rand() * 2.0;
    mesh.scale.setScalar(s);
    // ~60% cast, which is the shadow:colour draw ratio the real frame reports
    // (shadow 29-59 against colour 51-77).
    mesh.castShadow = i % 5 < 3;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tris += singleTris;
  }

  // ---- lights: one directional shadow caster, no AmbientLight ------------
  // (CLAUDE.md: HemisphereLight only — a flat ambient kills the shadow tint.)
  const sun = new THREE.DirectionalLight(0xfff2dc, 3.0);
  sun.position.set(80, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -170;
  sc.right = 170;
  sc.top = 170;
  sc.bottom = -170;
  sc.near = 1;
  sc.far = 420;
  sc.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x4a4438, 1.1));

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 700);
  camera.position.set(0, 95, 165);
  camera.lookAt(0, 0, 0);

  return {
    scene,
    camera,
    spec: {
      requestedDraws: draws,
      instancedBatches: typeCount,
      instancesPerBatch: perType,
      singles,
      materials: MATERIAL_COUNT,
      sphereSegments: seg,
      expectedTriangles: tris,
    },
  };
}
