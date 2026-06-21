'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GlobePreloader } from '@/components/ui/globe-preloader';
import MapDashboard from '@/components/MapDashboard';

export default function Home() {
  const [preloaderDone, setPreloaderDone] = useState(false);

  return (
    <main className="bg-black text-zinc-50 h-screen w-screen overflow-hidden relative">
      <AnimatePresence mode="wait">
        {!preloaderDone && (
          <GlobePreloader key="preloader" onComplete={() => setPreloaderDone(true)} />
        )}
      </AnimatePresence>

      {/* 
        We only mount the MapDashboard once the preloader is done to prevent 
        the heavy WebGL context from rendering behind the splash screen 
      */}
      {preloaderDone && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
          className="w-full h-full absolute inset-0"
        >
          <MapDashboard />
        </motion.div>
      )}
    </main>
  );
}
