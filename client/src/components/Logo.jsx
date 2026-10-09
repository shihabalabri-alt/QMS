import React from 'react';

// QualiCore mark: two-tone hexagon shield, rising bars, green Q-swoosh.
export function LogoMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" aria-label="QualiCore">
      <defs>
        <linearGradient id="qcb1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f9bff" />
          <stop offset="100%" stopColor="#0d47c4" />
        </linearGradient>
        <linearGradient id="qcg1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7ed957" />
          <stop offset="100%" stopColor="#2f8f1f" />
        </linearGradient>
      </defs>
      <path d="M96 24 L38 57 L38 137 L98 174"
        fill="none" stroke="url(#qcb1)" strokeWidth="21" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M124 30 L182 63 L182 141 L126 176"
        fill="none" stroke="url(#qcg1)" strokeWidth="21" strokeLinecap="round" strokeLinejoin="round"/>
      <g fill="#3b82f6">
        <rect x="76"  y="112" width="14" height="34" rx="4"/>
        <rect x="98"  y="96"  width="14" height="50" rx="4"/>
        <rect x="120" y="80"  width="14" height="66" rx="4"/>
        <rect x="142" y="64"  width="14" height="70" rx="4"/>
      </g>
      <path d="M60 148 C90 172 138 172 178 140 C150 158 104 156 74 134 C68 130 62 136 60 148 Z"
        fill="url(#qcg1)"/>
    </svg>
  );
}

export function Wordmark({ size = 22, light = true }) {
  return (
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: '-0.5px', lineHeight: 1, whiteSpace: 'nowrap' }}>
      <span style={{ color: light ? '#e8edf7' : 'var(--text)' }}>Quali</span>
      <span style={{ color: light ? '#5aa2f5' : 'var(--primary)' }}>Core</span>
    </span>
  );
}

// Full lockup: mark + optional text/subtitle
export default function Logo({ size = 34, showText = false, sub = null, textSize, subColor = '#8b96c9' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} />
      {showText && (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <Wordmark size={textSize || Math.max(15, size * 0.6)} />
          {sub && <span style={{ fontSize: 10, color: subColor, textTransform: 'uppercase', letterSpacing: 1.4 }}>{sub}</span>}
        </span>
      )}
    </span>
  );
}
