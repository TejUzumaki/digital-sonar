'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eraser, PenTool, Power, Settings, Trash2, Camera } from 'lucide-react';
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export default function Home() {
  const [isEngineActive, setIsEngineActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [strokeColor, setStrokeColor] = useState('#00f3ff');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [logs, setLogs] = useState<string[]>([]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Calibration Refs (Mapping physical paper to digital screen)
  const calibrationPointsRef = useRef<{x: number, y: number}[]>([]);
  const homographyMatrixRef = useRef<number[] | null>(null);
  
  // Drawing State
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{x: number, y: number} | null>(null);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev.slice(-10), `[${timestamp}] ${message}`]);
  }, []);

  // Initialize MediaPipe
  const initEngine = async () => {
    try {
      addLog("System: Loading MediaPipe Vision...");
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
      handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
      });
      addLog("System: Vision model loaded. Starting camera...");
      
      // Start Camera
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsEngineActive(true);
      addLog("System: Camera active. Ready to calibrate.");
      startCalibration();
    } catch (err) {
      addLog("System: FATAL ERROR - Camera/Vision init failed.");
      console.error(err);
    }
  };

  const stopEngine = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    }
    handLandmarkerRef.current = null;
    setIsEngineActive(false);
    setIsCalibrating(false);
    addLog("System: Engine deactivated.");
  };

  const startCalibration = () => {
    setIsCalibrating(true);
    calibrationPointsRef.current = [];
    homographyMatrixRef.current = null;
    addLog("Calibration: Tap the 4 corners of your paper on the video feed.");
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCalibrating || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const y = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);
    
    calibrationPointsRef.current.push({ x, y });
    
    if (calibrationPointsRef.current.length === 4) {
      // For V1, we will use a simple bounding box mapping instead of full homography to keep it fast
      const pts = calibrationPointsRef.current;
      const minX = Math.min(pts[0].x, pts[1].x, pts[2].x, pts[3].x);
      const maxX = Math.max(pts[0].x, pts[1].x, pts[2].x, pts[3].x);
      const minY = Math.min(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
      const maxY = Math.max(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
      homographyMatrixRef.current = [minX, maxX, minY, maxY];
      
      setIsCalibrating(false);
      addLog("Calibration: Complete. Tracking pen tip (Index Finger).");
      startTracking();
    }
  };

  const startTracking = () => {
    if (!handLandmarkerRef.current || !videoRef.current || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      if (!handLandmarkerRef.current || !videoRef.current || !canvasRef.current) return;
      
      const video = videoRef.current;
      if (video.currentTime > 0) {
        const results = handLandmarkerRef.current.detectForVideo(video, performance.now());
        
        // Clear overlay (not the drawing canvas, just the video overlay)
        // In V1, we draw directly on the video for simplicity
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw calibration box if active
        if (homographyMatrixRef.current) {
          const [minX, maxX, minY, maxY] = homographyMatrixRef.current;
          ctx.strokeStyle = 'rgba(0, 243, 255, 0.3)';
          ctx.lineWidth = 2;
          ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        }

        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];
          // Landmark 8 is the Index Finger Tip
          const indexTip = landmarks[8];
          const indexPip = landmarks[6]; // Used to check if finger is extended
          
          const x = indexTip.x * canvas.width;
          const y = indexTip.y * canvas.height;
          
          // Check if pen is "down" (index finger extended and thumb pinching)
          // For V1, we simulate pen down by just checking if finger is extended
          const isPenDown = indexTip.y < indexPip.y; 

          // Map to calibration box
          if (homographyMatrixRef.current) {
            const [minX, maxX, minY, maxY] = homographyMatrixRef.current;
            if (x > minX && x < maxX && y > minY && y < maxY) {
              
              // Draw cursor
              ctx.beginPath();
              ctx.arc(x, y, 5, 0, Math.PI * 2);
              ctx.fillStyle = isPenDown ? strokeColor : 'gray';
              ctx.fill();

              // Draw line
              if (isPenDown) {
                if (isDrawingRef.current && lastPointRef.current) {
                  ctx.beginPath();
                  ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
                  ctx.lineTo(x, y);
                  ctx.strokeStyle = strokeColor;
                  ctx.lineWidth = strokeWidth;
                  ctx.lineCap = 'round';
                  ctx.lineJoin = 'round';
                  ctx.stroke();
                }
                isDrawingRef.current = true;
                lastPointRef.current = { x, y };
              } else {
                isDrawingRef.current = false;
                lastPointRef.current = null;
              }
            } else {
              isDrawingRef.current = false;
              lastPointRef.current = null;
            }
          }
        } else {
          isDrawingRef.current = false;
          lastPointRef.current = null;
        }
      }
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const clearCanvas = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      addLog("System: Canvas cleared.");
    }
  };

  useEffect(() => () => stopEngine(), []);

  return (
    <main className="relative min-h-screen bg-[#0a0a0a] text-white font-mono overflow-hidden flex flex-col items-center justify-center p-4">
      
      <header className="mb-4 text-center">
        <h1 className="text-2xl font-bold text-cyan-400 tracking-widest">VIRTUAL DIGITIZER</h1>
        <p className="text-gray-600 text-xs tracking-wide">CAMERA + CV TRACKING V1.0</p>
      </header>

      <div className="relative w-full max-w-4xl aspect-video bg-black border border-cyan-500/20 rounded-lg overflow-hidden">
        {/* Hidden Video Feed */}
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" playsInline />
        
        {/* Drawing Canvas Overlay */}
        <canvas 
          ref={canvasRef} 
          width={1280} 
          height={720} 
          className="absolute inset-0 w-full h-full cursor-crosshair"
          onClick={handleCanvasClick}
        />
        
        {!isEngineActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <button onClick={initEngine} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 px-8 rounded-lg flex items-center gap-2">
              <Camera size={20} /> ACTIVATE CAMERA
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap gap-4 items-center justify-center">
        <button onClick={clearCanvas} disabled={!isEngineActive} className="hud-clip-sm bg-red-600/80 hover:bg-red-500 text-white px-4 py-2 rounded flex items-center gap-2 text-sm disabled:opacity-50">
          <Trash2 size={16} /> CLEAR
        </button>
        <button onClick={startCalibration} disabled={!isEngineActive || isCalibrating} className="hud-clip-sm bg-yellow-500/80 hover:bg-yellow-400 text-black px-4 py-2 rounded flex items-center gap-2 text-sm disabled:opacity-50">
          <Settings size={16} /> CALIBRATE PAPER
        </button>
        
        <div className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded">
          <PenTool size={16} className="text-cyan-400" />
          <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} className="w-6 h-6 bg-transparent cursor-pointer" />
          <input type="range" min="1" max="10" value={strokeWidth} onChange={(e) => setStrokeWidth(parseInt(e.target.value))} className="accent-cyan-500" />
        </div>

        {isEngineActive && (
          <button onClick={stopEngine} className="hud-clip-sm bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded flex items-center gap-2 text-sm">
            <Power size={16} /> STOP
          </button>
        )}
      </div>

      {/* Logs */}
      <div className="mt-4 w-full max-w-4xl bg-gray-900/50 p-2 rounded h-24 overflow-y-auto text-xs text-gray-500">
        {logs.map((log, i) => <div key={i}>{log}</div>)}
      </div>
    </main>
  );
}
