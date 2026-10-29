import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { buildRingRoad } from './scenery/ring';

/** The square ring road around the city: asphalt, slip roads, edge lines, clockwise chevrons and a perimeter wall. */
export function RingRoad() {
  const parts = useMemo(buildRingRoad, []);
  const arrows = useRef<THREE.InstancedMesh>(null);
  const chevron = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(1.6, 0);
    shape.lineTo(-1.0, 1.05);
    shape.lineTo(-0.3, 0);
    shape.lineTo(-1.0, -1.05);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  useLayoutEffect(() => {
    const mesh = arrows.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    parts.arrows.forEach((a, i) => {
      d.position.set(a.x, 0.045, -a.y);
      d.rotation.set(0, a.heading, 0);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.count = parts.arrows.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [parts]);

  return (
    <group name="ring-road">
      <mesh name="ring-asphalt" geometry={parts.asphalt} receiveShadow>
        <meshStandardMaterial color="#3a3f47" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh name="ring-lines" geometry={parts.lines} receiveShadow>
        <meshStandardMaterial color="#e8e8e2" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={arrows} name="ring-arrows" args={[chevron, undefined, Math.max(1, parts.arrows.length)]} frustumCulled={false} receiveShadow>
        <meshStandardMaterial color="#e8e8e2" roughness={0.9} side={THREE.DoubleSide} />
      </instancedMesh>
      <mesh name="ring-wall" geometry={parts.wall} castShadow receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={0.9} />
      </mesh>
    </group>
  );
}
