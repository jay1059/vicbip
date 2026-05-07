import React from 'react';
import { Header } from './components/Header';
import { FilterPanel } from './components/FilterPanel';
import { MapView } from './components/MapView';
import { DashboardView } from './components/DashboardView';
import { AdminPanel } from './components/AdminPanel';
import { BridgePanel } from './components/BridgePanel';
import { Disclaimer } from './components/Disclaimer';
import { ContentFeed } from './components/ContentFeed';
import { useAppStore } from './store/useAppStore';

function App(): React.ReactElement {
  const { activeTab } = useAppStore();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--map-bg)]">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <FilterPanel />

        <main className="flex-1 relative overflow-hidden">
          <div
            className={`absolute inset-0 transition-opacity duration-200 ${
              activeTab === 'map' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'map'}
          >
            <MapView />
          </div>
          <div
            className={`absolute inset-0 transition-opacity duration-200 overflow-hidden ${
              activeTab === 'dashboard' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'dashboard'}
          >
            <DashboardView />
          </div>
          <div
            className={`absolute inset-0 transition-opacity duration-200 overflow-hidden ${
              activeTab === 'admin' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'admin'}
          >
            <AdminPanel />
          </div>
        </main>
      </div>

      <BridgePanel />
      <Disclaimer />
      <ContentFeed />
    </div>
  );
}

export default App;
