import { create } from 'zustand';

type ViewTab = 'map' | 'dashboard';

interface AppState {
  selectedBridgeId: string | null;
  setSelectedBridgeId: (id: string | null) => void;
  activeTab: ViewTab;
  setActiveTab: (tab: ViewTab) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  isHeatmapEnabled: boolean;
  toggleHeatmap: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedBridgeId: null,
  setSelectedBridgeId: (id) => set({ selectedBridgeId: id }),

  activeTab: 'map',
  setActiveTab: (tab) => set({ activeTab: tab }),

  isDarkMode: false,
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.isDarkMode;
      if (next) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { isDarkMode: next };
    }),

  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  isHeatmapEnabled: false,
  toggleHeatmap: () => set((state) => ({ isHeatmapEnabled: !state.isHeatmapEnabled })),
}));
