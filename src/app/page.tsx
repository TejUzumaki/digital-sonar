'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radar, Activity, AudioLines, Copy, Power, Settings, Zap } from 'lucide-react';

export default function Home() {
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [volume, setVolume] = useState(0.15);
  const [dopplerShift, setDopplerShift] = useState(0);
  const [rawShift, setRawShift] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [motionState, setMotionState] = useState<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const motionStateRef = useRef<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');
  const baselineRef = useRef<{ toward: number; away: number }>({ toward: 0, away: 0 });
  const lastLogTimeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]); // Keep last 50 logs
  }, []);

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    addLog("System: Logs copied to clipboard.");
  };

  const analyzeDoppler = () => {
    if (!analyserRef.current || !dataArrayRef.current || !audioContextRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const sampleRate = audioContextRef.current.sampleRate;
    const fftSize = analyser.fftSize;
    
    analyser.getByteFrequencyData(dataArray);

    const baseFreq = 19000;
    const binWidth = sampleRate / fftSize;
    const baseBin = Math.floor(baseFreq / binWidth);
    const range = Math.floor(50 / binWidth); 

    let awayEnergy = 0;
    let towardEnergy = 0;

    for (let i = baseBin - range; i < baseBin - 2; i++) {
      if (i > 0) awayEnergy += dataArray[i];
    }
    for (let i = baseBin + 2; i < baseBin + range; i++) {
      if (i < dataArray.length) towardEnergy += dataArray[i];
    }

    // Subtract the baseline (calibrated speaker bleed)
    const adjustedToward = Math.max(0, towardEnergy - baselineRef.current.toward);
    const adjustedAway = Math.max(0, awayEnergy - baselineRef.current.away);
    
    const netShift = (adjustedToward - adjustedAway) / 20;
    setRawShift(netShift);
    
    const smoothedShift = Math.max(-100, Math.min(100, netShift));
    setDopplerShift(prev => (prev * 0.7) + (smoothedShift * 0.3));

    // Debounce state changes to prevent log spam
    const now = Date.now();
    let currentState = motionStateRef.current;
    
    if (smoothedShift > 15) {
      if (currentState !== 'INBOUND' && now - lastLogTimeRef.current > 500) {
        currentState = 'INBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION INBOUND | Shift: +${smoothedShift.toFixed(2)} Hz | Velocity detected.`);
      }
    } else if (smoothedShift < -15) {
      if (currentState !== 'OUTBOUND' && now - lastLogTimeRef.current > 500) {
        currentState = 'OUTBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION OUTBOUND | Shift: ${smoothedShift.toFixed(2)} Hz | Object retreating.`);
      }
    } else {
      if (currentState !== 'SCANNING' && now - lastLogTimeRef.current > 500) {
        currentState = 'SCANNING';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`SECTOR CLEAR | Environment stable.`);
      }
    }

    // Draw Canvas Radar Blip
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        if (currentState !== 'SCANNING') {
          const radius = Math.min(80, Math.abs(smoothedShift) * 4);
          ctx.beginPath();
          ctx.arc(150, 150, radius, 0, 2 * Math.PI);
          ctx.fillStyle = currentState === 'INBOUND' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)';
          ctx.fill();
          ctx.strokeStyle = currentState === 'INBOUND' ? 'rgba(239, 68, 68, 0.8)' : 'rgba(34, 197, 94, 0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeDoppler);
  };

  const startSonar = async () => {
    try {
      setLogs([]);
      addLog("System: Initializing React Sonar Array...");
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
      analyser.fftSize = 8192;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      // Calibration Phase (3 seconds)
      addLog("System: Calibrating baseline noise...");
      let calToward = 0, calAway = 0, calFrames = 0;
      const calInterval = setInterval(() => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        const sampleRate = context.sampleRate;
        const binWidth = sampleRate / analyser.fftSize;
        const baseBin = Math.floor(19000 / binWidth);
        const range = Math.floor(50 / binWidth);
        
        let tE = 0, aE = 0;
        for (let i = baseBin - range; i < baseBin - 2; i++) if (i > 0) aE += dataArrayRef.current[i];
        for (let i = baseBin + 2; i < baseBin + range; i++) if (i < dataArrayRef.current.length) tE += dataArrayRef.current[i];
        
        calToward += tE; calAway += aE; calFrames++;
      }, 100);

      setTimeout(() => {
        clearInterval(calInterval);
        baselineRef.current = { toward: calToward / calFrames, away: calAway / calFrames };
        addLog(`System: Calibration complete. Baseline removed (T:${baselineRef.current.toward.toFixed(0)} A:${baselineRef.current.away.toFixed(0)}).`);
        setIsCalibrating(false);
        setIsSonarActive(true);
        motionStateRef.current = 'SCANNING';
        analyzeDoppler();
      }, 3000);

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
    setDopplerShift(0);
    setRawShift(0);
    motionStateRef.current = 'SCANNING';
    addLog("System: Sonar deactivated.");
  };

  useEffect(() => {
    if (gainRef.current && audioContextRef.current) {
      gainRef.current.gain.setValueAtTime(volume, audioContextRef.current.currentTime);
    }
  }, [volume]);

  useEffect(() => () => stopSonar(), []);

  const intensity = Math.abs(dopplerShift) / 100;

  return (
    <main className="min-h-screen bg-[#05070a] text-white flex flex-col items-center justify-start p-4 sm:p-8 font-mono overflow-hidden">
      
      {/* Animated Background Grid */}
      <motion.div 
        className="fixed inset-0 bg-[linear-gradient(to_right,#0a0f1a_1px,transparent_1px),linear-gradient(to_bottom,#0a0f1a_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"
        animate={{ backgroundPosition: ["0px 0px", "40px 40px"] }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />

      {/* Header */}
      <header className="z-10 flex justify-between items-center w-full max-w-6xl mb-12">
        <div className="flex items-center gap-3">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }}>
            <Radar className="text-cyan-400" size={32} />
          </motion.div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-400 tracking-widest">DIGITAL SONAR</h1>
            <p className="text-gray-600 text-xs tracking-wide">DOPPLER ARRAY v2.0</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-gray-900/50 border border-cyan-500/20 px-4 py-2 rounded-lg">
          <div className={`w-2 h-2 rounded-full ${isSonarActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          <span className="text-xs text-gray-400">{isCalibrating ? 'CALIBRATING' : isSonarActive ? 'ACTIVE' : 'OFFLINE'}</span>
        </div>
      </header>

      <div className="z-10 grid grid-cols-1 lg:grid-cols-3 gap-8 w-full max-w-6xl">
        
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
                  <span className="text-gray-500">Doppler Shift</span>
                  <span className={`font-bold ${dopplerShift > 0 ? 'text-red-400' : dopplerShift < 0 ? 'text-green-400' : 'text-cyan-400'}`}>
                    {dopplerShift.toFixed(2)} Hz
                  </span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden relative">
                  <div className="absolute top-0 left-1/2 w-px h-full bg-gray-600"></div>
                  <motion.div 
                    className={`absolute top-0 h-full ${dopplerShift > 0 ? 'bg-red-500' : 'bg-green-500'}`}
                    animate={{ width: `${Math.min(50, Math.abs(dopplerShift))}%`, left: dopplerShift > 0 ? '50%' : 'auto', right: dopplerShift < 0 ? '50%' : 'auto' }}
                  />
                </div>
              </div>
              
              <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                <span className="text-xs text-gray-500">Raw Signal</span>
                <span className="text-sm text-cyan-300 font-bold">{rawShift.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Status</span>
                <span className={`text-sm font-bold ${
                  motionState === 'INBOUND' ? 'text-red-400' : motionState === 'OUTBOUND' ? 'text-green-400' : 'text-cyan-400'
                }`}>{motionState}</span>
              </div>
            </div>
          </motion.div>

          {/* Controls */}
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
                  <Zap size={18} />
                </motion.div> CALIBRATING...
              </button>
            ) : (
              <button onClick={stopSonar} className="w-full flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-500 text-white font-bold py-3 rounded-lg transition-all">
                <Power size={18} /> DEACTIVATE
              </button>
            )}
          </motion.div>
        </div>

        {/* Middle Column: Radar Visualizer */}
        <div className="flex flex-col items-center justify-start">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="relative w-72 h-72 sm:w-80 sm:h-80 [transform:perspective(1000px)_rotateX(20deg)]"
          >
            <div className="absolute inset-0 bg-cyan-500/5 blur-3xl rounded-full"></div>
            <div className="absolute w-full h-full rounded-full border-2 border-cyan-400/20"></div>
            <div className="absolute w-3/4 h-3/4 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/10"></div>
            <div className="absolute w-1/2 h-1/2 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/10"></div>
            <div className="absolute top-1/2 left-0 w-full h-px bg-cyan-400/10"></div>
            <div className="absolute left-1/2 top-0 h-full w-px bg-cyan-400/10"></div>
            
            <canvas ref={canvasRef} width={300} height={300} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full"></canvas>
            
            {isSonarActive && (
              <motion.div 
                className="absolute top-1/2 left-1/2 w-1/2 h-1 origin-left bg-gradient-to-r from-transparent via-cyan-400/60 to-cyan-400"
                animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />
            )}

            <motion.div 
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full ${
                motionState === 'INBOUND' ? 'bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.8)]' : 
                motionState === 'OUTBOUND' ? 'bg-green-500 shadow-[0_0_30px_rgba(34,197,94,0.8)]' : 
                'bg-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.8)]'
              }`}
              animate={{ scale: motionState !== 'SCANNING' ? [1, 1.5, 1] : 1 }}
              transition={{ duration: 0.5 }}
            />
          </motion.div>
          
          <div className="mt-6 text-center">
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
                  className={`font-mano ${
                    log.includes('MOTION') ? 'text-red-300' : 
                    log.includes('OUTBOUND') ? 'text-green-300' : 
                    log.includes('ERROR') ? 'text-red-500' : 
                    log.includes('Calibration') ? 'text-yellow-300' :
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
