'use client'

import { useState } from 'react'
import { DesktopSidebar } from '@/components/layout/DesktopSidebar'
import { Header } from '@/components/layout/Header'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { UserRole } from '@/types/database'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [currentRole, setCurrentRole] = useState<UserRole>('admin')

  const toggleRole = () => {
    setCurrentRole((prev) => {
      if (prev === 'admin') return 'manager'
      if (prev === 'manager') return 'attendant'
      return 'admin'
    })
  }

  return (
    <div className="min-h-screen bg-[#0b1320] text-slate-100 flex flex-row w-full overflow-x-hidden">
      {/* Desktop Navigation (Filtered by currentRole) */}
      <DesktopSidebar userRole={currentRole} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen pb-16 lg:pb-0">
        <Header currentRole={currentRole} onToggleRole={toggleRole} />
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>

      {/* Mobile Navigation (Filtered by currentRole) */}
      <MobileBottomNav userRole={currentRole} />
    </div>
  )
}
