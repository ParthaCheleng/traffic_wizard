'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Mail, Lock, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  const handleAuth = async (action: 'login' | 'signup') => {
    if (!email || !password) {
      setError('Please enter both an email and a passcode.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    let res;
    if (action === 'signup') {
      res = await supabase.auth.signUp({ email, password });
    } else {
      res = await supabase.auth.signInWithPassword({ email, password });
    }

    if (res.error) {
      setError(res.error.message);
    } else {
      if (action === 'signup') {
        setSuccess('Successfully requested access! Please check your email to verify your account before logging in.');
      } else {
        router.push('/');
      }
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative overflow-hidden text-zinc-50">
      {/* Background Decor */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-900/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-rose-900/20 rounded-full blur-[80px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-zinc-950/80 backdrop-blur-2xl border border-zinc-800/80 rounded-3xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-red-500/20 to-rose-500/10 rounded-2xl border border-red-500/30 flex items-center justify-center mb-4">
              <ShieldAlert className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Operator Portal</h1>
            <p className="text-sm text-zinc-400 mt-1 text-center">
              Authenticate to access the live emergency traffic preemption dashboard.
            </p>
          </div>

          <div className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl text-center">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm p-3 rounded-xl text-center">
                {success}
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                type="email"
                placeholder="Operator Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50 transition-all placeholder:text-zinc-600"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                type="password"
                placeholder="Passcode"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50 transition-all placeholder:text-zinc-600"
              />
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <button
                onClick={() => handleAuth('login')}
                disabled={loading}
                className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-red-900/20 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Secure Login'}
              </button>
              
              <button
                onClick={() => handleAuth('signup')}
                disabled={loading}
                className="w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-semibold py-3 rounded-xl transition-all"
              >
                Request Access (Sign Up)
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
