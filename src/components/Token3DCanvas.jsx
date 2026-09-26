import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';

export function Token3DCanvas() {
  const mountRef = useRef(null);
  const selectedToken = useAppStore((s) => s.selectedToken);
  const active3DMode = useAppStore((s) => s.active3DMode);
  const isForging = useAppStore((s) => s.isForging);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 320;
    const height = mount.clientHeight || 260;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 4.8;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // Group for the token coin
    const tokenGroup = new THREE.Group();
    scene.add(tokenGroup);

    // Coin geometry: cylinder with beveled look
    const coinGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.22, 48);
    const ringGeo = new THREE.TorusGeometry(1.48, 0.05, 16, 64);
    const innerRingGeo = new THREE.TorusGeometry(1.15, 0.03, 16, 64);

    // Dynamic material based on color
    const tokenColor = new THREE.Color(selectedToken.color || '#00f0ff');
    const coinMat = new THREE.MeshStandardMaterial({
      color: tokenColor,
      metalness: 0.85,
      roughness: 0.2,
      wireframe: active3DMode === 'wireframe'
    });

    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.9,
      roughness: 0.1,
      emissive: tokenColor,
      emissiveIntensity: 0.3
    });

    const coinMesh = new THREE.Mesh(coinGeo, coinMat);
    coinMesh.rotation.x = Math.PI / 2;
    tokenGroup.add(coinMesh);

    const outerRing = new THREE.Mesh(ringGeo, edgeMat);
    tokenGroup.add(outerRing);

    const innerRing = new THREE.Mesh(innerRingGeo, edgeMat);
    tokenGroup.add(innerRing);

    // Particle field / holo grid around coin
    const particleCount = 120;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 6;
      positions[i + 1] = (Math.random() - 0.5) * 6;
      positions[i + 2] = (Math.random() - 0.5) * 4;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: tokenColor,
      size: 0.04,
      transparent: true,
      opacity: 0.7
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 2.0);
    dirLight1.position.set(5, 5, 4);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x00ff88, 1.8);
    dirLight2.position.set(-5, -5, 2);
    scene.add(dirLight2);

    const pointLight = new THREE.PointLight(0xffffff, 1.5, 10);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);

    // Animation loop
    let reqId;
    let clock = new THREE.Clock();

    const animate = () => {
      reqId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      const spinSpeed = isForging ? 0.08 : 0.015;
      tokenGroup.rotation.y += spinSpeed;
      tokenGroup.rotation.x = Math.sin(elapsed * 0.8) * 0.25 + 0.15;
      tokenGroup.position.y = Math.sin(elapsed * 1.5) * 0.1;

      particles.rotation.y -= 0.003;
      particles.rotation.x += 0.001;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener('resize', handleResize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [selectedToken, active3DMode, isForging]);

  return (
    <div className="relative w-full h-56 flex items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-cyan-950/20 via-black/40 to-slate-950/60 border border-cyan-500/20">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      
      {/* Overlay Badge */}
      <div className="absolute top-2 left-2 text-[10px] font-mono text-cyan-400 bg-black/60 px-2 py-0.5 rounded border border-cyan-500/30">
        3D MESH // {selectedToken.symbol}
      </div>

      <div className="absolute bottom-2 right-2 flex space-x-1">
        {['standard', 'wireframe'].map((mode) => (
          <button
            key={mode}
            onClick={() => useAppStore.getState().set3DMode(mode)}
            className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase border ${
              active3DMode === mode
                ? 'bg-cyan-500/30 border-cyan-400 text-cyan-300'
                : 'bg-black/50 border-slate-800 text-slate-500'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>
  );
}
