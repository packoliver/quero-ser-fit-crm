import React, { useState } from 'react'

export interface AvatarProps {
  name: string
  /** Real photo URL (WhatsApp profile picture, when we have one). Falls back to the
   * initial-letter placeholder below when absent, or if the image fails to load. */
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  statusIndicator?: 'online' | 'offline' | 'busy'
  className?: string
}

export function Avatar({
  name,
  src,
  size = 'md',
  statusIndicator,
  className = '',
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const initial = name ? name.charAt(0).toUpperCase() : '?'
  const showImage = !!src && !imageFailed

  const sizeStyles = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  }

  const indicatorColors = {
    online: 'bg-emerald-500',
    offline: 'bg-slate-500',
    busy: 'bg-amber-500',
  }

  return (
    <div className={`relative inline-block shrink-0 ${className}`}>
      {showImage ? (
        // Fotos de perfil vêm de domínios externos variáveis (a própria uazapi, WhatsApp
        // CDN) por conexão; não dá pra pré-configurar next/image remotePatterns pra um
        // host que muda por cliente.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          onError={() => setImageFailed(true)}
          className={`${sizeStyles[size]} rounded-full object-cover border border-slate-600 shadow-sm`}
        />
      ) : (
        <div
          className={`${sizeStyles[size]} rounded-full bg-slate-700 text-emerald-400 font-bold flex items-center justify-center border border-slate-600 shadow-sm`}
        >
          {initial}
        </div>
      )}
      {statusIndicator && (
        <span
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0f172a] ${indicatorColors[statusIndicator]}`}
        />
      )}
    </div>
  )
}
