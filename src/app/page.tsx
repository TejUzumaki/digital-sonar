'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, AudioLines, Copy, Power, Settings, Radar, ChevronDown, ChevronUp, Navigation } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';

// Custom GLSL Shader for Full-Screen Turbulent Fluid Fog
const fluidVertexShader = `
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vPos = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fluidFragmentShader = `
  varying vec3 vPos;
  varying vec3 vNormal;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uMotionDir;

  // Simplex 3D Noise
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){ 
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1. + 3.0 * C.xxx;
    i = mod(i, 289.0 ); 
    vec4 p = permute( permute( permute( 
              i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
            + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                  dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    // Large scale turbulence + small scale detail
    float n1 = snoise(vPos * 0.8 + uTime * 0.2);
    float n2 = snoise(vPos * 2.5 + uTime * 0.6);
    float density = n1 * 0.7 + n2 * 0.3;

    // Directional mask for motion
    float dirMask = dot(normalize(vPos), normalize(uMotionDir));
    dirMask = max(0.0, dirMask);

    // Turbulence swells heavily in the direction of motion
    float energyEffect = uEnergy * 0.02 * dirMask;
    density += energyEffect * 3.0;

    // Fluid Alpha
    float alpha = smoothstep(0.1, 0.9, density);
    alpha *= 0.8; // Thick fog

    // Deep Blue base, Cyan accents, Red motion
    vec3 deepBlue = vec3(0.0, 0.1, 0.8);
    vec3 neonCyan = vec3(0.0, 0.95, 1.0);
    vec3 motionRed = vec3(1.0, 0.1, 0.2);
    
    vec3 baseColor = mix(deepBlue, neonCyan, density * 0.5);
    vec3 finalColor = mix(baseColor, motionRed, energyEffect * 2.0);

    // Edge glow
    float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    finalColor += fresnel * 0.3;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// 3D Turbulent Fog Component
function TurbulentFluid({ energyRef, motionDirRef }: { 
  energyRef: React.MutableRefObject<number>, 
  motionDirRef: React.MutableRefObject<THREE.Vector3> 
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uMotionDir: { value: new THREE.Vector3(0, 0, 0) }
  }), []);

  useFrame(() => {
    if (!matRef.current || !meshRef.current) return;
    matRef.current.uniforms.uTime.value = performance.now() / 1000;
    
    const targetEnergy = energyRef.current;
    matRef.current.uniforms.uEnergy.value += (targetEnergy - matRef.current.uniforms.uEnergy.value) * 0.1;
    
    const targetDir = motionDirRef.current;
    matRef.current.uniforms.uMotionDir.value.lerp(targetDir, 0.1);
  });

  return (
    <group>
      {/* Core Device */}
      <mesh rotation={[0, 0, 0]}>
        <boxGeometry args={[0.4, 0.02, 0.25]} /> 
        <meshStandardMaterial color="#0a1a1a" emissive="#00f3ff" emissiveIntensity={0.8} />
      </mesh>

      {/* Large Box Volume for Turbulent Fog */}
      <mesh ref={meshRef} scale={5}>
        <boxGeometry args={[1, 1, 1, 20, 20, 20]} />
        <shaderMaterial 
          ref={matRef}
          vertexShader={fluidVertexShader}
          fragmentShader={fluidFragmentShader}
          uniforms={uniforms}
          transparent={true}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// Collapsible UI Panel
function CollapsiblePanel({ title, icon, children, defaultOpen = true, positionClass }: { 
  title: string, icon: React.ReactNode, children: React.ReactNode, defaultOpen?: boolean, positionClass: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`absolute ${positionClass} w-72 z-10 pointer-events-auto`}>
      <motion.div className="hud-panel hud-clip" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <button onClick={() => setIsOpen(!isOpen)} className="w-full p-4 flex justify-between items-center text-xs uppercase tracking-widest text-blue-300 hover:bg-blue-500/10 transition-colors">
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

// Helper: Convert Vector to Cardinal Direction
function getCardinalDirection(vec: THREE.Vector3, compassHeading: number) {
  // Assuming device is facing compassHeading (0 = North, 90 = East)
  // Device local Z+ is forward, X+ is right.
  // We need to rotate the motion vector by the compass heading to get world vector
  const worldX = vec.x * Math.cos(compassHeading * Math.PI / 180) - vec.z * Math.sin(compassHeading * Math.PI / 180);
  const worldZ = vec.x * Math.sin(compassHeading * Math.PI / 180) + vec.z * Math.cos(compassHeading * Math.PI / 180);
  
  const angle = Math.atan2(worldX, worldZ) * 180 / Math.PI;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((angle % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

export default function Home() {
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [volume, setVolume] = useState(0.15);
  const [logs, setLogs] = useState<string[]>([]);
  const [motionState, setMotionState] = useState<'SCANNING' | 'WALKING' | 'STOPPED'>('SCANNING');
  
  // Spatial Tracking State
  const [compassHeading, setCompassHeading] = useState(0);
  const [stopCount, setStopCount] = useState(0);
  const [currentDir, setCurrentDir] = useState('N/A');
  const [pathHistory, setPathHistory] = useState<string[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const octantEnergiesRef = useRef<number[]>(new Array(8).fill(0));
  const rollingBaselinesRef = useRef<number[]>(new Array(8).fill(0));
  const lastLogTimeRef = useRef(0);
  
  // 3D Math Refs
  const maxEnergyRef = useRef(0);
  const motionDirRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const isMovingRef = useRef(false);
  const lastDirRef = useRef('N/A');

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]);
  }, []);

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    addLog("System: Logs copied to clipboard.");
  };

  // Compass Listener
  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const e = event as any;
      if (e.webkitCompassHeading) {
        setCompassHeading(e.webkitCompassHeading);
      } else if (event.alpha) {
        setCompassHeading(360 - event.alpha);
      }
    };
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation);
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

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
    const totalBins = Math.floor(200 / binWidth);
    const binsPerOctant = Math.floor(totalBins / 8);
    const startBin = baseBin - Math.floor(totalBins / 2);

    let maxEnergy = 0;
    let totalDirVec = new THREE.Vector3(0, 0, 0);

    const octantVectors = [
      new THREE.Vector3(-1, -1, -1), new THREE.Vector3(-1, -1, 1),
      new THREE.Vector3(-1, 1, -1),  new THREE.Vector3(-1, 1, 1),
      new THREE.Vector3(1, -1, -1),  new THREE.Vector3(1, -1, 1),
      new THREE.Vector3(1, 1, -1),   new THREE.Vector3(1, 1, 1)
    ];

    for (let oct = 0; oct < 8; oct++) {
      let energy = 0;
      const octStart = startBin + (oct * binsPerOctant);
      for (let i = 0; i < binsPerOctant; i++) {
        const bin = octStart + i;
        if (bin > 0 && bin < dataArray.length) energy += dataArray[bin];
      }

      rollingBaselinesRef.current[oct] = (rollingBaselinesRef.current[oct] * 0.96) + (energy * 0.04);
      const dynEnergy = Math.max(0, energy - rollingBaselinesRef.current[oct]);
      
      octantEnergiesRef.current[oct] = dynEnergy;

      if (dynEnergy > 15) {
        totalDirVec.add(octantVectors[oct].clone().multiplyScalar(dynEnergy));
      }
      if (dynEnergy > maxEnergy) maxEnergy = dynEnergy;
    }

    maxEnergyRef.current = maxEnergy;
    if (maxEnergy > 15) {
      motionDirRef.current.lerp(totalDirVec.normalize(), 0.1);
    } else {
      motionDirRef.current.lerp(new THREE.Vector3(0, 0, 0), 0.1);
    }

    // Path Tracking Logic
    const now = Date.now();
    const currentlyMoving = maxEnergy > 25;
    const cardinal = maxEnergy > 15 ? getCardinalDirection(totalDirVec, compassHeading) : 'N/A';

    if (currentlyMoving !== isMovingRef.current) {
      if (currentlyMoving) {
        setMotionState('WALKING');
        addLog(`PATH START | Subject began moving. Heading: ${cardinal}`);
        setPathHistory(prev => [...prev, `START: ${cardinal}`]);
      } else {
        setMotionState('STOPPED');
        setStopCount(prev => prev + 1);
        addLog(`PATH STOP | Subject stopped. Total stops: ${stopCount + 1}`);
        setPathHistory(prev => [...prev, `STOP`]);
      }
      isMovingRef.current = currentlyMoving;
      lastLogTimeRef.current = now;
    } else if (currentlyMoving && cardinal !== lastDirRef.current && now - lastLogTimeRef.current > 1000) {
      addLog(`PATH CHANGE | Direction shifted to ${cardinal}`);
      setPathHistory(prev => [...prev, `MOVE: ${cardinal}`]);
      lastDirRef.current = cardinal;
      lastLogTimeRef.current = now;
      setCurrentDir(cardinal);
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const startSonar = async () => {
    try {
      setLogs([]);
      setStopCount(0);
      setPathHistory([]);
      addLog("System: Initializing Fluid Tracking Engine...");
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
        
        addLog(`System: Calibration complete. Spatial fluid active.`);
        setIsCalibrating(false);
        setIsSonarActive(true);
        setMotionState('SCANNING');
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
    maxEnergyRef.current = 0;
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
    <main className="relative min-h-screen bg-[#01020a] text-white font-mono overflow-hidden">
      
      <div className="fixed inset-0 z-0">
        <Canvas camera={{ position: [0, 0, 4], fov: 60 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <TurbulentFluid energyRef={maxEnergyRef} motionDirRef={motionDirRef} />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.2} />
        </Canvas>
      </div>

      <div className="atmosphere"></div>

      <div className="fixed inset-0 z-10 pointer-events-none p-4 sm:p-6">
        
        <CollapsiblePanel title="Spatial Tracking" icon={<Navigation size={16} />} positionClass="top-4 left-4 sm:top-6 sm:left-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Compass Heading</span>
              <span className="text-blue-300 font-bold neon-text">{compassHeading.toFixed(0)}°</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Current Direction</span>
              <span className="text-cyan-300 font-bold neon-text">{currentDir}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Total Stops</span>
              <span className="text-red-300 font-bold neon-text">{stopCount}</span>
            </div>
            <div className="pt-2 border-t border-gray-800">
              <span className="text-xs text-gray-500 block mb-1">Path History</span>
              <div className="h-16 overflow-y-auto text-[10px] text-gray-400 bg-black/30 p-1">
                {pathHistory.length === 0 ? "No movement recorded." : pathHistory.join(' -> ')}
              </div>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-gray-800">
              <span className="text-xs text-gray-500">Status</span>
              <span className={`text-sm font-bold neon-text ${
                motionState === 'WALKING' ? 'text-red-400' : motionState === 'STOPPED' ? 'text-yellow-400' : 'text-blue-400'
              }`}>{motionState}</span>
            </div>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel title="Controls" icon={<Settings size={16} />} positionClass="top-4 right-4 sm:top-6 sm:right-6" defaultOpen={false}>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-500 flex items-center gap-1"><AudioLines size={12} /> Emitter</span>
                <span className="text-blue-300">{Math.round(volume * 100)}%</span>
              </div>
              <input type="range" min="0" max="0.3" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-full accent-blue-500" />
            </div>
            {!isSonarActive && !isCalibrating ? (
              <button onClick={startSonar} className="hud-clip-sm w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 text-black font-bold py-2 transition-all text-sm">
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
            <Radar className="text-blue-400/80 neon-text" size={32} />
          </motion.div>
          <AnimatePresence mode="wait">
            <motion.div
              key={motionState}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`text-3xl font-bold tracking-widest neon-text ${
                motionState === 'WALKING' ? 'text-red-400' : motionState === 'STOPPED' ? 'text-yellow-400' : 'text-blue-400'
              }`}
            >
              {motionState === 'WALKING' ? 'SUBJECT IN MOTION' : motionState === 'STOPPED' ? 'SUBJECT STOPPED' : 'SCANNING'}
            </motion.div>
          </AnimatePresence>
        </div>

        <CollapsiblePanel title="System Logs" icon={<Activity size={16} />} positionClass="bottom-4 right-4 sm:bottom-6 sm:right-6" defaultOpen={false}>
          <div className="flex flex-col gap-2">
            <button onClick={copyLogs} className="hud-clip-sm text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 px-3 py-1 flex items-center gap-1 transition-colors w-full justify-center">
              <Copy size={12} /> COPY LOGS
            </button>
            <div className="h-48 overflow-y-auto p-2 space-y-1 text-xs bg-black/30">
              {logs.length === 0 ? (
                <p className="text-gray-600 italic text-center mt-4">Awaiting activation...</p>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`font-mono ${log.includes('PATH') ? 'text-red-300' : log.includes('ERROR') ? 'text-red-500' : log.includes('Calibration') ? 'text-yellow-300' : 'text-gray-500'}`}>
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
