import React from 'react'

export interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`bg-slate-800/80 animate-pulse rounded-xl ${className}`} />
}
