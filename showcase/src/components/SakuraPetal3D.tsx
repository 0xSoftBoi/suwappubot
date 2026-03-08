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
   Glass shard geometry — flat triangular/quad fragments
   --------------------------------------------------------------- */

function createShardGeometry(seed: number) {
  const w = 0.3 + (seed % 5) * 0.15;
  const h = 0.4 + (seed % 7) * 0.12;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(w, h * 0.3);
  shape.lineTo(w * 0.7, h);
  shape.lineTo(-w * 0.2, h * 0.6);
  shape.closePath();

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.01,
    bevelEnabled: false,
  });
}

/* ---------------------------------------------------------------
   Petal scatter — petals + glass shards exploding outward
   --------------------------------------------------------------- */

function PetalScatter({ petalCount = 18, shardCount = 10 }: { petalCount?: number; shardCount?: number }) {
  const petalMeshRef = useRef<THREE.InstancedMesh>(null!);
  const shardMeshRef = useRef<THREE.InstancedMesh>(null!);
  const petalGeo = useMemo(() => createPetalGeometry(), []);
  const shardGeo = useMemo(() => createShardGeometry(3), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const progressRef = useContext(ScrollProgressCtx);

  const petals = useMemo(() => {
    return Array.from({ length: petalCount }, (_, i) => {
      const angle = (i / petalCount) * Math.PI * 2;
      const r = 0.5 + Math.random() * 0.5;
      return {
        // Start clustered near center
        ox: Math.cos(angle) * r * 0.3,
        oy: Math.sin(angle) * r * 0.3,
        oz: (Math.random() - 0.5) * 0.4,
        // Scatter direction
        dx: Math.cos(angle) * (1.5 + Math.random() * 2),
        dy: Math.sin(angle) * (1.5 + Math.random() * 1.5),
        dz: (Math.random() - 0.5) * 2,
        rx: Math.random() * Math.PI * 2,
        ry: Math.random() * Math.PI * 2,
        spinSpeed: 1 + Math.random() * 3,
        scale: 0.12 + Math.random() * 0.18,
        phase: Math.random() * Math.PI * 2,
      };
    });
  }, [petalCount]);

  const shards = useMemo(() => {
    return Array.from({ length: shardCount }, (_, i) => {
      const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.5;
      return {
        ox: Math.cos(angle) * 0.1,
        oy: Math.sin(angle) * 0.1,
        oz: 0,
        dx: Math.cos(angle) * (1 + Math.random() * 1.5),
        dy: Math.sin(angle) * (1 + Math.random() * 1.5),
        dz: (Math.random() - 0.5) * 1.5,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        spinSpeed: 0.5 + Math.random() * 2,
        scale: 0.15 + Math.random() * 0.25,
      };
    });
  }, [shardCount]);

  useFrame(() => {
    const raw = progressRef.current ?? 0;
    // Map to panel 3 range (roughly 0.33–0.66 of total scroll → 0–1 local)
    const local = Math.max(0, Math.min(1, (raw - 0.3) * 3));
    // Ease the scatter with a smooth curve
    const scatter = 1 - Math.pow(1 - local, 3);

    // Update petals
    petals.forEach((pt, i) => {
      const t = raw * pt.spinSpeed * 4 + pt.phase;
      dummy.position.set(
        pt.ox + pt.dx * scatter + Math.sin(t * 0.5) * 0.1 * scatter,
        pt.oy + pt.dy * scatter + Math.sin(t * 0.7) * 0.1 * scatter,
        pt.oz + pt.dz * scatter,
      );
      dummy.rotation.set(
        pt.rx + raw * pt.spinSpeed * 6,
        pt.ry + raw * pt.spinSpeed * 4,
        Math.sin(t) * 0.3,
      );
      dummy.scale.setScalar(pt.scale * (0.6 + scatter * 0.4));
      dummy.updateMatrix();
      petalMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    petalMeshRef.current.instanceMatrix.needsUpdate = true;

    // Update glass shards
    shards.forEach((sh, i) => {
      dummy.position.set(
        sh.ox + sh.dx * scatter,
        sh.oy + sh.dy * scatter,
        sh.oz + sh.dz * scatter,
      );
      dummy.rotation.set(
        sh.rx + raw * sh.spinSpeed * 3,
        sh.ry + raw * sh.spinSpeed * 2,
        raw * sh.spinSpeed,
      );
      // Shards fade out as they scatter
      dummy.scale.setScalar(sh.scale * (1 - scatter * 0.3));
      dummy.updateMatrix();
      shardMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    shardMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* Petals */}
      <instancedMesh ref={petalMeshRef} args={[petalGeo, undefined, petalCount]}>
        <meshPhysicalMaterial
          color="#ffb7c5"
          transmission={0.35}
          roughness={0.3}
          metalness={0.05}
          side={THREE.DoubleSide}
          transparent
          opacity={0.85}
        />
      </instancedMesh>

      {/* Glass shards */}
      <instancedMesh ref={shardMeshRef} args={[shardGeo, undefined, shardCount]}>
        <meshPhysicalMaterial
          color="#ffd1dc"
          transmission={0.15}
          roughness={0.2}
          metalness={0.3}
          side={THREE.DoubleSide}
          transparent
          opacity={0.25}
        />
      </instancedMesh>

      {/* Central point light for glass gleam */}
      <pointLight position={[0, 0, 1]} intensity={0.6} color="#ffe0ec" />
    </group>
  );
}

/* ---------------------------------------------------------------
   Exported scene wrapper
   --------------------------------------------------------------- */

interface SakuraPetal3DProps {
  variant: 'cluster' | 'shower' | 'scatter';
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

          {variant === 'cluster' && <PetalCluster />}
          {variant === 'shower' && <PetalShower count={25} />}
          {variant === 'scatter' && <PetalScatter />}

          <Environment preset="city" />
        </ScrollProgressCtx.Provider>
      </Canvas>
    </div>
  );
}
