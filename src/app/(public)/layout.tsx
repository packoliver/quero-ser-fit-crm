import React from 'react'

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#070d18] text-slate-100 flex flex-col justify-center items-center">
      {children}
    </div>
  )
}
