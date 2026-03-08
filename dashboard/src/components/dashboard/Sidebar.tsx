"use client";

import React, { ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Wallet,
  ArrowRightLeft,
  History,
  BarChart3,
  Settings,
  HelpCircle,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

interface SidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const mainNavItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  { id: 'portfolio', label: 'Portfolio', icon: <Wallet size={20} /> },
  { id: 'swaps', label: 'Swaps', icon: <ArrowRightLeft size={20} /> },
  { id: 'history', label: 'History', icon: <History size={20} /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={20} /> },
];

const bottomNavItems: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
  { id: 'help', label: 'Help', icon: <HelpCircle size={20} /> },
];

function NavButton({
  item,
  active,
  onClick
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/50',
        active
          ? 'bg-system-blue/10 text-system-blue border border-system-blue/20'
          : 'text-gray-1 hover:bg-white/5 hover:text-white border border-transparent'
      )}
    >
      <span className={clsx(
        'transition-transform duration-200',
        active && 'scale-110'
      )}>
        {item.icon}
      </span>
      <span className="font-medium text-sm">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto px-2 py-0.5 text-xs font-bold rounded-full bg-system-blue text-white">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </button>
  );
}

export function Sidebar({ activeTab = 'overview', onTabChange = () => {} }: SidebarProps) {
  const { isAuthenticated, address, logout } = useAuth();

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <aside className="w-64 h-screen flex flex-col glass border-r border-white/[0.05]">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-system-blue to-system-purple flex items-center justify-center">
          <span className="text-xl font-bold text-white">S</span>
        </div>
        <div>
          <span className="text-xl font-bold tracking-tight">Suwappu</span>
          <p className="text-xs text-gray-2">Cross-Chain DEX</p>
        </div>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {mainNavItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={activeTab === item.id}
            onClick={() => onTabChange(item.id)}
          />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="px-4 py-4 space-y-1 border-t border-white/[0.05]">
        {bottomNavItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={activeTab === item.id}
            onClick={() => onTabChange(item.id)}
          />
        ))}

        {isAuthenticated && (
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-system-red hover:bg-system-red/10 transition-colors"
          >
            <LogOut size={20} />
            <span className="font-medium text-sm">Disconnect</span>
          </button>
        )}
      </div>

      {/* User section */}
      {isAuthenticated && address && (
        <div className="p-4 border-t border-white/[0.05]">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-system-green to-system-teal flex items-center justify-center">
              <span className="text-xs font-bold text-white">
                {address.slice(2, 4).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {truncateAddress(address)}
              </p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-system-green animate-pulse" />
                <span className="text-xs text-gray-2">Connected</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
