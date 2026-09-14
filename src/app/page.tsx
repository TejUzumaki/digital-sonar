'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, AudioLines, Copy, Power, Settings, Radar, ChevronDown, ChevronUp } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';

// Collapsible UI Panel (Retro-Futuristic)
function CollapsiblePanel({ title, icon, children, defaultOpen = true, positionClass }: { 
  title: string, icon: React.ReactNode, children: React.ReactNode, defaultOpen?: boolean, positionClass: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`absolute ${positionClass} w-72 z-10 pointer-events-auto`}>
      <motion.div 
        className="hud-panel hud-clip"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      >
        <button onClick={() => setIsOpen(!isOpen)} className="w-full p-4 flex justify-between items-center text-xs uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/10 transition-colors">
          <div className="flex items-center gap-2 neon-text">{icon} {title}</div>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="p-4 pt-0 text-gray-300">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// 3D Sonar Web Mesh Component (Now with 8 Octants)
function SonarWeb({ octantEnergiesRef }: { octantEnergiesRef: React.MutableRefObject<number[]> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const basePositions = useRef<Float32Array | null>(null);
  
  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(0.9, 4); 
    basePositions.current = new Float32Array(geo.attributes.position.array);
    return geo;
  }, []);

  useFrame(() => {
    if (!meshRef.current || !basePositions.current) return;
    
    const time = Date.now() * 0.001;
    const positions = meshRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    const pMat = pointsRef.current?.material as THREE.PointsMaterial;

    // Track which octants are active for global color shift
    let maxEnergy = 0;
    let activeOctants = 0;

    for (let i = 0; i < positions.count; i++) {
      const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;
      const bx = basePositions.current[ix];
      const by = basePositions.current[iy];
      const bz = basePositions.current[iz];

      // Determine which of the 8 octants this point belongs to
      const xBit = bx > 0 ? 4 : 0;
      const yBit = by > 0 ? 2 : 0;
      const zBit = bz > 0 ? 1 : 0;
      const octant = xBit | yBit | zBit; // 0 to 7

      const dist = octantEnergiesRef.current[octant];
      if (dist > maxEnergy) maxEnergy = dist;
      if (dist > 5) activeOctants++;

      // Shatter effect localized to the octant
      const noise = Math.sin(time * 4 + bx * 15) * Math.cos(time * 4 + by * 15) * Math.sin(time * 4 + bz * 15);
      const displacement = 1 + (dist * 0.02) + (dist * noise * 0.04);

      arr[ix] = bx * displacement;
      arr[iy] = by * displacement;
      arr[iz] = bz * displacement;
    }
    positions.needsUpdate = true;

    // Global color blending based on overall activity
    const targetColor = maxEnergy > 20 ? new THREE.Color(0xef4444) : new THREE.Color(0x00f3ff);
    mat.color.lerp(targetColor, 0.05);
    if (pMat) pMat.color.lerp(targetColor, 0.05);
  });

  return (
    <group>
      {/* The Tablet Device */}
      <mesh rotation={[0, 0, 0]}>
        <boxGeometry args={[0.6, 0.03, 0.35]} /> 
        <meshStandardMaterial color="#0a1a1a" emissive="#00f3ff" emissiveIntensity={0.2} wireframe />
      </mesh>

      <mesh ref={meshRef} geometry={geometry}>
        <meshBasicMaterial wireframe transparent opacity={0.2} color="#00f3ff" />
      </mesh>
      
      <points ref={pointsRef} geometry={geometry}>
        <pointsMaterial size={0.035} color="#00f3ff" sizeAttenuation transparent opacity={0.9} />
      </points>

      <Text position={[0, 1.1, 0]} fontSize={0.08} color="#00f3ff" anchorX="center">UP</Text>
      <Text position={[0, -1.1, 0]} fontSize={0.08} color="#00f3ff" anchorX="center">DOWN</Text>
      <Text position={[0, 0, 1.1]} fontSize={0.08} color="#ff00ff" anchorX="center">FRONT</Text>
      <Text position={[0, 0, -1.1]} fontSize={0.08} color="#ff00ff" anchorX="center">BACK</Text>
      <Text position={[1.1, 0, 0]} fontSize={0.08} color="#ff00ff" anchorX="center">RIGHT</Text>
      <Text position={[-1.1, 0, 0]} fontSize={0.08} color="#ff00ff" anchorX="center">LEFT</Text>
    </group>
  );
}

export default function Home() {
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [volume, setVolume] = useState(0.15);
  const [logs, setLogs] = useState<string[]>([]);
  const [motionState, setMotionState] = useState<'SCANNING' | 'MOTION'>('SCANNING');
  const [activeOctants, setActiveOctants] = useState<number>(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // 8-Octant Math Refs
  const octantEnergiesRef = useRef<number[]>(new Array(8).fill(0));
  const rollingBaselinesRef = useRef<number[]>(new Array(8).fill(0));
  const lastLogTimeRef = useRef(0);
  
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
    
    // Divide the 200Hz window into 8 chunks of 25Hz each
    const totalBins = Math.floor(200 / binWidth);
    const binsPerOctant = Math.floor(totalBins / 8);
    const startBin = baseBin - Math.floor(totalBins / 2);

    let currentEnergies = new Array(8).fill(0);
    let totalActive = 0;
    let maxEnergy = 0;

    for (let oct = 0; oct < 8; oct++) {
      let energy = 0;
      const octStart = startBin + (oct * binsPerOctant);
      
      for (let i = 0; i < binsPerOctant; i++) {
        const bin = octStart + i;
        if (bin > 0 && bin < dataArray.length) {
          energy += dataArray[bin];
        }
      }

      // Rolling baseline per octant
      rollingBaselinesRef.current[oct] = (rollingBaselinesRef.current[oct] * 0.96) + (energy * 0.04);
      const dynEnergy = Math.max(0, energy - rollingBaselinesRef.current[oct]);
      
      currentEnergies[oct] = dynEnergy;
      octantEnergiesRef.current[oct] = dynEnergy;

      if (dynEnergy > 15) totalActive++;
      if (dynEnergy > maxEnergy) maxEnergy = dynEnergy;
    }

    // Update UI state (throttled)
    const now = Date.now();
    if (now - lastLogTimeRef.current > 300) {
      if (maxEnergy > 20 && motionState !== 'MOTION') {
        setMotionState('MOTION');
        const activeIdxs = currentEnergies.map((e, i) => e > 15 ? i : -1).filter(i => i !== -1);
        addLog(`MOTION DETECTED | Octants: [${activeIdxs.join(',')}] | Peak Energy: ${maxEnergy.toFixed(0)}`);
        lastLogTimeRef.current = now;
      } else if (maxEnergy <= 20 && motionState !== 'SCANNING') {
        setMotionState('SCANNING');
        lastLogTimeRef.current = now;
      }
      setActiveOctants(totalActive);
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const startSonar = async () => {
    try {
      setLogs([]);
      addLog("System: Initializing 8-Octant Array...");
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

      addLog("System: Calibrating spatial noise floor...");
      setTimeout(() => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        // Seed initial baselines
        const sampleRate = context.sampleRate;
        const binWidth = sampleRate / analyser.fftSize;
        const baseBin = Math.floor(19000 / binWidth);
        const totalBins = Math.floor(200 / binWidth);
        const binsPerOctant = Math.floor(totalBins / 8);
        const startBin = baseBin - Math.floor(totalBins / 2);

        for (let oct = 0; oct < 8; oct++) {
          let e = 0;
          for (let i = 0; i < binsPerOctant; i++) {
            const bin = startBin + (oct * binsPerOctant) + i;
            if (bin > 0 && bin < dataArrayRef.current.length) e += dataArrayRef.current[bin];
          }
          rollingBaselinesRef.current[oct] = e;
        }
        
        addLog(`System: Calibration complete. 8 Spatial sectors locked.`);
        setIsCalibrating(false);
        setIsSonarActive(true);
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
    octantEnergiesRef.current = new Array(8).fill(0);
    setMotionState('SCANNING');
    addLog("System: Sonar deactivated.");
  };

  useEffect(() => {
    if (gainRef.current && audioContextRef.current) {
      gainRef.current.gain.setValueAtTime(volume, audioContextRef.current.currentTime);
    }
  }, [volume]);

  useEffect(() => () => stopSonar(), []);

  return (
    <main className="relative min-h-screen bg-[#03050a] text-white font-mono overflow-hidden">
      
      <div className="fixed inset-0 z-0">
        <Canvas camera={{ position: [0, 1.5, 2.5], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <SonarWeb octantEnergiesRef={octantEnergiesRef} />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} />
        </Canvas>
      </div>

      <div className="atmosphere"></div>

      <div className="fixed inset-0 z-10 pointer-events-none p-4 sm:p-6">
        
        <CollapsiblePanel title="Spatial Telemetry" icon={<Activity size={16} />} positionClass="top-4 left-4 sm:top-6 sm:left-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Active Octants</span>
              <span className="text-cyan-300 font-bold neon-text">{activeOctants} / 8</span>
            </div>
            <div className="grid grid-cols-4 gap-1 mt-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-6 bg-gray-800/50 border border-cyan-500/20 flex items-center justify-center text-[10px] text-gray-600">
                  {(octantEnergiesRef.current[i] > 15) ? 
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-full h-full bg-cyan-500/40 flex items-center justify-center text-cyan-100">O{i+1}</motion.div> 
                    : `O${i+1}`}
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-gray-800">
              <span className="text-xs text-gray-500">Status</span>
              <span className={`text-sm font-bold neon-text ${motionState === 'MOTION' ? 'text-red-400' : 'text-cyan-400'}`}>{motionState}</span>
            </div>
          </div>
        </CollapsiblePanel>

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
              <button onClick={startSonar} className="hud-clip-sm w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-2 transition-all text-sm">
                <Power size={16} /> ACTIVATE
              </button>
            ) : isCalibrating ? (
              <button disabled className="hud-clip-sm w-full flex items-center justify-center gap-2 bg-yellow-500/20 text-yellow-400 font-bold py-2 cursor-wait text-sm">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                  <Activity size={16} />
                </motion.div> CALIBRATING...
              </button>
            ) : (
              <button onClick={stopSonar} className="hud-clip-sm w-full flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-500 text-white font-bold py-2 transition-all text-sm">
                <Power size={16} /> DEACTIVATE
              </button>
            )}
          </div>
        </CollapsiblePanel>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} className="inline-block mb-2">
            <Radar className="text-cyan-400/80 neon-text" size={32} />
          </motion.div>
          <AnimatePresence mode="wait">
            <motion.div
              key={motionState}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`text-3xl font-bold tracking-widest neon-text ${motionState === 'MOTION' ? 'text-red-400' : 'text-cyan-400'}`}
            >
              {motionState === 'MOTION' ? 'SPATIAL MOTION' : 'SCANNING'}
            </motion.div>
          </AnimatePresence>
        </div>

        <CollapsiblePanel title="System Logs" icon={<Activity size={16} />} positionClass="bottom-4 right-4 sm:bottom-6 sm:right-6" defaultOpen={false}>
          <div className="flex flex-col gap-2">
            <button onClick={copyLogs} className="hud-clip-sm text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 px-3 py-1 flex items-center gap-1 transition-colors w-full justify-center">
              <Copy size={12} /> COPY LOGS
            </button>
            <div className="h-48 overflow-y-auto p-2 space-y-1 text-xs bg-black/30">
              {logs.length === 0 ? (
                <p className="text-gray-600 italic text-center mt-4">Awaiting activation...</p>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`font-mono ${log.includes('MOTION') ? 'text-red-300' : log.includes('ERROR') ? 'text-red-500' : log.includes('Calibration') ? 'text-yellow-300' : 'text-gray-500'}`}>
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
