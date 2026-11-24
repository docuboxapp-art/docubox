'use client';

import React from 'react';
import TopNav from './TopNav';
import { useSidebar } from '@/contexts/SidebarContext';

interface AppLayoutProps {
  children: React.ReactNode;
  topBanner?: React.ReactNode;
  noPadding?: boolean;
}

export default function AppLayout({ children, topBanner, noPadding }: AppLayoutProps) {
  const { sidebarOpen, sidebarCollapsed } = useSidebar();

  const mainMargin = sidebarOpen ? (sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64 2xl:ml-72') : 'ml-0';

  return (
    <div className="docubox-app min-h-screen w-full overflow-x-clip bg-background dark:bg-background">
      {/* TopNav includes LucIAChat globally for all authenticated routes */}
      <TopNav />

      <main
        className={`app-main min-w-0 [--app-header-height:64px] transition-all duration-300 ease-in-out ${mainMargin} ${
          sidebarOpen ? 'pt-16' : 'pt-16 lg:pt-[104px] lg:[--app-header-height:104px]'
        }`}
      >
        {topBanner && <div className="w-full">{topBanner}</div>}
        <div
          className={`app-content w-full min-w-0 min-h-[calc(100dvh-var(--app-header-height))] ${noPadding ? 'px-4 py-4 md:py-6' : 'app-page-frame bg-[#f6f8fb] dark:bg-background'}`}
        >
          {noPadding ? children : <div className="app-page-width">{children}</div>}
        </div>
      </main>
    </div>
  );
}
