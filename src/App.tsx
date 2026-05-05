import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-ascension-bg text-ascension-pink font-sans selection:bg-ascension-magenta selection:text-white">
      <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 flex items-center px-4 cursor-default">
        <div className="flex gap-2">
          <div className="w-2 h-2 rounded-full bg-ascension-pink animate-pulse" />
          <div className="w-2 h-2 rounded-full bg-ascension-purple opacity-50" />
          <div className="w-2 h-2 rounded-full bg-ascension-cyan opacity-50" />
        </div>
        <span className="ml-4 text-[10px] font-mono uppercase tracking-[0.2em] opacity-40 select-none">
          Ascension Kernel v0.1.0 // System Stable
        </span>
      </div>

      <div className="p-8 rounded-lg border border-ascension-purple shadow-lg shadow-ascension-magenta/20 max-w-md w-full bg-ascension-bg/80 backdrop-blur-sm">
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
      
      <footer className="mt-8 text-ascension-purple/40 text-[10px] uppercase tracking-widest">
        &copy; 2026 Gemini / Project Ascension
      </footer>
    </main>
  );
}

export default App;
