'use client';

import dynamic from 'next/dynamic';

// Three.js must only run client-side — ssr: false prevents server-side execution
const IglooScene = dynamic(() => import('@/components/IglooScene'), { ssr: false });

export default function Home() {
  return (
    <>
      {/* WebGL Canvas — rendered client-side only */}
      <IglooScene />

      {/* Scroll Height Spacer */}
      <div id="scroll-spacer" />

      {/* HUD Overlay */}
      <div id="hud-container" className="hud-container">
        {/* Top Header Branding & Manifesto */}
        <div className="hud-header">
          {/* Top Left Branding */}
          {/* <div className="brand-hero">
            <h1 className="brand-title">IGLOO</h1>
            <div className="brand-sub">// Copyright @ 2026</div>
            <div className="brand-info">
              Igloo, Inc.<br />
              All Rights Reserved.
            </div>
          </div> */}

          {/* Top Right Manifesto */}
          {/* <div className="manifesto-box">
            <div className="manifesto-title">////// Manifesto</div>
            <div className="manifesto-body">
              Our mission is to build the next generation of consumer brands at the intersection of Community, AI, and crypto.
            </div>
          </div> */}
        </div>

        {/* Bottom Left Hint & Sound Toggle */}
        {/* <div className="bottom-left-hint">
          <div id="scroll-prompt" className="scroll-prompt">Scroll down to discover.</div>
          <div className="sound-toggle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
            <span>Sound: Off</span>
          </div>
        </div> */}

        {/* Right Side Interactive Mouse Scroll Tracker */}
        <div className="scroll-tracker" id="scroll-tracker">
          <div className="tracker-line-bg" id="tracker-line-bg">
            <div id="tracker-line-fill" className="tracker-line-fill" />
          </div>
          <div id="scroll-percent-badge" className="scroll-percent-badge">00%</div>
        </div>
      </div>
    </>
  );
}
