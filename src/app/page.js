'use client';

import dynamic from 'next/dynamic';

// Three.js must only run client-side — ssr: false prevents server-side execution
const IglooScene = dynamic(() => import('@/components/IglooScene'), { ssr: false });

export default function Home() {
  return (
    <>
      {/* WebGL Canvas — rendered client-side only */}
      <IglooScene />
    </>
  );
}
