import React from 'react';
import Dashboard from './components/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <div className="flex h-screen w-full bg-slate-50 relative overflow-hidden font-sans text-slate-900">
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-white h-full border-r border-slate-800 shadow-xl z-20">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">
            POLYMARKET <br /> AGENT
          </h1>
          <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">
            Gamma Intelligence
          </p>
        </div>
        <div className="flex-1 px-4">
          <div className="space-y-1">
            <div className="px-3 py-2 text-sm font-medium bg-slate-800/50 text-white rounded-md cursor-pointer border border-slate-700/50">
              Dashboard
            </div>
            <div className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800/30 rounded-md cursor-pointer transition-colors">
              Performance
            </div>
            <div className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800/30 rounded-md cursor-pointer transition-colors">
              Settings
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse box-shadow-glow"></div>
            <span className="text-xs font-mono text-emerald-400">SYSTEM ONLINE</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full bg-slate-50/50 relative">
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between px-6 shadow-sm">
          <div className="flex items-center gap-2 md:hidden">
            <div className="h-6 w-6 bg-slate-900 rounded"></div>
          </div>
          <h2 className="text-sm font-semibold text-slate-700">Agent Dashboard</h2>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 font-mono">v1.0.4-beta</span>
            <div className="h-8 w-8 rounded-full bg-slate-200 border border-slate-300"></div>
          </div>
        </header>

        <div className="flex-1 overflow-hidden p-6 relative">
          <ErrorBoundary>
            <Dashboard />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default App;
