import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type KernelEvent = 
  | { type: "Thought", payload: string }
  | { type: "SystemLog", payload: string }
  | { type: "ModelStatus", payload: { model: string, status: string } };

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [kernelStatus, setKernelStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [logs, setLogs] = useState<string[]>([]);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // 1. Polling for Heartbeat
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

    // 2. WebSocket Connection
    const connectWS = () => {
      ws.current = new WebSocket("ws://localhost:7338/ws");

      ws.current.onopen = () => {
        console.log("WebSocket Connected");
      };

      ws.current.onmessage = (event) => {
        try {
          const data: KernelEvent = JSON.parse(event.data);
          if (data.type === "SystemLog") {
            setLogs((prev) => [...prev.slice(-9), `[SYS] ${data.payload}`]);
          } else if (data.type === "Thought") {
            setLogs((prev) => [...prev.slice(-9), `[THOUGHT] ${data.payload}`]);
          }
        } catch (err) {
          console.error("Failed to parse WS message", err);
        }
      };

      ws.current.onclose = () => {
        console.log("WebSocket Disconnected. Retrying in 3s...");
        setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      clearInterval(interval);
      ws.current?.close();
    };
  }, []);

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-ascension-bg text-ascension-pink font-sans selection:bg-ascension-magenta selection:text-white">
      {/* Borderless Drag Region */}
      <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 flex items-center px-4 cursor-default z-50">
        <div className="flex gap-2">
          <div className={`w-2 h-2 rounded-full ${kernelStatus === "online" ? "bg-ascension-pink animate-pulse" : "bg-red-500"}`} />
          <div className="w-2 h-2 rounded-full bg-ascension-purple opacity-50" />
          <div className="w-2 h-2 rounded-full bg-ascension-cyan opacity-50" />
        </div>
        <span className="ml-4 text-[10px] font-mono uppercase tracking-[0.2em] opacity-40 select-none">
          Ascension Kernel v0.1.0 // {kernelStatus === "online" ? "System Stable" : "Kernel Offline"}
        </span>
      </div>

      <div className="flex gap-6 w-full max-w-5xl px-6 h-[500px]">
        {/* Main Interface Card */}
        <div className="p-8 rounded-lg border border-ascension-purple shadow-lg shadow-ascension-magenta/20 flex-1 bg-ascension-bg/80 backdrop-blur-sm flex flex-col justify-center">
          <h1 className="text-4xl font-bold mb-6 text-center tracking-tighter uppercase italic">
            Project Ascension
          </h1>

          <div className="space-y-4">
            <p className="text-ascension-purple text-center text-sm mb-8">
              Unified Kernel & Multi-Brain Interface
            </p>

            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                greet();
              }}
            >
              <input
                id="greet-input"
                className="bg-ascension-bg border border-ascension-purple p-3 rounded text-ascension-cyan focus:outline-none focus:border-ascension-pink transition-colors placeholder:text-ascension-purple/50"
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="Enter operator name..."
              />
              <button 
                type="submit"
                className="bg-ascension-pink hover:bg-ascension-magenta text-ascension-bg font-bold py-3 rounded transition-all active:scale-95 shadow-md shadow-ascension-pink/30"
              >
                INITIALIZE SESSION
              </button>
            </form>

            {greetMsg && (
              <div className="mt-6 p-4 border border-ascension-cyan/30 bg-ascension-cyan/5 rounded animate-pulse">
                <p className="text-ascension-cyan text-sm font-mono tracking-widest uppercase">
                  [SYSTEM]: {greetMsg}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* System Logs Panel */}
        <div className="w-80 p-6 rounded-lg border border-ascension-purple/30 bg-black/40 backdrop-blur-md flex flex-col">
          <h2 className="text-xs font-bold text-ascension-purple uppercase tracking-widest mb-4 border-b border-ascension-purple/20 pb-2">
            Neural Feed
          </h2>
          <div className="flex-1 font-mono text-[10px] space-y-2 overflow-hidden">
            {logs.length === 0 && <p className="text-ascension-purple/20">Awaiting stream...</p>}
            {logs.map((log, i) => (
              <p key={i} className="text-ascension-cyan/80 break-all leading-tight">
                {log}
              </p>
            ))}
          </div>
        </div>
      </div>
      
      <footer className="mt-8 text-ascension-purple/40 text-[10px] uppercase tracking-widest">
        &copy; 2026 Gemini / Project Ascension
      </footer>
    </main>
  );
}

export default App;
