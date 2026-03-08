'use client';

import { useRef, useMemo, createContext, useContext } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

/* ---------------------------------------------------------------
   Scroll progress context — passed in from parent
   --------------------------------------------------------------- */

const ScrollProgressCtx = createContext<React.RefObject<number | null>>({ current: 0 });

/* ---------------------------------------------------------------
   Petal geometry — teardrop/sakura shape
   --------------------------------------------------------------- */

function createPetalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.5, 0.8, 0, 1.6);
  shape.quadraticCurveTo(-0.5, 0.8, 0, 0);

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 12,
  });
}

/* ---------------------------------------------------------------
   Single petal mesh — scroll-driven rotation + position
   --------------------------------------------------------------- */

interface PetalMeshProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  scrollMultiplier?: number;
  color?: string;
}

function PetalMesh({
  position,
  rotation = [0, 0, 0],
  scale = 1,
  scrollMultiplier = 1,
  color = '#ffb7c5',
}: PetalMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => createPetalGeometry(), []);
  const progressRef = useContext(ScrollProgressCtx);
  const initRot = useMemo(() => rotation, []);

  useFrame(() => {
    const p = (progressRef.current ?? 0) * scrollMultiplier;
    // Scroll drives rotation — full 360 over the page
    meshRef.current.rotation.x = initRot[0] + p * Math.PI * 2;
    meshRef.current.rotation.y = initRot[1] + p * Math.PI * 3;
    meshRef.current.rotation.z = initRot[2] + Math.sin(p * Math.PI * 4) * 0.4;
    // Gentle float tied to scroll
    meshRef.current.position.y = position[1] + Math.sin(p * Math.PI * 6) * 0.15;
  });

  return (
    <mesh ref={meshRef} geometry={geometry} position={position} scale={scale}>
      <meshPhysicalMaterial
        color={color}
        transmission={0.3}
        roughness={0.4}
        metalness={0.05}
        side={THREE.DoubleSide}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

/* ---------------------------------------------------------------
   Floating mini petals — scroll-driven instanced mesh
   --------------------------------------------------------------- */

function FloatingPetals({ count = 12 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const geometry = useMemo(() => createPetalGeometry(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const progressRef = useContext(ScrollProgressCtx);

  const petals = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 6,
      y: (Math.random() - 0.5) * 4,
      z: (Math.random() - 0.5) * 4,
      rx: Math.random() * Math.PI * 2,
      ry: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7,
      scale: 0.08 + Math.random() * 0.12,
      phase: Math.random() * Math.PI * 2,
    }));
  }, [count]);

  useFrame(() => {
    const p = progressRef.current ?? 0;
    petals.forEach((pt, i) => {
      const t = p * pt.speed * 10 + pt.phase;
      dummy.position.set(
        pt.x + Math.sin(t * 0.5) * 0.3,
        pt.y + Math.sin(t * 0.7 + i) * 0.4,
        pt.z + Math.cos(t * 0.3) * 0.2,
      );
      dummy.rotation.set(
        pt.rx + t * 0.3,
        pt.ry + t * 0.5,
        t * 0.2,
      );
      dummy.scale.setScalar(pt.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, count]}>
      <meshPhysicalMaterial
        color="#ffd1dc"
        transmission={0.2}
        roughness={0.5}
        metalness={0}
        side={THREE.DoubleSide}
        transparent
        opacity={0.6}
      />
    </instancedMesh>
  );
}

/* ---------------------------------------------------------------
   Petal cluster — hero composition (scroll-driven)
   --------------------------------------------------------------- */

function PetalCluster() {
  return (
    <group>
      <PetalMesh position={[0, 0.3, 0]} scale={0.6} scrollMultiplier={1} color="#ffb7c5" />
      <PetalMesh position={[-0.8, -0.2, 0.3]} scale={0.45} scrollMultiplier={1.3} color="#ffd1dc" rotation={[0.5, 1.2, 0.3]} />
      <PetalMesh position={[0.7, -0.4, -0.2]} scale={0.5} scrollMultiplier={0.8} color="#f8a5c2" rotation={[1, 0.5, 0.8]} />
      <PetalMesh position={[0.3, 0.8, -0.4]} scale={0.35} scrollMultiplier={1.5} color="#ffb7c5" rotation={[0.3, 2, 0.6]} />
      <PetalMesh position={[-0.5, 0.6, 0.5]} scale={0.4} scrollMultiplier={1.1} color="#ffd1dc" rotation={[1.5, 0.8, 1.2]} />
      <FloatingPetals count={15} />
    </group>
  );
}

/* ---------------------------------------------------------------
   Petal shower — CTA panel (scroll-driven falling)
   --------------------------------------------------------------- */

function PetalShower({ count = 20 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const geometry = useMemo(() => createPetalGeometry(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const progressRef = useContext(ScrollProgressCtx);

  const petals = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 8,
      startY: 3 + Math.random() * 3,
      z: (Math.random() - 0.5) * 4,
      rx: Math.random() * Math.PI * 2,
      ry: Math.random() * Math.PI * 2,
      fallSpeed: 0.3 + Math.random() * 0.5,
      wobble: 0.5 + Math.random() * 1.5,
      scale: 0.1 + Math.random() * 0.15,
      phase: Math.random() * Math.PI * 2,
    }));
  }, [count]);

  useFrame(() => {
    const p = progressRef.current ?? 0;
    petals.forEach((pt, i) => {
      // Scroll drives the fall — as you scroll deeper, petals fall more
      const fallAmount = p * pt.fallSpeed * 12;
      const y = ((pt.startY - fallAmount) % 8) + 4;
      const t = p * pt.wobble * 8 + pt.phase;
      dummy.position.set(
        pt.x + Math.sin(t) * 0.5,
        y - 4,
        pt.z + Math.cos(t * 0.7) * 0.3,
      );
      dummy.rotation.set(
        pt.rx + p * pt.fallSpeed * 8,
        pt.ry + p * pt.fallSpeed * 6,
        Math.sin(t) * 0.5,
      );
      dummy.scale.setScalar(pt.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, count]}>
      <meshPhysicalMaterial
        color="#ffb7c5"
        transmission={0.25}
        roughness={0.45}
        metalness={0.05}
        side={THREE.DoubleSide}
        transparent
        opacity={0.7}
      />
    </instancedMesh>
  );
}

/* ---------------------------------------------------------------
   Exported scene wrapper
   --------------------------------------------------------------- */

interface SakuraPetal3DProps {
  variant: 'cluster' | 'shower';
  className?: string;
  progressRef: React.RefObject<number | null>;
}

export default function SakuraPetal3D({ variant, className = '', progressRef }: SakuraPetal3DProps) {
  return (
    <div className={`w-full h-full ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ScrollProgressCtx.Provider value={progressRef}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={0.8} />
          <pointLight position={[-3, 2, 2]} intensity={0.4} color="#ffb7c5" />

          {variant === 'cluster' ? <PetalCluster /> : <PetalShower count={25} />}

          <Environment preset="city" />
        </ScrollProgressCtx.Provider>
      </Canvas>
    </div>
  );
}
