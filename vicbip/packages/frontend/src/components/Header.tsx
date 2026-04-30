import React from 'react';
import { useAppStore } from '../store/useAppStore';

export function Header(): React.ReactElement {
  const { activeTab, setActiveTab, isDarkMode, toggleDarkMode, toggleSidebar } = useAppStore();

  return (
    <header
      className="flex items-center justify-between px-4 h-14 shrink-0 z-10"
      style={{ backgroundColor: '#1B4F8C' }}
      role="banner"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="text-white/80 hover:text-white p-1 rounded"
          aria-label="Toggle sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[#E8731A] font-bold text-lg tracking-tight">VicBIP</span>
          <span className="text-white/60 text-sm hidden sm:inline">
            | Victoria Bridge Intelligence Platform
          </span>
        </div>
      </div>

      <nav className="flex items-center gap-1" role="navigation" aria-label="Main navigation">
        <button
          onClick={() => setActiveTab('map')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            activeTab === 'map'
              ? 'bg-white text-brand-blue'
              : 'text-white/80 hover:text-white hover:bg-white/10'
          }`}
          aria-current={activeTab === 'map' ? 'page' : undefined}
        >
          Map
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            activeTab === 'dashboard'
              ? 'bg-white text-brand-blue'
              : 'text-white/80 hover:text-white hover:bg-white/10'
          }`}
          aria-current={activeTab === 'dashboard' ? 'page' : undefined}
        >
          Dashboard
        </button>
      </nav>

      <button
        onClick={toggleDarkMode}
        className="text-white/80 hover:text-white p-1.5 rounded"
        aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDarkMode ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
    </header>
  );
}
