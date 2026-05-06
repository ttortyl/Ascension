import { useState, useEffect, useRef } from "react";

type AuditReport = {
  passed: boolean;
  reasoning: string;
  adjusted_response: string | null;
};

type KernelEvent = 
  | { type: "Thought", payload: string }
  | { type: "SystemLog", payload: string }
  | { type: "ModelStatus", payload: { model: string, status: string } }
  | { type: "JusticeAudit", payload: AuditReport }
  | { type: "SentryFrame", payload: { frame: string, motion_detected: bool } };

function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [kernelStatus, setKernelStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [logs, setLogs] = useState<{ id: number, text: string, type: string, passed?: boolean }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<"gemini" | "ollama">("gemini");
  const [sentryFrame, setSentryFrame] = useState<string | null>(null);
  const [motionDetected, setMotionDetected] = useState(false);
  
  const ws = useRef<WebSocket | null>(null);
  const logIdCounter = useRef(0);

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

    checkKernel();
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

          let logText = "";
          let type = "system";
          let passed = undefined;

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
          }

          setLogs((prev) => {
            const newLog = { id: logIdCounter.current++, text: logText, type, passed };
            return [...prev.slice(-12), newLog];
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
      
      {/* Top Status Bar */}
      <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-10 flex items-center justify-between px-6 cursor-default z-50 bg-black/40 backdrop-blur-md border-b border-ascension-purple/20">
        <div className="flex items-center gap-3">
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
          <div className="w-10 h-10 rounded bg-ascension-pink/10 border border-ascension-pink/30 flex items-center justify-center text-ascension-pink shadow-lg shadow-ascension-pink/10 cursor-pointer hover:bg-ascension-pink/20 transition-all group">
            <span className="text-xl font-bold group-hover:scale-110 transition-transform">A</span>
          </div>
          <div className="space-y-6 opacity-40">
            <div title="Dashboard" className="w-6 h-6 border-2 border-ascension-purple rounded rotate-45 hover:opacity-100 transition-opacity cursor-pointer" />
            <div title="Sentry" className="w-6 h-6 border-2 border-ascension-cyan rounded-full hover:opacity-100 transition-opacity cursor-pointer" />
            <div title="Judicial Ledger" className="w-6 h-6 border-2 border-ascension-magenta rounded hover:opacity-100 transition-opacity cursor-pointer" />
          </div>
        </div>

        {/* Main Interface */}
        <div className="flex-1 flex flex-col gap-6">
          
          {/* Output Terminal */}
          <div className="flex-1 p-8 rounded-xl border border-ascension-purple/30 bg-black/60 backdrop-blur-xl shadow-2xl shadow-ascension-magenta/5 flex flex-col relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-ascension-pink/30 to-transparent" />
            
            <div className="flex-1 bg-black/40 rounded-lg border border-ascension-purple/10 p-6 font-mono text-sm overflow-y-auto custom-scrollbar relative">
              {response ? (
                <div className="whitespace-pre-wrap text-ascension-cyan leading-relaxed animate-in slide-in-from-bottom-2 duration-700 text-glow-cyan">
                  {response}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full opacity-20 select-none">
                  <h2 className="text-5xl font-black tracking-tighter italic uppercase">ASCENSION</h2>
                  <p className="text-xs tracking-[0.5em] mt-2 uppercase">Neural Link Awaiting Command</p>
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
                  placeholder="INPUT COMMAND >"
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
            
            <div className="flex-1 font-mono text-[9px] space-y-4 overflow-hidden relative">
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
                    "border-ascension-purple text-ascension-purple/80"
                  }`}
                >
                  <p className="leading-relaxed break-words font-bold uppercase mb-0.5 text-[8px] opacity-70">
                    {log.type} // {log.type === 'justice' ? (log.passed ? 'VERIFIED' : 'FAILED') : 'INFO'}
                  </p>
                  <p className="leading-relaxed break-words">{log.text}</p>
                </div>
              ))}
              <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
            </div>
          </div>

          {/* Sentry Feed */}
          <div className={`h-48 p-1 rounded-xl border-2 transition-all duration-300 bg-black/40 backdrop-blur-md flex flex-col relative group overflow-hidden ${motionDetected ? 'border-red-500 glow-magenta' : 'border-ascension-purple/20'}`}>
            <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/60 border border-white/10 z-20">
              <div className={`w-1.5 h-1.5 rounded-full ${motionDetected ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
              <span className={`text-[8px] font-black uppercase tracking-widest ${motionDetected ? 'text-red-500' : 'text-green-500'}`}>
                {motionDetected ? 'MOTION DETECTED' : 'SENTRY ACTIVE'}
              </span>
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
                   <span className="text-[10px] font-mono tracking-widest uppercase italic">Initializing Eyes...</span>
                </div>
              )}
              {/* Scanline overlay for sentry specifically */}
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
    </main>
  );
}

export default App;
