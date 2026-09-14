'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export default function Home() {
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [volume, setVolume] = useState(0.05);
  const [dopplerShift, setDopplerShift] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [motionState, setMotionState] = useState<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const motionStateRef = useRef<'SCANNING' | 'INBOUND' | 'OUTBOUND'>('SCANNING');

  // Logging Utility
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  }, []);

  // Copy Logs to Clipboard
  const copyLogs = () => {
    const logText = logs.join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      addLog("System: Logs copied to clipboard.");
    }).catch(err => {
      addLog("System: Failed to copy logs.");
      console.error(err);
    });
  };

  // The Sonar Math Engine
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

    const netShift = (towardEnergy - awayEnergy) / 100;
    const smoothedShift = Math.max(-100, Math.min(100, netShift));
    setDopplerShift(prev => (prev * 0.8) + (smoothedShift * 0.2));

    // State transition logging
    let currentState = motionStateRef.current;
    if (smoothedShift > 15) {
      if (currentState !== 'INBOUND') {
        currentState = 'INBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        addLog(`MOTION INBOUND | Shift: +${smoothedShift.toFixed(2)} Hz | Object approaching.`);
      }
    } else if (smoothedShift < -15) {
      if (currentState !== 'OUTBOUND') {
        currentState = 'OUTBOUND';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        addLog(`MOTION OUTBOUND | Shift: ${smoothedShift.toFixed(2)} Hz | Object retreating.`);
      }
    } else {
      if (currentState !== 'SCANNING') {
        currentState = 'SCANNING';
        motionStateRef.current = currentState;
        setMotionState(currentState);
        addLog(`SECTOR CLEAR | Shift stable at ${smoothedShift.toFixed(2)} Hz.`);
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeDoppler);
  };

  // Start the Sonar System
  const startSonar = async () => {
    try {
      setLogs([]); // Clear previous logs
      addLog("System: Initializing Sonar Array...");
      
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
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
      addLog("System: 19kHz Emitter online.");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        }
      });
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      source.connect(analyser);
      
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      addLog("System: Raw microphone feed established. Doppler analysis active.");

      motionStateRef.current = 'SCANNING';
      setIsSonarActive(true);
      analyzeDoppler();
    } catch (err) {
      addLog("System: FATAL ERROR - Sonar initialization failed.");
      console.error(err);
    }
  };

  // Stop the Sonar System
  const stopSonar = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (oscillatorRef.current) oscillatorRef.current.stop();
    if (audioContextRef.current) audioContextRef.current.close();
    
    oscillatorRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
    setIsSonarActive(false);
    setDopplerShift(0);
    motionStateRef.current = 'SCANNING';
    addLog("System: Sonar deactivated. Session ended.");
  };

  useEffect(() => {
    if (gainRef.current && audioContextRef.current) {
      gainRef.current.gain.setValueAtTime(volume, audioContextRef.current.currentTime);
    }
  }, [volume]);

  useEffect(() => {
    return () => stopSonar();
  }, []);

  const intensity = Math.abs(dopplerShift) / 100;

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-start p-4 sm:p-8 font-mono overflow-hidden">
      
      {/* Background Grid for 3D Depth */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

      <header className="z-10 text-center mb-8 mt-4">
        <h1 className="text-3xl sm:text-5xl font-bold text-cyan-400 tracking-widest drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">
          DIGITAL SONAR
        </h1>
        <p className="text-gray-500 text-xs sm:text-sm tracking-wide mt-2">
          TejUzumaki | Doppler Motion Detection Array
        </p>
      </header>

      <div className="z-10 flex flex-col lg:flex-row gap-8 w-full max-w-6xl justify-center items-center">
        
        {/* Left: 3D Radar UI */}
        <div className="flex flex-col items-center gap-6 w-full lg:w-1/2">
          <div className="relative w-72 h-72 sm:w-96 sm:h-96 [transform:perspective(1000px)_rotateX(25deg)]">
            {/* Holographic Base Glow */}
            <div className="absolute inset-0 bg-cyan-500/10 blur-3xl rounded-full"></div>
            
            {/* Radar Rings */}
            <div className="absolute w-full h-full rounded-full border-2 border-cyan-400/30 shadow-[0_0_20px_rgba(34,211,238,0.3)]"></div>
            <div className="absolute w-3/4 h-3/4 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/20"></div>
            <div className="absolute w-1/2 h-1/2 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/20"></div>
            <div className="absolute w-1/4 h-1/4 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/20"></div>
            
            {/* Crosshairs */}
            <div className="absolute top-1/2 left-0 w-full h-px bg-cyan-400/20"></div>
            <div className="absolute left-1/2 top-0 h-full w-px bg-cyan-400/20"></div>

            {/* Sweeping Radar Line */}
            {isSonarActive && (
              <div className="absolute top-1/2 left-1/2 w-1/2 h-1 origin-left bg-gradient-to-r from-cyan-400/0 via-cyan-400/80 to-cyan-400 animate-[spin_3s_linear_infinite] shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div>
            )}

            {/* Doppler Pulse (Inbound - Red) */}
            {motionState === 'INBOUND' && (
              <div 
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/40 animate-ping"
                style={{ 
                  width: `${50 + (intensity * 100)}%`, 
                  height: `${50 + (intensity * 100)}%`,
                  transition: 'all 0.1s ease-out'
                }}
              ></div>
            )}

            {/* Doppler Pulse (Outbound - Green) */}
            {motionState === 'OUTBOUND' && (
              <div 
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-green-500/50"
                style={{ 
                  width: `${50 + (intensity * 100)}%`, 
                  height: `${50 + (intensity * 100)}%`,
                  transition: 'all 0.1s ease-out'
                }}
              ></div>
            )}

            {/* Center Core */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full transition-colors duration-100 ${
              motionState === 'INBOUND' ? 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.8)]' : 
              motionState === 'OUTBOUND' ? 'bg-green-500 shadow-[0_0_20px_rgba(34,197,94,0.8)]' : 
              'bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.8)]'
            }`}></div>
          </div>

          {/* Status Display */}
          <div className="text-center h-16 flex flex-col justify-center bg-gray-900/50 backdrop-blur-md border border-cyan-500/20 px-8 py-4 rounded-lg w-full max-w-xs">
            <div className={`text-xl font-bold tracking-wider ${
              motionState === 'INBOUND' ? 'text-red-400' : 
              motionState === 'OUTBOUND' ? 'text-green-400' : 
              'text-cyan-400'
            }`}>
              {motionState === 'INBOUND' ? 'TARGET INBOUND' : 
               motionState === 'OUTBOUND' ? 'TARGET OUTBOUND' : 
               'SCANNING SECTOR'}
            </div>
            <div className="text-sm text-gray-400 mt-1 font-mono">
              Shift: {dopplerShift.toFixed(2)} Hz
            </div>
          </div>

          {/* Controls */}
          {!isSonarActive ? (
            <button 
              onClick={startSonar}
              className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-4 px-12 rounded-lg transition-all tracking-wider hover:shadow-[0_0_20px_rgba(34,211,238,0.5)]"
            >
              ACTIVATE SONAR
            </button>
          ) : (
            <div className="flex flex-col items-center gap-4 w-full max-w-xs">
              <div className="w-full bg-gray-900/50 backdrop-blur-md border border-cyan-500/20 p-4 rounded-lg">
                <label className="text-sm text-gray-400 mb-2 block text-center">
                  Emitter Volume (19kHz)
                </label>
                <input 
                  type="range" 
                  min="0" 
                  max="0.3" 
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>
              <button 
                onClick={stopSonar}
                className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-12 rounded-lg transition-all tracking-wider hover:shadow-[0_0_20px_rgba(239,68,68,0.5)]"
              >
                DEACTIVATE
              </button>
            </div>
          )}
        </div>

        {/* Right: System Logs */}
        <div className="w-full lg:w-1/2 h-96 lg:h-[500px] bg-gray-900/50 backdrop-blur-md border border-cyan-500/20 rounded-lg flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-cyan-500/20">
            <h2 className="text-sm font-bold text-cyan-400 tracking-wider">SYSTEM LOGS</h2>
            <button 
              onClick={copyLogs}
              disabled={logs.length === 0}
              className="text-xs bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 px-3 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              COPY LOGS
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-1 text-xs sm:text-sm">
            {logs.length === 0 ? (
              <p className="text-gray-600 italic">Awaiting sonar activation...</p>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={`font-mono ${
                  log.includes('FATAL') ? 'text-red-400' : 
                  log.includes('INBOUND') ? 'text-red-300' : 
                  log.includes('OUTBOUND') ? 'text-green-300' : 
                  log.includes('System') ? 'text-gray-400' : 
                  'text-cyan-300'
                }`}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
