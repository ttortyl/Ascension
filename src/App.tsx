import { useState, useEffect, useRef, useMemo } from "react";

type AuditReport = {
  passed: boolean;
  reasoning: string;
  adjusted_response: string | null;
};

type CommandResult = {
  success: boolean;
  stdout: string;
  stderr: string;
};

type ProjectNode = {
  name: string;
  path: string;
  is_dir: boolean;
  children: ProjectNode[];
};

type VisualNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  is_dir: boolean;
  depth: number;
};

type VisualLink = {
  source: string;
  target: string;
};

type KernelEvent = 
  | { type: "Thought", payload: string }
  | { type: "SystemLog", payload: string }
  | { type: "ModelStatus", payload: { model: string, status: string } }
  | { type: "JusticeAudit", payload: AuditReport }
  | { type: "SentryFrame", payload: { frame: string, motion_detected: bool } }
  | { type: "AudioStatus", payload: { level: number, noise_detected: bool } }
  | { type: "CommandOutput", payload: CommandResult }
  | { type: "GraphUpdate", payload: ProjectNode };

function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [kernelStatus, setKernelStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [logs, setLogs] = useState<{ id: number, text: string, type: string, passed?: boolean, success?: boolean }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<"gemini" | "ollama">("gemini");
  const [sentryFrame, setSentryFrame] = useState<string | null>(null);
  const [motionDetected, setMotionDetected] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [noiseDetected, setNoiseDetected] = useState(false);
  const [projectGraph, setProjectGraph] = useState<ProjectNode | null>(null);
  const [activeTab, setActiveTab] = useState<"terminal" | "sentry" | "graph" | "archives">("terminal");
  const [archives, setArchives] = useState<string[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  const logIdCounter = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);

  // --- Recording Logic ---
  useEffect(() => {
    if ((motionDetected || noiseDetected) && !isRecordingRef.current) {
      startRecording();
    }
  }, [motionDetected, noiseDetected]);

  function startRecording() {
    if (!canvasRef.current || isRecordingRef.current) return;
    
    const stream = canvasRef.current.captureStream(10); // 10 fps
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      chunksRef.current = [];
      const formData = new FormData();
      formData.append('video', blob, `sentry_${Date.now()}.webm`);
      
      try {
        await fetch("http://localhost:7338/archive", {
          method: "POST",
          body: formData,
        });
        setLogs(prev => [...prev, { id: logIdCounter.current++, text: "[SYS] Sentry Clip Archived", type: "system" }]);
      } catch (err) {
        console.error("Failed to archive video", err);
      }
    };

    recorder.start();
    isRecordingRef.current = true;
    mediaRecorderRef.current = recorder;

    // Record for 10 seconds
    setTimeout(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
        isRecordingRef.current = false;
      }
    }, 10000);
  }

  // Draw frame to canvas for recording
  useEffect(() => {
    if (sentryFrame && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      const img = new Image();
      img.onload = () => {
        ctx?.drawImage(img, 0, 0, 320, 240);
      };
      img.src = `data:image/jpeg;base64,${sentryFrame}`;
    }
  }, [sentryFrame]);

  // --- Visual Graph Logic ---
  const visualData = useMemo(() => {
    if (!projectGraph) return { nodes: [], links: [] };

    const nodes: VisualNode[] = [];
    const links: VisualLink[] = [];
    const centerX = 400;
    const centerY = 300;

    const traverse = (node: ProjectNode, parentX: number, parentY: number, depth: number, angleStart: number, angleEnd: number) => {
      const id = node.path;
      const radius = depth * 120;
      const angle = (angleStart + angleEnd) / 2;
      
      const x = depth === 0 ? centerX : centerX + radius * Math.cos(angle);
      const y = depth === 0 ? centerY : centerY + radius * Math.sin(angle);

      nodes.push({ id, name: node.name, x, y, is_dir: node.is_dir, depth });

      if (node.children) {
        const childCount = node.children.length;
        const angleStep = (angleEnd - angleStart) / Math.max(childCount, 1);
        
        node.children.forEach((child, i) => {
          const childAngleStart = angleStart + i * angleStep;
          const childAngleEnd = childAngleStart + angleStep;
          links.push({ source: id, target: child.path });
          traverse(child, x, y, depth + 1, childAngleStart, childAngleEnd);
        });
      }
    };

    traverse(projectGraph, centerX, centerY, 0, 0, Math.PI * 2);
    return { nodes, links };
  }, [projectGraph]);

  useEffect(() => {
    const checkKernel = async () => {
      try {
        const response = await fetch("http://localhost:7338/heartbeat");
        if (response.ok) {
          setKernelStatus("online");
        } else {
          setKernelStatus("offline");
        }
      } catch (err) {
        setKernelStatus("offline");
      }
    };

    const fetchGraph = async () => {
      try {
        const res = await fetch("http://localhost:7338/graph");
        const data = await res.json();
        setProjectGraph(data);
      } catch (err) {
        console.error("Failed to fetch graph", err);
      }
    };

    checkKernel();
    fetchGraph();
    const interval = setInterval(checkKernel, 5000);

    const connectWS = () => {
      ws.current = new WebSocket("ws://localhost:7338/ws");
      ws.current.onmessage = (event) => {
        try {
          const data: KernelEvent = JSON.parse(event.data);
          
          if (data.type === "SentryFrame") {
            setSentryFrame(data.payload.frame);
            setMotionDetected(data.payload.motion_detected);
            return;
          }

          if (data.type === "AudioStatus") {
            setAudioLevel(data.payload.level);
            setNoiseDetected(data.payload.noise_detected);
            return;
          }

          if (data.type === "GraphUpdate") {
            setProjectGraph(data.payload);
            return;
          }

          let logText = "";
          let type = "system";
          let passed = undefined;
          let success = undefined;

          if (data.type === "SystemLog") {
            logText = `[SYS] ${data.payload}`;
            type = "system";
          } else if (data.type === "Thought") {
            logText = `[THOUGHT] ${data.payload}`;
            type = "thought";
          } else if (data.type === "ModelStatus") {
            logText = `[MODEL] ${data.model}: ${data.status}`;
            type = "model";
          } else if (data.type === "JusticeAudit") {
            logText = `[JUSTICE] ${data.payload.passed ? 'PASSED' : 'FAILED'}: ${data.payload.reasoning}`;
            type = "justice";
            passed = data.payload.passed;
          } else if (data.type === "CommandOutput") {
            logText = `[SHELL] ${data.payload.success ? 'SUCCESS' : 'FAILED'}: ${data.payload.stdout || data.payload.stderr}`;
            type = "shell";
            success = data.payload.success;
          }

          setLogs((prev) => {
            const newLog = { id: logIdCounter.current++, text: logText, type, passed, success };
            return [...prev.slice(-15), newLog];
          });
        } catch (err) {
          console.error("Failed to parse WS message", err);
        }
      };
      ws.current.onclose = () => setTimeout(connectWS, 3000);
    };

    connectWS();

    return () => {
      clearInterval(interval);
      ws.current?.close();
    };
  }, []);

  async function handleSubmit() {
    if (!prompt) return;
    
    if (prompt.startsWith(">")) {
      const cmd = prompt.slice(1).trim();
      setPrompt("");
      setIsProcessing(true);
      try {
        await fetch("http://localhost:7338/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd }),
        });
      } catch (err) {
        setLogs((prev) => [...prev, { id: logIdCounter.current++, text: "[ERR] Failed to execute", type: "system" }]);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    setIsProcessing(true);
    setResponse("");

    try {
      const res = await fetch("http://localhost:7338/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: selectedModel }),
      });
      const data = await res.json();
      if (data.response) {
        setResponse(data.response);
      } else if (data.error) {
        setResponse(`Error: ${data.error}`);
      }
    } catch (err) {
      setResponse("Failed to connect to Kernel");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-ascension-bg text-ascension-pink font-sans selection:bg-ascension-magenta selection:text-white overflow-hidden scanlines crt-flicker">
      
      {/* Custom Resize Handles */}
      <div className="fixed top-0 left-0 w-1 h-full cursor-nw-resize z-[100]" />
      <div className="fixed top-0 right-0 w-1 h-full cursor-ne-resize z-[100]" />
      <div className="fixed bottom-0 left-0 w-full h-1 cursor-s-resize z-[100]" />
      <div className="fixed bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-[100] flex items-end justify-end p-0.5">
         <div className="w-1.5 h-1.5 border-r border-b border-ascension-pink/40" />
      </div>

      {/* Top Status Bar (Drag Region) */}
      <div className="fixed top-0 left-0 right-0 h-10 flex items-center justify-between px-6 z-50 bg-black/40 backdrop-blur-md border-b border-ascension-purple/20">
        <div data-tauri-drag-region className="absolute inset-0 cursor-move" />
        <div className="flex items-center gap-3 relative z-10 pointer-events-none">
          <div className="flex gap-1.5">
            <div className={`w-2 h-2 rounded-full shadow-[0_0_8px] ${kernelStatus === "online" ? "bg-ascension-pink shadow-ascension-pink animate-pulse" : "bg-red-500 shadow-red-500"}`} />
            <div className="w-2 h-2 rounded-full bg-ascension-purple opacity-30" />
            <div className="w-2 h-2 rounded-full bg-ascension-cyan opacity-30" />
          </div>
          <span className="text-[10px] font-bold font-mono uppercase tracking-[0.3em] text-glow-pink text-nowrap">
            Ascension Kernel v0.1.0 // {kernelStatus === "online" ? "SYSTEM STABLE" : "KERNEL OFFLINE"}
          </span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex gap-4 text-[9px] font-mono uppercase tracking-widest text-ascension-purple/60 hidden md:flex">
            <span>MEM: 42%</span>
            <span>CPU: 12%</span>
            <span>NET: ENCRYPTED</span>
          </div>
          <div className="h-4 w-px bg-ascension-purple/20 hidden md:block" />
          <span className="text-[10px] font-bold text-ascension-cyan text-glow-cyan uppercase text-nowrap">
            {selectedModel.toUpperCase()} ACTIVE
          </span>
        </div>
      </div>

      <div className="flex gap-8 w-full max-w-[1400px] px-10 h-[700px] mt-12 relative z-10">
        
        {/* Navigation Sidebar */}
        <div className="w-16 flex flex-col items-center py-6 gap-8 border-r border-ascension-purple/10">
          <div 
            onClick={() => setActiveTab("terminal")}
            className={`w-10 h-10 rounded flex items-center justify-center text-xl font-bold cursor-pointer transition-all group ${activeTab === 'terminal' ? 'bg-ascension-pink/20 border border-ascension-pink/50 text-ascension-pink shadow-lg shadow-ascension-pink/10' : 'text-ascension-purple/40 hover:text-ascension-pink hover:bg-ascension-pink/5'}`}
          >
            <span>A</span>
          </div>
          <div className="space-y-6">
            <div 
              title="Dashboard" 
              onClick={() => setActiveTab("terminal")}
              className={`w-6 h-6 border-2 rounded rotate-45 transition-all cursor-pointer ${activeTab === 'terminal' ? 'border-ascension-pink' : 'border-ascension-purple/30 opacity-40 hover:opacity-100'}`} 
            />
            <div 
              title="Sentry" 
              onClick={() => setActiveTab("sentry")}
              className={`w-6 h-6 border-2 rounded-full transition-all cursor-pointer ${activeTab === 'sentry' ? 'border-ascension-cyan' : 'border-ascension-purple/30 opacity-40 hover:opacity-100'}`} 
            />
            <div 
              title="Knowledge Graph" 
              onClick={() => setActiveTab("graph")}
              className={`w-6 h-6 border-2 rounded transition-all cursor-pointer ${activeTab === 'graph' ? 'border-ascension-magenta' : 'border-ascension-purple/30 opacity-40 hover:opacity-100'}`} 
            />
            <div 
              title="Archives" 
              onClick={async () => {
                setActiveTab("archives");
                try {
                  const res = await fetch("http://localhost:7338/list_archives");
                  const data = await res.json();
                  setArchives(data);
                } catch (err) {
                  console.error("Failed to fetch archives", err);
                }
              }}
              className={`w-6 h-6 border-2 rounded-sm transition-all cursor-pointer ${activeTab === 'archives' ? 'border-ascension-pink' : 'border-ascension-purple/30 opacity-40 hover:opacity-100'}`} 
            >
              <div className="w-full h-full flex flex-col gap-0.5 p-1">
                <div className="w-full h-px bg-current" />
                <div className="w-full h-px bg-current" />
              </div>
            </div>
          </div>
        </div>

        {/* Main Interface */}
        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          
          {activeTab === "archives" && (
            <div className="flex-1 p-8 rounded-xl border border-ascension-pink/30 bg-black/60 backdrop-blur-xl shadow-2xl flex flex-col relative overflow-hidden animate-in fade-in duration-500">
               <div className="flex justify-between items-center mb-6">
                 <h2 className="text-xl font-black text-ascension-pink tracking-widest uppercase">Video Archives</h2>
                 <span className="text-[10px] font-mono text-ascension-purple/60 uppercase">Sentry Evidence Logs</span>
               </div>
               
               <div className="flex-1 grid grid-cols-3 gap-6 overflow-y-auto custom-scrollbar pr-2">
                 {archives.length === 0 && (
                   <div className="col-span-3 flex items-center justify-center h-full opacity-20 italic">No evidence recorded yet...</div>
                 )}
                 {archives.map((video) => (
                   <div 
                     key={video}
                     onClick={() => setSelectedVideo(video)}
                     className={`group p-4 rounded border transition-all cursor-pointer ${selectedVideo === video ? 'border-ascension-pink bg-ascension-pink/10 shadow-lg shadow-ascension-pink/10' : 'border-ascension-purple/10 bg-black/40 hover:border-ascension-pink/40'}`}
                   >
                     <div className="aspect-video bg-black/60 rounded mb-3 flex items-center justify-center overflow-hidden border border-white/5 relative">
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <span className="text-[24px] group-hover:scale-125 transition-transform">▶</span>
                     </div>
                     <p className="text-[10px] font-mono text-ascension-purple group-hover:text-ascension-pink truncate uppercase">
                       {video.replace('.webm', '').replace('sentry_', '')}
                     </p>
                   </div>
                 ))}
               </div>

               {selectedVideo && (
                 <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-12 animate-in fade-in duration-300">
                    <div className="w-full max-w-[1000px] flex flex-col gap-4">
                       <div className="flex justify-between items-center">
                          <h3 className="text-ascension-pink font-black uppercase tracking-widest">{selectedVideo}</h3>
                          <button 
                            onClick={() => setSelectedVideo(null)}
                            className="text-ascension-purple hover:text-white uppercase font-black text-xs"
                          >
                            [ CLOSE ]
                          </button>
                       </div>
                       <video 
                         src={`http://localhost:7338/archives_stream/${selectedVideo}`} 
                         controls 
                         autoPlay 
                         className="w-full rounded-lg border-2 border-ascension-pink/30 shadow-2xl shadow-ascension-pink/20"
                       />
                    </div>
                 </div>
               )}
            </div>
          )}
          {activeTab === "terminal" && (
            <div className="flex-1 p-8 rounded-xl border border-ascension-purple/30 bg-black/60 backdrop-blur-xl shadow-2xl shadow-ascension-magenta/5 flex flex-col relative overflow-hidden group animate-in fade-in duration-500">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-ascension-pink/30 to-transparent" />
              
              <div className="flex-1 bg-black/40 rounded-lg border border-ascension-purple/10 p-6 font-mono text-sm overflow-y-auto custom-scrollbar relative">
                {response ? (
                  <div className="whitespace-pre-wrap text-ascension-cyan leading-relaxed animate-in slide-in-from-bottom-2 duration-700 text-glow-cyan">
                    {response}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full opacity-20 select-none">
                    <h2 className="text-5xl font-black tracking-tighter italic uppercase text-glow-pink">ASCENSION</h2>
                    <p className="text-[10px] tracking-[0.5em] mt-2 uppercase text-ascension-purple">Neural Link Awaiting Command</p>
                    <p className="text-[8px] mt-4 opacity-50 font-mono">Prefix with '&gt;' to execute shell commands</p>
                  </div>
                )}
              </div>

              {/* Input Bar */}
              <div className="mt-6 flex gap-4">
                <div className="relative group/select">
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as any)}
                    className="appearance-none bg-ascension-bg border border-ascension-purple/40 h-14 px-6 pr-10 rounded-lg text-ascension-pink focus:outline-none focus:border-ascension-pink transition-all text-xs uppercase font-black tracking-widest cursor-pointer hover:bg-ascension-purple/5"
                    disabled={isProcessing}
                  >
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-ascension-purple/40 text-[8px]">▼</div>
                </div>

                <div className="flex-1 relative">
                  <input
                    className="w-full bg-ascension-bg border border-ascension-purple/40 h-14 px-6 rounded-lg text-ascension-cyan focus:outline-none focus:border-ascension-pink transition-all placeholder:text-ascension-purple/30 font-mono text-lg shadow-inner"
                    value={prompt}
                    onChange={(e) => setPrompt(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    placeholder={prompt.startsWith(">") ? "ENTER SHELL COMMAND..." : "INPUT COMMAND >"}
                    disabled={isProcessing}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ascension-purple/20">CTRL + ENTER</div>
                </div>

                <button 
                  onClick={handleSubmit}
                  disabled={isProcessing || !prompt}
                  className={`bg-ascension-pink hover:bg-ascension-magenta text-ascension-bg font-black px-10 rounded-lg transition-all active:scale-95 shadow-xl shadow-ascension-pink/20 uppercase tracking-widest min-w-[140px] ${isProcessing ? 'opacity-50 animate-pulse' : ''}`}
                >
                  {isProcessing ? "PROCESSING" : "EXECUTE"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "graph" && (
            <div className="flex-1 p-8 rounded-xl border border-ascension-magenta/30 bg-black/60 backdrop-blur-xl shadow-2xl flex flex-col relative overflow-hidden animate-in zoom-in-95 duration-500">
               <div className="flex justify-between items-center mb-6">
                 <h2 className="text-xl font-black text-ascension-magenta tracking-widest uppercase">Neural Memory Map</h2>
                 <span className="text-[10px] font-mono text-ascension-purple/60">PROJECT SYNAPSE VIEW</span>
               </div>
               
               <div className="flex-1 relative bg-black/40 rounded-lg border border-ascension-magenta/10 overflow-hidden cursor-crosshair">
                 {visualData.nodes.length > 0 ? (
                   <svg width="100%" height="100%" viewBox="0 0 800 600" className="animate-in fade-in duration-1000">
                     {/* Draw Links (Synapses) */}
                     {visualData.links.map((link, i) => {
                       const source = visualData.nodes.find(n => n.id === link.source);
                       const target = visualData.nodes.find(n => n.id === link.target);
                       if (!source || !target) return null;
                       return (
                         <line 
                           key={i}
                           x1={source.x} y1={source.y}
                           x2={target.x} y2={target.y}
                           stroke="#bd93f9"
                           strokeWidth="0.5"
                           strokeOpacity="0.3"
                           className="animate-pulse"
                         />
                       );
                     })}

                     {/* Draw Nodes */}
                     {visualData.nodes.map((node) => (
                       <g key={node.id} transform={`translate(${node.x},${node.y})`} className="group">
                         <circle 
                           r={node.depth === 0 ? 8 : node.is_dir ? 5 : 3}
                           fill={node.depth === 0 ? "#d600ff" : node.is_dir ? "#bd93f9" : "#8be9fd"}
                           className={`${node.is_dir ? 'animate-pulse' : ''} group-hover:scale-150 transition-transform duration-300`}
                           style={{ filter: `blur(${node.depth === 0 ? '2px' : '0px'})` }}
                         />
                         <circle 
                           r={node.depth === 0 ? 12 : node.is_dir ? 8 : 5}
                           fill="transparent"
                           stroke={node.depth === 0 ? "#d600ff" : node.is_dir ? "#bd93f9" : "#8be9fd"}
                           strokeWidth="0.5"
                           strokeOpacity="0.2"
                         />
                         <text 
                           y="-12"
                           textAnchor="middle"
                           fill="white"
                           fontSize="8"
                           className="font-mono opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none uppercase tracking-tighter"
                         >
                           {node.name}
                         </text>
                       </g>
                     ))}
                   </svg>
                 ) : (
                   <div className="flex items-center justify-center h-full opacity-20 italic">Initializing Memory Synapses...</div>
                 )}
                 
                 {/* Decorative background grid */}
                 <div className="absolute inset-0 pointer-events-none opacity-5 bg-[radial-gradient(#bd93f9_1px,transparent_1px)] bg-[size:40px_40px]" />
               </div>
            </div>
          )}

          {activeTab === "sentry" && (
            <div className="flex-1 p-8 rounded-xl border border-ascension-cyan/30 bg-black/60 backdrop-blur-xl shadow-2xl flex flex-col relative overflow-hidden animate-in slide-in-from-top-4 duration-500">
               <div className="flex justify-between items-center mb-6">
                 <h2 className="text-xl font-black text-ascension-cyan tracking-widest uppercase">Sentry Command Center</h2>
                 <div className="flex gap-4">
                    <div className="px-3 py-1 rounded bg-black/40 border border-ascension-purple/20 flex items-center gap-3">
                        <span className="text-[8px] font-mono text-ascension-purple uppercase">Audio DB:</span>
                        <div className="w-24 h-1.5 bg-black/60 rounded-full overflow-hidden border border-white/5">
                            <div className="h-full bg-ascension-cyan transition-all duration-75" style={{ width: `${Math.min(audioLevel * 400, 100)}%` }} />
                        </div>
                    </div>
                    <div className={`px-3 py-1 rounded border ${noiseDetected ? 'bg-orange-500/20 border-orange-500/40 text-orange-400' : 'bg-black/40 border-ascension-purple/20 text-ascension-purple/40'}`}>
                      <span className="text-[10px] font-black uppercase">Noise Sense</span>
                    </div>
                    <div className="px-3 py-1 rounded bg-red-500/20 border border-red-500/40">
                      <span className="text-[10px] font-black text-red-500 uppercase">Live Feed</span>
                    </div>
                 </div>
               </div>
               <div className="flex-1 bg-black/40 rounded-lg border border-ascension-cyan/10 overflow-hidden relative">
                 {sentryFrame ? (
                   <img src={`data:image/jpeg;base64,${sentryFrame}`} className="w-full h-full object-contain" alt="Sentry Full" />
                 ) : (
                   <div className="flex items-center justify-center h-full opacity-20">Awaiting Signal...</div>
                 )}
                 <div className="absolute inset-0 pointer-events-none border-2 border-ascension-cyan/20 m-4" />
                 <div className="absolute top-8 left-8 text-[10px] font-mono text-ascension-cyan/60 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    REC [00:00:00:00]
                 </div>
               </div>
            </div>
          )}
        </div>

        {/* Neural Feed Sidebar */}
        <div className="w-[340px] flex flex-col gap-6">
          <div className="flex-1 p-6 rounded-xl border border-ascension-purple/20 bg-black/40 backdrop-blur-md flex flex-col relative overflow-hidden">
            <h2 className="text-[10px] font-black text-ascension-purple uppercase tracking-[0.4em] mb-6 flex justify-between items-center border-b border-ascension-purple/10 pb-4">
              Neural Feed
              <div className="flex gap-1">
                <div className="w-1 h-1 bg-ascension-cyan rounded-full animate-ping" />
                <div className="w-1 h-1 bg-ascension-cyan rounded-full" />
              </div>
            </h2>
            
            <div className="flex-1 font-mono text-[9px] space-y-4 overflow-y-auto custom-scrollbar relative">
              {logs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full opacity-10 italic">
                  <span>Stream Offline</span>
                </div>
              )}
              {logs.map((log) => (
                <div 
                  key={log.id} 
                  className={`border-l-2 pl-3 py-1 transition-all animate-in slide-in-from-right-4 duration-300 ${
                    log.type === "thought" ? "border-ascension-pink bg-ascension-pink/5 text-ascension-pink" :
                    log.type === "model" ? "border-ascension-cyan bg-ascension-cyan/5 text-ascension-cyan" :
                    log.type === "justice" ? (log.passed ? "border-green-500 bg-green-500/5 text-green-400" : "border-red-500 bg-red-500/5 text-red-400") :
                    log.type === "shell" ? (log.success ? "border-cyan-400 bg-cyan-400/5 text-cyan-300" : "border-orange-500 bg-orange-500/5 text-orange-400") :
                    "border-ascension-purple text-ascension-purple/80"
                  }`}
                >
                  <p className="leading-relaxed break-words font-bold uppercase mb-0.5 text-[8px] opacity-70">
                    {log.type} // {log.type === 'justice' ? (log.passed ? 'VERIFIED' : 'FAILED') : log.type === 'shell' ? (log.success ? 'EXECUTED' : 'EXIT_ERR') : 'INFO'}
                  </p>
                  <p className="leading-relaxed break-words whitespace-pre-wrap">{log.text}</p>
                </div>
              ))}
              <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
            </div>
          </div>

          {/* Sentry Mini-Feed */}
          <div 
            onClick={() => setActiveTab("sentry")}
            className={`h-48 p-1 rounded-xl border-2 transition-all duration-300 bg-black/40 backdrop-blur-md flex flex-col relative group overflow-hidden cursor-pointer ${motionDetected || noiseDetected ? 'border-red-500 glow-magenta' : 'border-ascension-purple/20 hover:border-ascension-cyan/50'}`}>
            <div className="absolute top-2 right-2 flex flex-col gap-1 items-end z-20">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/60 border border-white/10">
                <div className={`w-1.5 h-1.5 rounded-full ${motionDetected ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                <span className={`text-[8px] font-black uppercase tracking-widest ${motionDetected ? 'text-red-500' : 'text-green-500'}`}>
                  {motionDetected ? 'MOTION' : 'EYES'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/60 border border-white/10">
                <div className={`w-1.5 h-1.5 rounded-full ${noiseDetected ? 'bg-red-500 animate-pulse' : 'bg-cyan-500'}`} />
                <span className={`text-[8px] font-black uppercase tracking-widest ${noiseDetected ? 'text-red-500' : 'text-cyan-500'}`}>
                  {noiseDetected ? 'NOISE' : 'EARS'}
                </span>
              </div>
            </div>
            
            <div className="flex-1 flex items-center justify-center relative overflow-hidden rounded-lg">
              {sentryFrame ? (
                <img 
                  src={`data:image/jpeg;base64,${sentryFrame}`} 
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity grayscale hover:grayscale-0 contrast-125 brightness-75"
                  alt="Sentry Feed"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 opacity-20">
                   <div className="w-8 h-8 border-2 border-t-ascension-pink border-transparent rounded-full animate-spin" />
                   <span className="text-[10px] font-mono tracking-widest uppercase italic">Initializing Sentry...</span>
                </div>
              )}
              {/* Audio visualizer bar in mini feed */}
              <div className="absolute bottom-0 left-0 w-full h-1 bg-black/40 overflow-hidden">
                 <div className="h-full bg-ascension-cyan" style={{ width: `${Math.min(audioLevel * 400, 100)}%` }} />
              </div>
              <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_2px]" />
            </div>
          </div>
        </div>
      </div>
      
      <footer className="fixed bottom-4 text-ascension-purple/30 text-[9px] font-mono uppercase tracking-[0.5em] flex gap-10 z-50">
        <span className="hover:text-ascension-pink transition-colors cursor-help">Judicial Audit: Active</span>
        <span className="hover:text-ascension-cyan transition-colors cursor-help">Supreme Mode: Enabled</span>
        <span className="hover:text-ascension-magenta transition-colors cursor-help">Session: 0xFF-7338</span>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #bd93f9;
          border-radius: 10px;
        }
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
      
      {/* Hidden recording canvas */}
      <canvas ref={canvasRef} width="320" height="240" className="hidden" />
    </main>
  );
}

export default App;
