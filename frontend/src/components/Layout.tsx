/**
 * Layout component with sidebar navigation
 */

import { useState } from 'react';
import {
  Home,
  Key,
  Server,
  Layers,
  Settings,
  Menu,
  X,
  Activity,
  LogOut,
} from 'lucide-react';
import type { AuthUser } from '../types';

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'runners', label: 'Runners', icon: Server },
  { id: 'pools', label: 'Runner Pools', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export type LayoutProps = {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
  isConnected: boolean;
  user?: AuthUser | null;
};

export function Layout({ children, currentPage, onPageChange, isConnected, user }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const connectionStatus = isConnected ? 'connected' : 'disconnected';
  const activeTab = currentPage;

  const handleLogout = async () => {
    // Import dynamically to avoid circular dependencies
    const { onboardingApi } = await import('../api');
    try {
      await onboardingApi.logout();
    } catch {
      // Ignore errors on logout
    }
    window.location.reload();
  };
  
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-16'
        } bg-forest-900 border-r border-forest-700 flex flex-col transition-all duration-300`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-forest-700">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Server className="h-6 w-6 text-forest-400" />
              <span className="font-semibold text-lg">Action Packer</span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-md hover:bg-forest-800 transition-colors"
          >
            {sidebarOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => onPageChange(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                  isActive
                    ? 'bg-forest-700 text-forest-100 border-l-2 border-forest-400'
                    : 'text-forest-300 hover:bg-forest-800 hover:text-forest-100'
                }`}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
        
        {/* Status */}
        <div className="p-4 border-t border-forest-700 space-y-3">
          {/* User info */}
          {user && (
            <div className={`flex items-center ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
              <div className="flex items-center gap-2">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="w-6 h-6 rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-forest-600 flex items-center justify-center">
                    <span className="text-xs font-medium">{user.login[0].toUpperCase()}</span>
                  </div>
                )}
                {sidebarOpen && (
                  <span className="text-sm text-forest-200 truncate max-w-[120px]">{user.login}</span>
                )}
              </div>
              {sidebarOpen && (
                <button
                  onClick={handleLogout}
                  className="p-1.5 text-forest-400 hover:text-forest-200 hover:bg-forest-800 rounded-md transition-colors"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          
          {/* Connection status */}
          <div className={`flex items-center gap-2 ${sidebarOpen ? '' : 'justify-center'}`}>
            <Activity
              className={`h-4 w-4 ${
                connectionStatus === 'connected' ? 'text-green-400' : 'text-red-400'
              }`}
            />
            {sidebarOpen && (
              <span className="text-xs text-forest-400">
                {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
              </span>
            )}
          </div>
        </div>
      </aside>
      
      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
