'use client';

import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [isSonarActive, setIsSonarActive] = useState(false);
  const [volume, setVolume] = useState(0.05); // Very low default volume to protect speakers
  const [dopplerShift, setDopplerShift] = useState(0); // Positive = inbound, Negative = outbound
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Explicitly type for ArrayBuffer to satisfy strict TS builds
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // The Sonar Math Engine
  const analyzeDoppler = () => {
    if (!analyserRef.current || !dataArrayRef.current || !audioContextRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const sampleRate = audioContextRef.current.sampleRate;
    const fftSize = analyser.fftSize;
    
    // Get fresh frequency data
    analyser.getByteFrequencyData(dataArray);

    // Calculate the bin index for 19,000 Hz
    const baseFreq = 19000;
    const binWidth = sampleRate / fftSize;
    const baseBin = Math.floor(baseFreq / binWidth);

    // Define ranges to check for Doppler shift (approx +/- 50Hz)
    const range = Math.floor(50 / binWidth); 

    let awayEnergy = 0; // Lower frequencies (hand moving away)
    let towardEnergy = 0; // Higher frequencies (hand moving toward)

    // Sum the energy in the bins below 19kHz (Away)
    for (let i = baseBin - range; i < baseBin - 2; i++) {
      if (i > 0) awayEnergy += dataArray[i];
    }

    // Sum the energy in the bins above 19kHz (Toward)
    for (let i = baseBin + 2; i < baseBin + range; i++) {
      if (i < dataArray.length) towardEnergy += dataArray[i];
    }

    // Calculate net shift. (Toward - Away)
    const netShift = (towardEnergy - awayEnergy) / 100;
    
    // Smooth out the value a bit and clamp it
    const smoothedShift = Math.max(-100, Math.min(100, netShift));
    setDopplerShift(prev => (prev * 0.8) + (smoothedShift * 0.2));

    animationFrameRef.current = requestAnimationFrame(analyzeDoppler);
  };

  // Start the Sonar System
  const startSonar = async () => {
    try {
      // 1. Setup Audio Context
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = context;

      // 2. Setup the 19kHz Oscillator (Emitter)
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

      // 3. Setup the Microphone (Receiver)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        }
      });
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192; // Large FFT for high frequency resolution
      source.connect(analyser);
      
      analyserRef.current = analyser;
      // Explicit ArrayBuffer allocation to fix TS2345
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      setIsSonarActive(true);
      analyzeDoppler(); // Start the math loop
    } catch (err) {
      console.error("Sonar initialization failed", err);
      alert("Failed to start sonar. Check microphone permissions.");
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
  };

  // Adjust Emitter Volume
  useEffect(() => {
    if (gainRef.current && audioContextRef.current) {
      gainRef.current.gain.setValueAtTime(volume, audioContextRef.current.currentTime);
    }
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopSonar();
  }, []);

  // Determine UI state based on Doppler shift
  const isMovingToward = dopplerShift > 10;
  const isMovingAway = dopplerShift < -10;
  const intensity = Math.abs(dopplerShift) / 100;

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8 font-mono">
      <h1 className="text-4xl font-bold mb-2 text-cyan-400">DIGITAL SONAR</h1>
      <p className="text-gray-500 mb-8 text-sm">TejUzumaki | Doppler Motion Detection Prototype</p>

      {/* Sonar Radar UI */}
      <div className="relative w-80 h-80 mb-8 flex items-center justify-center">
        {/* Outer Rings */}
        <div className="absolute w-full h-full rounded-full border border-cyan-900/50"></div>
        <div className="absolute w-3/4 h-3/4 rounded-full border border-cyan-900/50"></div>
        <div className="absolute w-1/2 h-1/2 rounded-full border border-cyan-900/50"></div>
        <div className="absolute w-1/4 h-1/4 rounded-full border border-cyan-900/50"></div>
        
        {/* Crosshairs */}
        <div className="absolute w-full h-px bg-cyan-900/30"></div>
        <div className="absolute h-full w-px bg-cyan-900/30"></div>

        {/* Doppler Pulse (Inbound - Red) */}
        {isMovingToward && (
          <div 
            className="absolute rounded-full bg-red-500/50 animate-ping"
            style={{ 
              width: `${50 + (intensity * 50)}%`, 
              height: `${50 + (intensity * 50)}%`,
              transition: 'all 0.1s ease-out'
            }}
          ></div>
        )}

        {/* Doppler Pulse (Outbound - Green) */}
        {isMovingAway && (
          <div 
            className="absolute rounded-full border-2 border-green-500/50"
            style={{ 
              width: `${50 + (intensity * 50)}%`, 
              height: `${50 + (intensity * 50)}%`,
              transition: 'all 0.1s ease-out'
            }}
          ></div>
        )}

        {/* Center Core */}
        <div className={`absolute w-4 h-4 rounded-full transition-colors duration-100 ${
          isMovingToward ? 'bg-red-500' : isMovingAway ? 'bg-green-500' : 'bg-cyan-400'
        }`}></div>
      </div>

      {/* Status Display */}
      <div className="mb-8 text-center h-12">
        <div className="text-xl font-bold tracking-wider">
          {isMovingToward ? 'MOTION DETECTED: INBOUND' : 
           isMovingAway ? 'MOTION DETECTED: OUTBOUND' : 
           'SCANNING...'}
        </div>
        <div className="text-sm text-gray-400 mt-1">
          Shift: {dopplerShift.toFixed(2)} Hz
        </div>
      </div>

      {/* Controls */}
      {!isSonarActive ? (
        <button 
          onClick={startSonar}
          className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-3 px-8 rounded-lg transition-colors tracking-wider"
        >
          ACTIVATE SONAR
        </button>
      ) : (
        <div className="flex flex-col items-center gap-6 w-full max-w-xs">
          <div className="w-full">
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
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-8 rounded-lg transition-colors tracking-wider"
          >
            DEACTIVATE
          </button>
        </div>
      )}
      
      <p className="text-xs text-gray-600 mt-8 max-w-md text-center">
        Note: Increase volume if no motion is detected. Some tablet speakers are weak at 19kHz. 
        Keep the tablet screen facing you and wave your hand 10-30cm away.
      </p>
    </main>
  );
}
