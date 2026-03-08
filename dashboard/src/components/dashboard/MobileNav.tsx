"use client";

import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Wallet,
  ArrowRightLeft,
  History,
  Menu,
  X,
  Settings,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface MobileNavProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Home', icon: <LayoutDashboard size={20} /> },
  { id: 'portfolio', label: 'Portfolio', icon: <Wallet size={20} /> },
  { id: 'swaps', label: 'Swap', icon: <ArrowRightLeft size={20} /> },
  { id: 'history', label: 'History', icon: <History size={20} /> },
];

export function MobileNav({ activeTab = 'overview', onTabChange = () => {} }: MobileNavProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isAuthenticated, address, logout } = useAuth();

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <>
      {/* Top Header Bar */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 glass border-b border-white/[0.05]">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-system-blue to-system-purple flex items-center justify-center">
              <span className="text-sm font-bold text-white">S</span>
            </div>
            <span className="text-lg font-bold">Suwappu</span>
          </div>

          {/* Menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Full screen menu overlay */}
      <div
        className={clsx(
          'lg:hidden fixed inset-0 z-30 transition-all duration-300',
          isMenuOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsMenuOpen(false)}
        />

        {/* Menu content */}
        <div className={clsx(
          'absolute top-[56px] left-0 right-0 bottom-[72px] overflow-y-auto glass',
          'transition-transform duration-300',
          isMenuOpen ? 'translate-y-0' : '-translate-y-full'
        )}>
          <div className="p-4 space-y-2">
            {/* User info */}
            {isAuthenticated && address && (
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.05] mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-system-green to-system-teal flex items-center justify-center">
                    <span className="text-xs font-bold text-white">
                      {address.slice(2, 4).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-white">{truncateAddress(address)}</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-system-green animate-pulse" />
                      <span className="text-xs text-gray-2">Connected</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Menu items */}
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  setIsMenuOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-4 rounded-xl transition-colors',
                  activeTab === item.id
                    ? 'bg-system-blue/10 text-system-blue'
                    : 'text-gray-1 hover:bg-white/5'
                )}
              >
                {item.icon}
                <span className="font-medium">{item.label}</span>
              </button>
            ))}

            <div className="border-t border-white/[0.05] my-4" />

            {/* Settings */}
            <button
              onClick={() => {
                onTabChange('settings');
                setIsMenuOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-4 rounded-xl text-gray-1 hover:bg-white/5 transition-colors"
            >
              <Settings size={20} />
              <span className="font-medium">Settings</span>
            </button>

            {/* Logout */}
            {isAuthenticated && (
              <button
                onClick={() => {
                  logout();
                  setIsMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-4 rounded-xl text-system-red hover:bg-system-red/10 transition-colors"
              >
                <LogOut size={20} />
                <span className="font-medium">Disconnect</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t border-white/[0.05] safe-area-bottom">
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={clsx(
                'flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all min-w-[64px]',
                activeTab === item.id
                  ? 'text-system-blue'
                  : 'text-gray-2 hover:text-white'
              )}
            >
              <span className={clsx(
                'transition-transform',
                activeTab === item.id && 'scale-110'
              )}>
                {item.icon}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
              {activeTab === item.id && (
                <div className="absolute bottom-1 w-1 h-1 rounded-full bg-system-blue" />
              )}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
