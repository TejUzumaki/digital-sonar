'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, AudioLines, Copy, Power, Settings, Radar } from 'lucide-react';

export default function Home() {
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [volume, setVolume] = useState(0.15);
  const [dopplerShift, setDopplerShift] = useState(0);
  const [peakFreq, setPeakFreq] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [motionState, setMotionState] = useState<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const motionStateRef = useRef<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');
  const baselineFreqRef = useRef(19000);
  const lastLogTimeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]);
  }, []);

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    addLog("System: Logs copied to clipboard.");
  };

  // The Precision Math Engine
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
    
    // We only look at a narrow window of +/- 100Hz for extreme precision
    const range = Math.floor(100 / binWidth); 

    let maxAmp = 0;
    let peakBin = baseBin;

    // Find the exact bin with the highest energy in our window
    for (let i = baseBin - range; i < baseBin + range; i++) {
      if (i >= 0 && i < dataArray.length) {
        if (dataArray[i] > maxAmp) {
          maxAmp = dataArray[i];
          peakBin = i;
        }
      }
    }

    // Convert the peak bin back to a frequency
    const currentPeakFreq = peakBin * binWidth;
    const shift = currentPeakFreq - baselineFreqRef.current;
    
    // Smooth the shift value for UI
    const smoothedShift = Math.max(-100, Math.min(100, shift));
    setDopplerShift(prev => (prev * 0.6) + (smoothedShift * 0.4));
    setPeakFreq(currentPeakFreq);

    // 2D Canvas Visualizer - Draw what the mic actually hears
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        const W = canvasRef.current.width;
        const H = canvasRef.current.height;
        ctx.clearRect(0, 0, W, H);

        // Draw Grid
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          const y = (H / 4) * i;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }

        // Draw 19,000 Hz Center Line (Baseline)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(W / 2, 0);
        ctx.lineTo(W / 2, H);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw the actual waveform
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = motionState === 'INBOUND' ? '#ef4444' : motionState === 'OUTBOUND' ? '#22c55e' : '#22d3ee';
        
        const startBin = baseBin - range;
        const endBin = baseBin + range;
        const sliceWidth = W / (endBin - startBin);

        for (let i = startBin; i <= endBin; i++) {
          const x = (i - startBin) * sliceWidth;
          const y = H - (dataArray[i] / 255) * H;
          if (i === startBin) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Fill under the wave
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = motionState === 'INBOUND' ? 'rgba(239, 68, 68, 0.1)' : motionState === 'OUTBOUND' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 211, 238, 0.1)';
        ctx.fill();
      }
    }

    // State logging with debounce
    const now = Date.now();
    let currentState = motionStateRef.current;
    
    if (smoothedShift > 2) {
      if (currentState !== 'INBOUND' && now - lastLogTimeRef.current > 300) {
        currentState = 'INBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION INBOUND | Peak: ${currentPeakFreq.toFixed(2)} Hz | Shift: +${smoothedShift.toFixed(2)} Hz`);
      }
    } else if (smoothedShift < -2) {
      if (currentState !== 'OUTBOUND' && now - lastLogTimeRef.current > 300) {
        currentState = 'OUTBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`MOTION OUTBOUND | Peak: ${currentPeakFreq.toFixed(2)} Hz | Shift: ${smoothedShift.toFixed(2)} Hz`);
      }
    } else {
      if (currentState !== 'SCANNING' && now - lastLogTimeRef.current > 300) {
        currentState = 'SCANNING';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        lastLogTimeRef.current = now;
        addLog(`SECTOR CLEAR | Peak stable at ${currentPeakFreq.toFixed(2)} Hz`);
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeDoppler);
  };

  const startSonar = async () => {
    try {
      setLogs([]);
      addLog("System: Initializing High-Res Array...");
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
      analyser.fftSize = 32768; // MAXIMUM FREQUENCY RESOLUTION
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      // Calibration Phase (Find the exact baseline peak)
      addLog("System: Calibrating baseline peak...");
      setTimeout(() => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        const binWidth = context.sampleRate / analyser.fftSize;
        const baseBin = Math.floor(19000 / binWidth);
        const range = Math.floor(100 / binWidth);
        
        let maxAmp = 0, peakBin = baseBin;
        for (let i = baseBin - range; i < baseBin + range; i++) {
          if (i >= 0 && i < dataArrayRef.current.length && dataArrayRef.current[i] > maxAmp) {
            maxAmp = dataArrayRef.current[i];
            peakBin = i;
          }
        }
        baselineFreqRef.current = peakBin * binWidth;
        addLog(`System: Calibration complete. Baseline locked at ${baselineFreqRef.current.toFixed(2)} Hz.`);
        setIsCalibrating(false);
        setIsSonarActive(true);
        motionStateRef.current = 'SCANNING';
        analyzeDoppler();
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
    setDopplerShift(0);
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
            <p className="text-gray-600 text-xs tracking-wide">PRECISION DOPPLER ARRAY v3.0</p>
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
                  <span className="text-gray-500">Peak Frequency</span>
                  <span className="text-cyan-300 font-bold">{peakFreq.toFixed(2)} Hz</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Doppler Shift</span>
                  <span className={`font-bold ${dopplerShift > 0 ? 'text-red-400' : dopplerShift < 0 ? 'text-green-400' : 'text-cyan-400'}`}>
                    {dopplerShift > 0 ? '+' : ''}{dopplerShift.toFixed(2)} Hz
                  </span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden relative">
                  <div className="absolute top-0 left-1/2 w-px h-full bg-gray-600"></div>
                  <motion.div 
                    className={`absolute top-0 h-full ${dopplerShift > 0 ? 'bg-red-500' : 'bg-green-500'}`}
                    animate={{ width: `${Math.min(50, Math.abs(dopplerShift) * 5)}%`, left: dopplerShift > 0 ? '50%' : 'auto', right: dopplerShift < 0 ? '50%' : 'auto' }}
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

        {/* Middle Column: ACTUAL 2D Visualizer */}
        <div className="flex flex-col items-center justify-start">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="relative w-full aspect-square bg-gray-900/40 backdrop-blur-md border border-cyan-500/20 rounded-xl p-4 flex flex-col"
          >
            <div className="text-xs text-gray-500 mb-2 flex justify-between">
              <span>18,900 Hz</span>
              <span className="text-gray-400">LIVE SPECTRUM (19k Hz)</span>
              <span>19,100 Hz</span>
            </div>
            <canvas ref={canvasRef} width={400} height={400} className="w-full h-full rounded-lg bg-black/50"></canvas>
            
            <div className="mt-4 text-center">
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
