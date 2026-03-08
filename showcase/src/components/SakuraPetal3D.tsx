'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Environment } from '@react-three/drei';
import * as THREE from 'three';

/* ---------------------------------------------------------------
   Petal geometry — teardrop/sakura shape via Shape + ExtrudeGeometry
   --------------------------------------------------------------- */

function createPetalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.5, 0.8, 0, 1.6);
  shape.quadraticCurveTo(-0.5, 0.8, 0, 0);

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 12,
  };

  return new THREE.ExtrudeGeometry(shape, extrudeSettings);
}

/* ---------------------------------------------------------------
   Single petal mesh — time-driven spin + float
   --------------------------------------------------------------- */

interface PetalMeshProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  speed?: number;
  color?: string;
}

function PetalMesh({
  position,
  rotation = [0, 0, 0],
  scale = 1,
  speed = 1,
  color = '#ffb7c5',
}: PetalMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => createPetalGeometry(), []);
  const initialRotation = useMemo(() => rotation, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime * speed;
    meshRef.current.rotation.x = initialRotation[0] + Math.sin(t * 0.5) * 0.3;
    meshRef.current.rotation.y = initialRotation[1] + t * 0.4;
    meshRef.current.rotation.z = initialRotation[2] + Math.cos(t * 0.3) * 0.2;
    meshRef.current.position.y = position[1] + Math.sin(t * 0.7) * 0.15;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={position}
      scale={scale}
    >
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
   Floating mini petals (particles)
   --------------------------------------------------------------- */

function FloatingPetals({ count = 12 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const geometry = useMemo(() => createPetalGeometry(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const petals = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 6,
      y: (Math.random() - 0.5) * 4,
      z: (Math.random() - 0.5) * 4,
      rx: Math.random() * Math.PI * 2,
      ry: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7,
      scale: 0.08 + Math.random() * 0.12,
    }));
  }, [count]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    petals.forEach((p, i) => {
      dummy.position.set(
        p.x + Math.sin(t * p.speed * 0.5) * 0.3,
        p.y + Math.sin(t * p.speed * 0.7 + i) * 0.4,
        p.z + Math.cos(t * p.speed * 0.3) * 0.2,
      );
      dummy.rotation.set(
        p.rx + t * p.speed * 0.3,
        p.ry + t * p.speed * 0.5,
        t * p.speed * 0.2,
      );
      dummy.scale.setScalar(p.scale);
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
   Petal cluster — hero composition
   --------------------------------------------------------------- */

function PetalCluster() {
  return (
    <group>
      {/* Main petals */}
      <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.5}>
        <PetalMesh position={[0, 0.3, 0]} scale={0.6} speed={0.8} color="#ffb7c5" />
      </Float>
      <Float speed={2} rotationIntensity={0.4} floatIntensity={0.6}>
        <PetalMesh position={[-0.8, -0.2, 0.3]} scale={0.45} speed={1.1} color="#ffd1dc" rotation={[0.5, 1.2, 0.3]} />
      </Float>
      <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.4}>
        <PetalMesh position={[0.7, -0.4, -0.2]} scale={0.5} speed={0.9} color="#f8a5c2" rotation={[1, 0.5, 0.8]} />
      </Float>
      <Float speed={1.8} rotationIntensity={0.35} floatIntensity={0.45}>
        <PetalMesh position={[0.3, 0.8, -0.4]} scale={0.35} speed={1.3} color="#ffb7c5" rotation={[0.3, 2, 0.6]} />
      </Float>
      <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.35}>
        <PetalMesh position={[-0.5, 0.6, 0.5]} scale={0.4} speed={1} color="#ffd1dc" rotation={[1.5, 0.8, 1.2]} />
      </Float>

      {/* Floating mini petals */}
      <FloatingPetals count={15} />
    </group>
  );
}

/* ---------------------------------------------------------------
   Petal shower — CTA panel composition
   --------------------------------------------------------------- */

function PetalShower({ count = 20 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const geometry = useMemo(() => createPetalGeometry(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

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

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    petals.forEach((p, i) => {
      const y = ((p.startY - t * p.fallSpeed) % 8) + 4;
      dummy.position.set(
        p.x + Math.sin(t * p.wobble + p.phase) * 0.5,
        y - 4,
        p.z + Math.cos(t * p.wobble * 0.7 + p.phase) * 0.3,
      );
      dummy.rotation.set(
        p.rx + t * p.fallSpeed * 2,
        p.ry + t * p.fallSpeed * 1.5,
        Math.sin(t + p.phase) * 0.5,
      );
      dummy.scale.setScalar(p.scale);
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
   Exported scene wrappers
   --------------------------------------------------------------- */

interface SakuraPetal3DProps {
  variant: 'cluster' | 'shower';
  className?: string;
}

export default function SakuraPetal3D({ variant, className = '' }: SakuraPetal3DProps) {
  return (
    <div className={`w-full h-full ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <pointLight position={[-3, 2, 2]} intensity={0.4} color="#ffb7c5" />

        {variant === 'cluster' ? <PetalCluster /> : <PetalShower count={25} />}

        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
