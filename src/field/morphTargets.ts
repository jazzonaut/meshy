import * as THREE from 'three/webgpu';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import helvetiker from 'three/examples/fonts/helvetiker_regular.typeface.json';
import type { MorphShape } from './config';

// Parse the bundled font once; TextGeometry needs a Font instance.
const font = new FontLoader().parse(helvetiker as any);

/** A heart cross-section extruded into 3D, centred, scaled to the field radius. */
function heartGeometry(radius: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(25, 25);
  shape.bezierCurveTo(25, 25, 20, 0, 0, 0);
  shape.bezierCurveTo(-30, 0, -30, 35, -30, 35);
  shape.bezierCurveTo(-30, 55, -10, 77, 25, 95);
  shape.bezierCurveTo(60, 77, 80, 55, 80, 35);
  shape.bezierCurveTo(80, 35, 80, 0, 50, 0);
  shape.bezierCurveTo(35, 0, 25, 25, 25, 25);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 24, bevelEnabled: false });
  geo.center();
  geo.rotateZ(Math.PI); // the classic path is upside-down; flip so the lobes are up
  geo.scale(radius * 0.016, radius * 0.016, radius * 0.016);
  return geo;
}

/** A tube wound into a vertical helix. */
function helixGeometry(radius: number): THREE.TubeGeometry {
  const turns = 3;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240;
    const a = t * turns * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius * 0.6, (t - 0.5) * radius * 1.9, Math.sin(a) * radius * 0.6));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 400, radius * 0.12, 14, false);
}

/** Build the geometry for a shape, sized relative to the field radius, or null. */
function geometryFor(shape: MorphShape, radius: number): THREE.BufferGeometry | null {
  switch (shape) {
    case 'Sphere':
      return new THREE.SphereGeometry(radius, 64, 64);
    case 'Cube':
      return new THREE.BoxGeometry(radius * 1.6, radius * 1.6, radius * 1.6, 12, 12, 12);
    case 'Pyramid':
      return new THREE.ConeGeometry(radius, radius * 1.7, 4, 1);
    case 'Cylinder':
      return new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, radius * 1.7, 48, 12, true);
    case 'Capsule':
      return new THREE.CapsuleGeometry(radius * 0.55, radius * 1.1, 16, 32);
    case 'Icosahedron':
      return new THREE.IcosahedronGeometry(radius, 0); // detail 0 → sharp facets
    case 'Torus':
      return new THREE.TorusGeometry(radius * 0.72, radius * 0.28, 32, 220);
    case 'Torus Knot':
      return new THREE.TorusKnotGeometry(radius * 0.7, radius * 0.22, 220, 36);
    case 'Helix':
      return helixGeometry(radius);
    case 'Heart':
      return heartGeometry(radius);
    case 'MESHY': {
      const geo = new TextGeometry('MESHY', {
        font,
        size: radius * 0.7,
        depth: radius * 0.22,
        curveSegments: 6,
        bevelEnabled: false,
      });
      geo.center();
      return geo;
    }
    default:
      return null; // 'None'
  }
}

/**
 * Sample `count` points over the surface of the chosen shape (area-weighted) into
 * a tightly-packed x,y,z Float32Array, suitable for ParticleField.setMorphTarget.
 * Returns null for 'None'. Runs on the CPU — cheap for a few hundred thousand
 * points and only when the shape changes.
 */
export function generateMorphTarget(shape: MorphShape, count: number, radius: number): Float32Array | null {
  const geometry = geometryFor(shape, radius);
  if (!geometry) return null;

  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build();
  const data = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(p);
    data[i * 3] = p.x;
    data[i * 3 + 1] = p.y;
    data[i * 3 + 2] = p.z;
  }
  geometry.dispose();
  return data;
}
