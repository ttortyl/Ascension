import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type KernelEvent = 
  | { type: "Thought", payload: string }
  | { type: "SystemLog", payload: string }
  | { type: "ModelStatus", payload: { model: string, status: string } };

function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [kernelStatus, setKernelStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const ws = useRef<WebSocket | null>(null);

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
          if (data.type === "SystemLog") {
            setLogs((prev) => [...prev.slice(-9), `[SYS] ${data.payload}`]);
          } else if (data.type === "Thought") {
            setLogs((prev) => [...prev.slice(-9), `[THOUGHT] ${data.payload}`]);
          } else if (data.type === "ModelStatus") {
            setLogs((prev) => [...prev.slice(-9), `[MODEL] ${data.model}: ${data.status}`]);
          }
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
        body: JSON.stringify({ prompt }),
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
    <main className="flex flex-col items-center justify-center min-h-screen bg-ascension-bg text-ascension-pink font-sans selection:bg-ascension-magenta selection:text-white overflow-hidden">
      {/* Borderless Drag Region */}
      <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 flex items-center px-4 cursor-default z-50 bg-black/20 backdrop-blur-sm">
        <div className="flex gap-2">
          <div className={`w-2 h-2 rounded-full ${kernelStatus === "online" ? "bg-ascension-pink animate-pulse" : "bg-red-500"}`} />
          <div className="w-2 h-2 rounded-full bg-ascension-purple opacity-50" />
          <div className="w-2 h-2 rounded-full bg-ascension-cyan opacity-50" />
        </div>
        <span className="ml-4 text-[10px] font-mono uppercase tracking-[0.2em] opacity-40 select-none">
          Ascension Kernel v0.1.0 // {kernelStatus === "online" ? "System Stable" : "Kernel Offline"}
        </span>
      </div>

      <div className="flex gap-6 w-full max-w-6xl px-6 h-[600px] mt-8">
        {/* Main Interface Card */}
        <div className="p-8 rounded-lg border border-ascension-purple shadow-lg shadow-ascension-magenta/20 flex-1 bg-ascension-bg/80 backdrop-blur-sm flex flex-col">
          <h1 className="text-3xl font-bold mb-2 text-center tracking-tighter uppercase italic">
            Project Ascension
          </h1>
          <p className="text-ascension-purple text-center text-[10px] tracking-widest mb-6 uppercase opacity-60">
            Unified Multi-Brain interface
          </p>

          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 bg-black/30 rounded border border-ascension-purple/20 p-4 font-mono text-sm overflow-y-auto custom-scrollbar">
              {response ? (
                <div className="whitespace-pre-wrap text-ascension-cyan animate-in fade-in duration-500">
                  {response}
                </div>
              ) : (
                <div className="text-ascension-purple/30 italic">Awaiting kernel output...</div>
              )}
            </div>

            <div className="flex gap-3">
              <input
                className="flex-1 bg-ascension-bg border border-ascension-purple p-3 rounded text-ascension-cyan focus:outline-none focus:border-ascension-pink transition-colors placeholder:text-ascension-purple/50"
                value={prompt}
                onChange={(e) => setPrompt(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="Request command..."
                disabled={isProcessing}
              />
              <button 
                onClick={handleSubmit}
                disabled={isProcessing || !prompt}
                className={`bg-ascension-pink hover:bg-ascension-magenta text-ascension-bg font-bold px-6 rounded transition-all active:scale-95 shadow-md shadow-ascension-pink/30 ${isProcessing ? 'opacity-50 animate-pulse' : ''}`}
              >
                {isProcessing ? "PROCESSING" : "EXECUTE"}
              </button>
            </div>
          </div>
        </div>

        {/* System Logs Panel */}
        <div className="w-80 p-6 rounded-lg border border-ascension-purple/30 bg-black/40 backdrop-blur-md flex flex-col">
          <h2 className="text-xs font-bold text-ascension-purple uppercase tracking-widest mb-4 border-b border-ascension-purple/20 pb-2 flex justify-between">
            Neural Feed
            <span className="animate-pulse">●</span>
          </h2>
          <div className="flex-1 font-mono text-[10px] space-y-2 overflow-hidden">
            {logs.length === 0 && <p className="text-ascension-purple/20 italic">Awaiting stream...</p>}
            {logs.map((log, i) => (
              <p key={i} className="text-ascension-cyan/80 break-all leading-tight border-l border-ascension-pink/20 pl-2">
                {log}
              </p>
            ))}
          </div>
        </div>
      </div>
      
      <footer className="mt-8 text-ascension-purple/40 text-[10px] uppercase tracking-widest flex gap-4">
        <span>&copy; 2026 Gemini</span>
        <span className="opacity-20">|</span>
        <span>Secure Protocol 7338</span>
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
      `}</style>
    </main>
  );
}

export default App;
