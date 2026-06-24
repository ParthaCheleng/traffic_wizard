'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GlobePreloader } from '@/components/ui/globe-preloader';
import MapDashboard from '@/components/MapDashboard';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { LogOut } from 'lucide-react';

export default function Home() {
  const [preloaderDone, setPreloaderDone] = useState(false);
  const { session, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !session) {
      router.push('/login');
    }
  }, [session, isLoading, router]);

  if (isLoading || !session) {
    return <div className="bg-black min-h-screen w-full flex items-center justify-center text-zinc-500">Authenticating...</div>;
  }

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
          
          <button 
            onClick={() => supabase.auth.signOut()} 
            className="absolute bottom-4 right-4 z-50 bg-zinc-900/80 backdrop-blur border border-zinc-800 p-3 rounded-full text-zinc-400 hover:text-white transition shadow-xl"
            title="Sign Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </motion.div>
      )}
    </main>
  );
}
