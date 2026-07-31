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

  const mainMargin = sidebarOpen
    ? sidebarCollapsed
      ? 'ml-20' :'ml-64 2xl:ml-72' :'ml-0';

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-background dark:bg-background">
      {/* TopNav includes LucIAChat globally for all authenticated routes */}
      <TopNav />

      <main
        className={`overflow-x-hidden transition-all duration-300 ease-in-out ${mainMargin} ${
          sidebarOpen ? 'pt-16' : 'pt-16 md:pt-[104px]'
        }`}
      >
        {topBanner && <div className="w-full">{topBanner}</div>}
        <div className={`${noPadding ? 'px-4 py-4 md:py-6' : 'px-4 sm:px-6 lg:px-8 xl:px-10 py-4 md:py-6'} w-full ${sidebarOpen ? 'min-h-[calc(100vh-4rem)]' : 'min-h-[calc(100vh-104px)]'}`}>
          {children}
        </div>
      </main>
    </div>
  );
}