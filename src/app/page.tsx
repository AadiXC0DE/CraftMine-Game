'use client';

import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Dynamically import the game component to ensure it's client-side only
const BlockExplorerGame = dynamic(
  () => import('@/components/game/BlockExplorerGame').then((mod) => mod.BlockExplorerGame),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-50">
        <Loader2 className="h-16 w-16 animate-spin text-primary mb-4" />
        <p className="text-xl text-foreground">Loading Block Explorer...</p>
      </div>
    ),
  }
);

const HomePage: NextPage = () => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {isClient ? <BlockExplorerGame /> : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-50">
          <Loader2 className="h-16 w-16 animate-spin text-primary mb-4" />
          <p className="text-xl text-foreground">Initializing...</p>
        </div>
      )}
    </main>
  );
};

export default HomePage;
