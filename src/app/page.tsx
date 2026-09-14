'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, AudioLines, Copy, Power, Settings, Radar } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// 3D Sonar Sphere Component
function SonarSphere({ disturbanceRef }: { disturbanceRef: React.MutableRefObject<number> }) {
  const pointsRef = useRef<THREE.Points>(null);
  const colorsRef = useRef<THREE.Float32BufferAttribute>(null);

  // Generate equidistant dots using Fibonacci sphere algorithm
  const { positions, colors } = useMemo(() => {
    const N = 150; // Number of dots
    const radius = 3; // Represents 100cm
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const phi = Math.PI * (Math.sqrt(5) - 1); // golden angle

    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2; // y goes from 1 to -1
      const r = Math.sqrt(1 - y * y);
      const theta = phi * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      
      pos[i * 3] = x * radius;
      pos[i * 3 + 1] = y * radius;
      pos[i * 3 + 2] = z * radius;

      // Initial color: Green
      col[i * 3] = 0.1;
      col[i * 3 + 1] = 1.0;
      col[i * 3 + 2] = 0.2;
    }
    return { positions: pos, colors: col };
  }, []);

  // Animate the dots based on disturbance
  useFrame(() => {
    if (!pointsRef.current) return;
    
    const disturbance = disturbanceRef.current;
    const geometry = pointsRef.current.geometry;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = geometry.attributes.color as THREE.BufferAttribute;

    // Target colors
    const green = new THREE.Color(0.1, 1.0, 0.2);
    const red = new THREE.Color(1.0, 0.1, 0.1);

    for (let i = 0; i < posAttr.count; i++) {
      const baseX = positions[i * 3];
      const baseY = positions[i * 3 + 1];
      const baseZ = positions[i * 3 + 2];
      
      // Displace dots outward based on disturbance
      // Add a little randomness so they don't move uniformly
      const noise = Math.sin(Date.now() * 0.001 + i) * 0.1;
      const displace = 1 + (disturbance * 0.3) + (disturbance * noise);
      
      posAttr.array[i * 3] = baseX * displace;
      posAttr.array[i * 3 + 1] = baseY * displace;
      posAttr.array[i * 3 + 2] = baseZ * displace;

      // Lerp color from green to red
      const targetColor = green.clone().lerp(red, Math.min(1, disturbance / 50));
      colAttr.array[i * 3] = targetColor.r;
      colAttr.array[i * 3 + 1] = targetColor.g;
      colAttr.array[i * 3 + 2] = targetColor.b;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute ref={colorsRef} attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.1} vertexColors={true} sizeAttenuation={true} />
    </points>
  );
}

// 3D Tablet Component
function TabletModel() {
  return (
    <mesh rotation={[0, 0, 0]}>
      <boxGeometry args={[1.5, 0.1, 0.8]} /> {/* Horizontal flat cuboid */}
      <meshStandardMaterial color="darkgreen" emissive="green" emissiveIntensity={0.3} />
    </mesh>
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
  
  // Ref to pass audio data to 3D engine without re-rendering
  const disturbanceRef = useRef(0);

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

    // Sum energy in side bands (ignoring the exact peak)
    for (let i = baseBin - range; i < baseBin - 5; i++) {
      if (i > 0) awayEnergy += dataArray[i];
    }
    for (let i = baseBin + 5; i < baseBin + range; i++) {
      if (i < dataArray.length) towardEnergy += dataArray[i];
    }

    const totalEnergy = towardEnergy + awayEnergy;
    const adjustedEnergy = Math.max(0, totalEnergy - baselineEnergyRef.current);
    
    // Pass to 3D engine
    disturbanceRef.current = adjustedEnergy;
    setEnergyLevel(adjustedEnergy);

    // Determine direction
    const direction = towardEnergy - awayEnergy;
    let currentState = motionStateRef.current;
    const now = Date.now();

    if (adjustedEnergy > 40) {
      if (direction > 10 && currentState !== 'INBOUND' && now - lastLogTimeRef.current > 300) {
        currentState = 'INBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION INBOUND | Energy: ${adjustedEnergy.toFixed(0)} | Delta: +${direction.toFixed(0)}`);
      } else if (direction < -10 && currentState !== 'OUTBOUND' && now - lastLogTimeRef.current > 300) {
        currentState = 'OUTBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION OUTBOUND | Energy: ${adjustedEnergy.toFixed(0)} | Delta: ${direction.toFixed(0)}`);
      }
    } else {
      if (currentState !== 'SCANNING' && now - lastLogTimeRef.current > 500) {
        currentState = 'SCANNING';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`SECTOR CLEAR | Energy baseline restored.`);
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const startSonar = async () => {
    try {
      setLogs([]);
      addLog("System: Initializing 3D Sonar Array...");
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

      addLog("System: Calibrating ambient noise floor...");
      setTimeout(() => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        const binWidth = context.sampleRate / analyser.fftSize;
        const baseBin = Math.floor(19000 / binWidth);
        const range = Math.floor(100 / binWidth);
        
        let totalE = 0;
        for (let i = baseBin - range; i < baseBin - 5; i++) if (i > 0) totalE += dataArrayRef.current[i];
        for (let i = baseBin + 5; i < baseBin + range; i++) if (i < dataArrayRef.current.length) totalE += dataArrayRef.current[i];
        
        baselineEnergyRef.current = totalE * 1.2; // Add 20% margin
        addLog(`System: Calibration complete. Baseline locked at ${baselineEnergyRef.current.toFixed(0)}.`);
        setIsCalibrating(false);
        setIsSonarActive(true);
        motionStateRef.current = 'SCANNING';
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
    <main className="min-h-screen bg-[#05070a] text-white flex flex-col items-center justify-start p-4 sm:p-8 font-mono overflow-hidden">
      
      <motion.div 
        className="fixed inset-0 bg-[linear-gradient(to_right,#0a0f1a_1px,transparent_1px),linear-gradient(to_bottom,#0a0f1a_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"
        animate={{ backgroundPosition: ["0px 0px", "40px 40px"] }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />

      <header className="z-10 flex justify-between items-center w-full max-w-6xl mb-8">
        <div className="flex items-center gap-3">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }}>
            <Radar className="text-cyan-400" size={32} />
          </motion.div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-400 tracking-widest">DIGITAL SONAR</h1>
            <p className="text-gray-600 text-xs tracking-wide">3D SPATIAL ARRAY v4.0</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-gray-900/50 border border-cyan-500/20 px-4 py-2 rounded-lg">
          <div className={`w-2 h-2 rounded-full ${isSonarActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          <span className="text-xs text-gray-400">{isCalibrating ? 'CALIBRATING' : isSonarActive ? 'ACTIVE' : 'OFFLINE'}</span>
        </div>
      </header>

      <div className="z-10 grid grid-cols-1 lg:grid-cols-3 gap-6 w-full max-w-6xl">
        
        {/* Left Column: Telemetry */}
        <div className="flex flex-col gap-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="bg-gray-900/40 backdrop-blur-md border border-cyan-500/20 rounded-xl p-6"
          >
            <div className="flex items-center gap-2 mb-4 text-gray-400 text-xs uppercase tracking-wider">
              <Activity size={16} /> Telemetry
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Disturbance Energy</span>
                  <span className="text-cyan-300 font-bold">{energyLevel.toFixed(0)}</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-green-500 to-red-500"
                    animate={{ width: `${Math.min(100, energyLevel)}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                <span className="text-xs text-gray-500">Status</span>
                <span className={`text-sm font-bold ${
                  motionState === 'INBOUND' ? 'text-red-400' : motionState === 'OUTBOUND' ? 'text-green-400' : 'text-cyan-400'
                }`}>{motionState}</span>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-gray-900/40 backdrop-blur-md border border-cyan-500/20 rounded-xl p-6"
          >
            <div className="flex items-center gap-2 mb-4 text-gray-400 text-xs uppercase tracking-wider">
              <Settings size={16} /> Controls
            </div>
            
            <div className="mb-6">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-500 flex items-center gap-1"><AudioLines size={12} /> Emitter</span>
                <span className="text-cyan-300">{Math.round(volume * 100)}%</span>
              </div>
              <input type="range" min="0" max="0.3" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
            </div>

            {!isSonarActive && !isCalibrating ? (
              <button onClick={startSonar} className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 rounded-lg transition-all">
                <Power size={18} /> ACTIVATE
              </button>
            ) : isCalibrating ? (
              <button disabled className="w-full flex items-center justify-center gap-2 bg-yellow-500/20 text-yellow-400 font-bold py-3 rounded-lg cursor-wait">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                  <Activity size={18} />
                </motion.div> CALIBRATING...
              </button>
            ) : (
              <button onClick={stopSonar} className="w-full flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-500 text-white font-bold py-3 rounded-lg transition-all">
                <Power size={18} /> DEACTIVATE
              </button>
            )}
          </motion.div>
        </div>

        {/* Middle Column: 3D Visualizer */}
        <div className="flex flex-col items-center justify-start">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="relative w-full h-96 lg:h-[500px] bg-gray-900/40 backdrop-blur-md border border-cyan-500/20 rounded-xl overflow-hidden"
          >
            <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
              <ambientLight intensity={0.5} />
              <pointLight position={[10, 10, 10]} />
              <TabletModel />
              <SonarSphere disturbanceRef={disturbanceRef} />
              {/* Optional: OrbitControls to rotate the view */}
              <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} />
            </Canvas>
            
            <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.div
                  key={motionState}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`text-2xl font-bold tracking-widest ${
                    motionState === 'INBOUND' ? 'text-red-400' : 
                    motionState === 'OUTBOUND' ? 'text-green-400' : 
                    'text-cyan-400'
                  }`}
                >
                  {motionState === 'INBOUND' ? 'TARGET INBOUND' : motionState === 'OUTBOUND' ? 'TARGET OUTBOUND' : 'SCANNING'}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        {/* Right Column: System Logs */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-gray-900/40 backdrop-blur-md border border-cyan-500/20 rounded-xl flex flex-col h-96 lg:h-[500px]"
        >
          <div className="flex items-center justify-between p-4 border-b border-cyan-500/10">
            <span className="text-xs uppercase tracking-wider text-gray-400">Event Logs</span>
            <button onClick={copyLogs} className="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded flex items-center gap-1 transition-colors">
              <Copy size={12} /> COPY
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-1 text-xs">
            {logs.length === 0 ? (
              <p className="text-gray-600 italic text-center mt-4">Awaiting activation...</p>
            ) : (
              logs.map((log, index) => (
                <motion.div 
                  key={index} 
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  className={`font-mono ${
                    log.includes('MOTION') ? 'text-red-300' : 
                    log.includes('OUTBOUND') ? 'text-green-300' : 
                    log.includes('ERROR') ? 'text-red-500' : 
                    log.includes('Calibration') || log.includes('locked') ? 'text-yellow-300' :
                    'text-gray-500'
                  }`}
                >
                  {log}
                </motion.div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </main>
  );
}
