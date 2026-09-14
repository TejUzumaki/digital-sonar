'use client';

import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Request Mic Permission (With RAW audio constraints for Sonar)
  const requestMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false, // We WANT echoes for sonar!
          autoGainControl: false,  // Don't mess with the volume
          noiseSuppression: false, // Don't filter out high frequencies
        }
      });
      setHasMicPermission(true);
      
      // Setup Web Audio API
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096; // Higher FFT size for better frequency resolution
      source.connect(analyser);
      
      audioContextRef.current = context;
      analyserRef.current = analyser;
    } catch (err) {
      console.error("Microphone access denied", err);
    }
  };

  // Draw the Spectrogram
  const drawSpectrogram = () => {
    if (!analyserRef.current || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const width = canvas.width;
    const height = canvas.height;

    const draw = () => {
      if (!isListening) return;
      requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      // Draw a fading background for a trailing effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, width, height);

      // Draw frequency bars
      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let xPosition = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * height;

        // Color gradient based on frequency (Blue -> Red)
        const hue = (i / bufferLength) * 260; 
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.fillRect(xPosition, height - barHeight, barWidth, barHeight);

        xPosition += barWidth + 1;
      }
    };

    draw();
  };

  useEffect(() => {
    if (isListening) {
      drawSpectrogram();
    }
  }, [isListening, hasMicPermission]);

  return (
    <main className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-2 text-cyan-400">Digital Sonar Prototype</h1>
      <p className="text-gray-400 mb-8">By TejUzumaki | Vibe Coding an Ultrasound Future</p>

      {!hasMicPermission ? (
        <button 
          onClick={requestMic}
          className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-3 px-6 rounded-lg transition-colors"
        >
          Grant Microphone Access
        </button>
      ) : (
        <div className="flex flex-col items-center gap-4 w-full max-w-4xl">
          <button
            onClick={() => setIsListening(!isListening)}
            className={`font-bold py-3 px-6 rounded-lg transition-colors ${
              isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
            } text-black`}
          >
            {isListening ? 'Stop Listening' : 'Start Spectrogram'}
          </button>
          
          <div className="w-full bg-black rounded-lg overflow-hidden border-2 border-cyan-500">
            <canvas 
              ref={canvasRef} 
              width={1024} 
              height={500} 
              className="w-full h-auto"
            />
          </div>
          <p className="text-sm text-gray-500 text-center">
            Note: The right side of the spectrogram represents high frequencies (Ultrasound range).
            <br/>Raw audio constraints have been applied for sonar accuracy.
          </p>
        </div>
      )}
    </main>
  );
}
