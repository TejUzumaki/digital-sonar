'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, AudioLines, Copy, Power, Settings, Radar, ChevronDown, ChevronUp } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';

// Reusable Collapsible UI Panel
function CollapsiblePanel({ title, icon, children, defaultOpen = true, positionClass }: { 
  title: string, 
  icon: React.ReactNode, 
  children: React.ReactNode, 
  defaultOpen?: boolean,
  positionClass: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`absolute ${positionClass} w-72 z-10 pointer-events-auto`}>
      <motion.div 
        className="bg-gray-900/40 backdrop-blur-md border border-cyan-500/20 rounded-xl overflow-hidden shadow-2xl"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      >
        <button onClick={() => setIsOpen(!isOpen)} className="w-full p-4 flex justify-between items-center text-xs uppercase tracking-wider text-gray-400 hover:bg-cyan-500/10 transition-colors">
          <div className="flex items-center gap-2">{icon} {title}</div>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 pt-0">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// 3D Sonar Web Mesh Component
function SonarWeb({ disturbanceRef, directionRef }: { disturbanceRef: React.MutableRefObject<number>, directionRef: React.MutableRefObject<'SCANNING' | 'INBOUND' | 'OUTBOUND'> }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const basePositions = useRef<Float32Array>();
  
  // Generate a high-poly Icosahedron to act as our web/dot structure
  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(0.9, 4); // 0.9 radius = ~30cm
    // Clone original positions for displacement math
    basePositions.current = new Float32Array(geo.attributes.position.array);
    return geo;
  }, []);

  // Animate the web shattering and churning
  useFrame(() => {
    if (!meshRef.current || !basePositions.current) return;
    
    const dist = disturbanceRef.current;
    const dir = directionRef.current;
    const time = Date.now() * 0.001;
    
    const positions = meshRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;

    for (let i = 0; i < positions.count; i++) {
      const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;
      const bx = basePositions.current[ix];
      const by = basePositions.current[iy];
      const bz = basePositions.current[iz];

      // Noise-based shatter effect
      const noise = Math.sin(time * 2 + bx * 10) * Math.cos(time * 2 + by * 10) * Math.sin(time * 2 + bz * 10);
      
      // Direction of displacement (push outward if inbound, pull in if outbound)
      const dirMod = dir === 'INBOUND' ? 1 : dir === 'OUTBOUND' ? -0.5 : 0;
      const displacement = 1 + (dist * 0.005 * dirMod) + (dist * noise * 0.015);

      arr[ix] = bx * displacement;
      arr[iy] = by * displacement;
      arr[iz] = bz * displacement;
    }
    positions.needsUpdate = true;

    // Color transition
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    const pointsMaterial = pointsRef.current?.material as THREE.PointsMaterial;
    
    const targetColor = dir === 'INBOUND' ? new THREE.Color(0xef4444) : 
                        dir === 'OUTBOUND' ? new THREE.Color(0x22c55e) : 
                        new THREE.Color(0x22d3ee);
                        
    material.color.lerp(targetColor, 0.05);
    if (pointsMaterial) pointsMaterial.color.lerp(targetColor, 0.05);
  });

  return (
    <group ref={groupRef}>
      {/* The Tablet Device */}
      <mesh rotation={[0, 0, 0]}>
        <boxGeometry args={[0.6, 0.03, 0.35]} /> 
        <meshStandardMaterial color="darkgreen" emissive="green" emissiveIntensity={0.3} />
      </mesh>

      {/* Inner Web Shell */}
      <mesh ref={meshRef} geometry={geometry}>
        <meshBasicMaterial wireframe transparent opacity={0.15} color="cyan" />
      </mesh>
      
      {/* The Dots (Points) overlaying the wireframe */}
      <points ref={pointsRef} geometry={geometry}>
        <pointsMaterial size={0.03} color="cyan" sizeAttenuation transparent opacity={0.9} />
      </points>

      {/* Spatial Labels */}
      <Text position={[0, 1.1, 0]} fontSize={0.1} color="white" anchorX="center">UP</Text>
      <Text position={[0, -1.1, 0]} fontSize={0.1} color="white" anchorX="center">DOWN</Text>
      <Text position={[0, 0, 1.1]} fontSize={0.1} color="gray" anchorX="center">FRONT</Text>
      <Text position={[0, 0, -1.1]} fontSize={0.1} color="gray" anchorX="center">BACK</Text>
      <Text position={[1.1, 0, 0]} fontSize={0.1} color="gray" anchorX="center">RIGHT</Text>
      <Text position={[-1.1, 0, 0]} fontSize={0.1} color="gray" anchorX="center">LEFT</Text>
    </group>
  );
}

export default function Home() {
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [volume, setVolume] = useState(0.15);
  const [energyLevel, setEnergyLevel] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [motionState, setMotionState] = useState<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const motionStateRef = useRef<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');
  const baselineEnergyRef = useRef(0);
  const lastLogTimeRef = useRef(0);
  
  // Refs to pass to 3D engine
  const disturbanceRef = useRef(0);
  const directionRef = useRef<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]);
  }, []);

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    addLog("System: Logs copied to clipboard.");
  };

  const analyzeAudio = () => {
    if (!analyserRef.current || !dataArrayRef.current || !audioContextRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const sampleRate = audioContextRef.current.sampleRate;
    const fftSize = analyser.fftSize;
    
    analyser.getByteFrequencyData(dataArray);

    const baseFreq = 19000;
    const binWidth = sampleRate / fftSize;
    const baseBin = Math.floor(baseFreq / binWidth);
    const range = Math.floor(100 / binWidth); 

    let awayEnergy = 0;
    let towardEnergy = 0;

    for (let i = baseBin - range; i < baseBin - 5; i++) {
      if (i > 0) awayEnergy += dataArray[i];
    }
    for (let i = baseBin + 5; i < baseBin + range; i++) {
      if (i < dataArray.length) towardEnergy += dataArray[i];
    }

    const totalEnergy = towardEnergy + awayEnergy;
    const adjustedEnergy = Math.max(0, totalEnergy - baselineEnergyRef.current);
    
    disturbanceRef.current = adjustedEnergy;
    setEnergyLevel(adjustedEnergy);

    const direction = towardEnergy - awayEnergy;
    let currentState = motionStateRef.current;
    const now = Date.now();

    if (adjustedEnergy > 40) {
      if (direction > 10 && currentState !== 'INBOUND' && now - lastLogTimeRef.current > 300) {
        currentState = 'INBOUND';
        motionStateRef.current = currentState;
        directionRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION INBOUND | Energy: ${adjustedEnergy.toFixed(0)} | Delta: +${direction.toFixed(0)}`);
      } else if (direction < -10 && currentState !== 'OUTBOUND' && now - lastLogTimeRef.current > 300) {
        currentState = 'OUTBOUND';
        motionStateRef.current = currentState;
        directionRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION OUTBOUND | Energy: ${adjustedEnergy.toFixed(0)} | Delta: ${direction.toFixed(0)}`);
      }
    } else {
      if (currentState !== 'SCANNING' && now - lastLogTimeRef.current > 500) {
        currentState = 'SCANNING';
        motionStateRef.current = currentState;
        directionRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`SECTOR CLEAR | Baseline restored.`);
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const startSonar = async () => {
    try {
      setLogs([]);
      addLog("System: Initializing 3D Spatial Array...");
      setIsCalibrating(true);
      
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (context.state === 'suspended') await context.resume();
      audioContextRef.current = context;

      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(19000, context.currentTime);
      const gainNode = context.createGain();
      gainNode.gain.setValueAtTime(volume, context.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start();
      oscillatorRef.current = oscillator;
      gainRef.current = gainNode;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false }
      });
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 32768;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      addLog("System: Calibrating noise floor...");
      setTimeout(() => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        const binWidth = context.sampleRate / analyser.fftSize;
        const baseBin = Math.floor(19000 / binWidth);
        const range = Math.floor(100 / binWidth);
        
        let totalE = 0;
        for (let i = baseBin - range; i < baseBin - 5; i++) if (i > 0) totalE += dataArrayRef.current[i];
        for (let i = baseBin + 5; i < baseBin + range; i++) if (i < dataArrayRef.current.length) totalE += dataArrayRef.current[i];
        
        baselineEnergyRef.current = totalE * 1.2;
        addLog(`System: Calibration complete. Baseline: ${baselineEnergyRef.current.toFixed(0)}.`);
        setIsCalibrating(false);
        setIsSonarActive(true);
        motionStateRef.current = 'SCANNING';
        directionRef.current = 'SCANNING';
        analyzeAudio();
      }, 2000);

    } catch (err) {
      addLog("System: FATAL ERROR - Initialization failed.");
    }
  };

  const stopSonar = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (oscillatorRef.current) oscillatorRef.current.stop();
    if (audioContextRef.current) audioContextRef.current.close();
    oscillatorRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
    setIsSonarActive(false);
    setIsCalibrating(false);
    setEnergyLevel(0);
    disturbanceRef.current = 0;
    directionRef.current = 'SCANNING';
    motionStateRef.current = 'SCANNING';
    addLog("System: Sonar deactivated.");
  };

  useEffect(() => {
    if (gainRef.current && audioContextRef.current) {
      gainRef.current.gain.setValueAtTime(volume, audioContextRef.current.currentTime);
    }
  }, [volume]);

  useEffect(() => () => stopSonar(), []);

  return (
    <main className="relative min-h-screen bg-[#05070a] text-white font-mono overflow-hidden">
      
      {/* 3D Background Canvas - Fixed to viewport */}
      <div className="fixed inset-0 z-0">
        <Canvas camera={{ position: [0, 1.5, 2.5], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <SonarWeb disturbanceRef={disturbanceRef} directionRef={directionRef} />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} />
        </Canvas>
      </div>

      {/* Floating UI Overlay Layer */}
      <div className="fixed inset-0 z-10 pointer-events-none p-4 sm:p-6">
        
        {/* Top Left: Telemetry */}
        <CollapsiblePanel title="Telemetry" icon={<Activity size={16} />} positionClass="top-4 left-4 sm:top-6 sm:left-6">
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">Energy</span>
                <span className="text-cyan-300 font-bold">{energyLevel.toFixed(0)}</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-green-500 to-red-500" animate={{ width: `${Math.min(100, energyLevel)}%` }} />
              </div>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-gray-800">
              <span className="text-xs text-gray-500">Status</span>
              <span className={`text-sm font-bold ${
                motionState === 'INBOUND' ? 'text-red-400' : motionState === 'OUTBOUND' ? 'text-green-400' : 'text-cyan-400'
              }`}>{motionState}</span>
            </div>
          </div>
        </CollapsiblePanel>

        {/* Top Right: Controls */}
        <CollapsiblePanel title="Controls" icon={<Settings size={16} />} positionClass="top-4 right-4 sm:top-6 sm:right-6" defaultOpen={false}>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-500 flex items-center gap-1"><AudioLines size={12} /> Emitter</span>
                <span className="text-cyan-300">{Math.round(volume * 100)}%</span>
              </div>
              <input type="range" min="0" max="0.3" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
            </div>
            {!isSonarActive && !isCalibrating ? (
              <button onClick={startSonar} className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-2 rounded-lg transition-all text-sm">
                <Power size={16} /> ACTIVATE
              </button>
            ) : isCalibrating ? (
              <button disabled className="w-full flex items-center justify-center gap-2 bg-yellow-500/20 text-yellow-400 font-bold py-2 rounded-lg cursor-wait text-sm">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                  <Activity size={16} />
                </motion.div> CALIBRATING...
              </button>
            ) : (
              <button onClick={stopSonar} className="w-full flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-500 text-white font-bold py-2 rounded-lg transition-all text-sm">
                <Power size={16} /> DEACTIVATE
              </button>
            )}
          </div>
        </CollapsiblePanel>

        {/* Bottom Center: Main Status (Non-collapsible) */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} className="inline-block mb-2">
            <Radar className="text-cyan-400/80" size={32} />
          </motion.div>
          <AnimatePresence mode="wait">
            <motion.div
              key={motionState}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`text-3xl font-bold tracking-widest ${
                motionState === 'INBOUND' ? 'text-red-400' : motionState === 'OUTBOUND' ? 'text-green-400' : 'text-cyan-400'
              }`}
            >
              {motionState === 'INBOUND' ? 'TARGET INBOUND' : motionState === 'OUTBOUND' ? 'TARGET OUTBOUND' : 'SCANNING'}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom Right: Logs */}
        <CollapsiblePanel title="System Logs" icon={<Activity size={16} />} positionClass="bottom-4 right-4 sm:bottom-6 sm:right-6" defaultOpen={false}>
          <div className="flex flex-col gap-2">
            <button onClick={copyLogs} className="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded flex items-center gap-1 transition-colors w-full justify-center">
              <Copy size={12} /> COPY LOGS
            </button>
            <div className="h-48 overflow-y-auto p-2 space-y-1 text-xs bg-black/30 rounded-lg">
              {logs.length === 0 ? (
                <p className="text-gray-600 italic text-center mt-4">Awaiting activation...</p>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`font-mono ${
                    log.includes('MOTION') ? 'text-red-300' : 
                    log.includes('OUTBOUND') ? 'text-green-300' : 
                    log.includes('ERROR') ? 'text-red-500' : 
                    log.includes('Calibration') || log.includes('Baseline') ? 'text-yellow-300' :
                    'text-gray-500'
                  }`}>
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </CollapsiblePanel>

      </div>
    </main>
  );
}
