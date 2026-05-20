/**
 * SatelliteOrbitalLayer — a MapLibre CustomLayerInterface that renders
 * satellites at their actual orbital altitude using Three.js, so they
 * float in 3D above the globe instead of being projected flat on the
 * surface. Closes the "feels like Cesium" gap WWV had.
 *
 * How it works:
 *   - On `onAdd`, we initialize a Three.js renderer reusing MapLibre's
 *     own WebGL context (passed via `gl`). That keeps everything in
 *     one canvas — no second-layer compositing.
 *   - For each satellite we maintain an InstancedMesh slot: lat/lng/alt
 *     gets converted to MercatorCoordinate-space (MapLibre's normalized
 *     world units) and the instance matrix is updated.
 *   - On `render`, we just sync the camera from MapLibre's projection
 *     matrix and draw. No per-frame data updates — satellites only
 *     move when the API poll refreshes their positions.
 *
 * The earth's radius in mercator units depends on latitude (because
 * the mercator projection's "meterInMercatorCoordinateUnits" returns
 * a per-meter scaling factor). We use the equator (lat=0) reference
 * so altitudes look right at the equator; near the poles they get
 * slightly stretched, which is fine for an at-a-glance visual.
 */

import * as THREE from 'three';
import type { CustomLayerInterface, Map as MaplibreMap } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';

export interface SatellitePoint {
  lat: number;
  lng: number;
  alt: number;        // kilometres above sea level
  color?: string;     // hex like "#D4AF37"
  name?: string;
}

const MAX_SATELLITES = 4096;  // upper bound; we tile by InstancedMesh

export class SatelliteOrbitalLayer implements CustomLayerInterface {
  id = 'satellites-orbital';
  type = 'custom' as const;
  renderingMode = '3d' as const;

  private map: MaplibreMap | null = null;
  private camera = new THREE.PerspectiveCamera();
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private count = 0;

  // Pending data (set by the consumer before/after onAdd). Synced into
  // the InstancedMesh next render.
  private pending: SatellitePoint[] = [];
  private dirty = true;

  setData(satellites: SatellitePoint[]) {
    this.pending = satellites;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  onAdd(map: MaplibreMap, gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.map = map;

    // Three.js renderer that *shares* MapLibre's GL context, so we
    // don't waste a second framebuffer.
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: false,
    });
    this.renderer.autoClear = false;

    // One small sphere geometry, instanced for every satellite. Cheap
    // even at 4k instances on integrated GPUs.
    const geometry = new THREE.SphereGeometry(1, 6, 6);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_SATELLITES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // instance colour buffer
    const colourBuf = new Float32Array(MAX_SATELLITES * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colourBuf, 3);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  onRemove() {
    this.scene.clear();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material)?.dispose();
    this.renderer = null;
    this.map = null;
  }

  private syncInstances() {
    if (!this.mesh) return;
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    const n = Math.min(this.pending.length, MAX_SATELLITES);

    // Size of one MercatorCoordinate unit at the equator, in metres.
    // Used to convert km of altitude into the renderer's space.
    const refMerc = maplibregl.MercatorCoordinate.fromLngLat([0, 0], 0);
    const metresPerMercatorUnit = 1 / refMerc.meterInMercatorCoordinateUnits();
    // Instance scale: render the sphere at ~12 km radius so it's visible
    // even at world zoom. Tweak if satellites read as too big.
    const SAT_RADIUS_KM = 12;

    for (let i = 0; i < n; i++) {
      const s = this.pending[i];
      const m = maplibregl.MercatorCoordinate.fromLngLat(
        [s.lng, s.lat],
        s.alt * 1000,  // km → metres
      );
      const scaleInMerc = (SAT_RADIUS_KM * 1000) / metresPerMercatorUnit;
      dummy.position.set(m.x, m.y, m.z);
      dummy.scale.setScalar(scaleInMerc);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);

      const hex = s.color || '#D4AF37';
      try {
        colour.set(hex);
      } catch {
        colour.set('#D4AF37');
      }
      this.mesh.setColorAt(i, colour);
    }
    // Zero out any unused instances so they don't render leftover data
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = n; i < this.mesh.count; i++) {
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.count = MAX_SATELLITES;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.count = n;
    this.dirty = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(_gl: WebGL2RenderingContext | WebGLRenderingContext, options: any) {
    if (!this.renderer || !this.mesh) return;
    if (this.dirty) this.syncInstances();

    // MapLibre 5.x passes a `CustomRenderMethodInput` whose
    // `defaultProjectionData.mainMatrix` is the viewProjection matrix
    // in render-coord space. Older versions passed the raw array.
    // We accept either shape so we don't lock to one minor.
    const rawMatrix: number[] = Array.isArray(options)
      ? options
      : options?.defaultProjectionData?.mainMatrix;
    if (!rawMatrix) return;

    const m = new THREE.Matrix4().fromArray(rawMatrix);
    this.camera.projectionMatrix = m;
    (this.camera as unknown as { projectionMatrixInverse: THREE.Matrix4 })
      .projectionMatrixInverse = m.clone().invert();

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map?.triggerRepaint();
  }
}
