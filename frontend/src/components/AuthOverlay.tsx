'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { Mail, Lock, User, Phone, Car, ShieldAlert, AlertTriangle } from 'lucide-react';

interface AuthOverlayProps {
  onAuthSuccess: () => void;
}

export function AuthOverlay({ onAuthSuccess }: AuthOverlayProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [role, setRole] = useState<'general' | 'emergency' | 'admin'>('general');
  
  // Role specific fields
  const [vehicleType, setVehicleType] = useState('Car');
  const [emergencyServiceType, setEmergencyServiceType] = useState('Medical');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (isSignUp) {
        // 1. Sign up with Supabase Auth (passing meta_data)
        const metaData: any = {
          full_name: fullName,
          phone_number: phoneNumber,
          role: role,
        };

        if (role === 'general') {
          metaData.vehicle_type = vehicleType;
        } else if (role === 'emergency') {
          metaData.vehicle_type = vehicleType;
          metaData.emergency_service_type = emergencyServiceType;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: metaData,
          },
        });

        if (error) throw error;

        if (data.user) {
          // 2. Direct insert into public.profiles to satisfy RLS
          const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            role,
            full_name: fullName,
            phone_number: phoneNumber,
            vehicle_type: role !== 'admin' ? vehicleType : null,
            emergency_service_type: role === 'emergency' ? emergencyServiceType : null,
          });

          if (profileError) {
            console.warn('Profile DB insert failed, trigger might handle it:', profileError.message);
          }

          // If session is returned immediately (email confirmation disabled in Supabase)
          if (data.session) {
            setSuccessMsg('Account created successfully!');
            setTimeout(() => onAuthSuccess(), 1000);
          } else {
            // Email confirmation enabled (like in our workspace)
            setSuccessMsg('Sign-up successful! Please check your email for a confirmation link.');
            // For developers: tell them they can run our DB confirm script
            console.log('User signed up. Run backend/scripts/confirm_user.ts to bypass email confirmation locally.');
          }
        }
      } else {
        // Log in
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        if (data.session) {
          setSuccessMsg('Logged in successfully!');
          setTimeout(() => onAuthSuccess(), 1000);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-zinc-950/80 border border-zinc-800/60 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden"
      >
        {/* Glow Effects */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-white tracking-tight">
            {isSignUp ? 'Create TrafficWizard Account' : 'Welcome to TrafficWizard'}
          </h2>
          <p className="text-sm text-zinc-400 mt-2">
            {isSignUp ? 'Select your role and enter details to register' : 'Enter credentials to access live tracking'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-900/60 rounded-xl flex items-start gap-2 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-teal-950/40 border border-teal-900/60 rounded-xl flex items-start gap-2 text-xs text-teal-400">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <>
              {/* Role Selector */}
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Account Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['general', 'emergency', 'admin'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`py-2 px-3 text-xs font-medium rounded-xl border capitalize transition-all ${
                        role === r
                          ? 'bg-white text-zinc-950 border-white font-bold shadow-md'
                          : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:bg-zinc-900'
                      }`}
                    >
                      {r === 'general' ? 'General' : r === 'emergency' ? 'Emergency' : 'Admin'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="text"
                    required
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 focus:bg-zinc-900 transition-all"
                  />
                </div>
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 focus:bg-zinc-900 transition-all"
                  />
                </div>
              </div>

              {/* Dynamic Vehicle Type Input */}
              {role !== 'admin' && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                    {role === 'emergency' ? 'Emergency Vehicle Type' : 'Vehicle Type'}
                  </label>
                  <div className="relative">
                    <Car className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <select
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value)}
                      className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white outline-none focus:border-zinc-500 focus:bg-zinc-900 transition-all appearance-none cursor-pointer"
                    >
                      {role === 'emergency' ? (
                        <>
                          <option value="Ambulance">Ambulance</option>
                          <option value="Firetruck">Firetruck</option>
                          <option value="Police">Police Cruiser</option>
                        </>
                      ) : (
                        <>
                          <option value="Car">Car</option>
                          <option value="Bike">Motorcycle/Bike</option>
                          <option value="Truck">Truck/Cargo</option>
                          <option value="Other">Other</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
              )}

              {/* Dynamic Emergency Service Selection */}
              {role === 'emergency' && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Emergency Service Type</label>
                  <div className="relative">
                    <ShieldAlert className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <select
                      value={emergencyServiceType}
                      onChange={(e) => setEmergencyServiceType(e.target.value)}
                      className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white outline-none focus:border-zinc-500 focus:bg-zinc-900 transition-all appearance-none cursor-pointer"
                    >
                      <option value="Medical">Medical (EMS)</option>
                      <option value="Fire">Fire & Rescue</option>
                      <option value="Law Enforcement">Law Enforcement / Police</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Email Address */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="email"
                required
                placeholder="developer@trafficwizard.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 focus:bg-zinc-900 transition-all"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 focus:bg-zinc-900 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-zinc-950 font-bold hover:bg-zinc-100 disabled:bg-zinc-700 py-3 rounded-2xl transition-all text-sm mt-6 shadow-lg shadow-white/5 active:scale-[0.98] cursor-pointer"
          >
            {loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className="text-center mt-6 text-xs text-zinc-400">
          <span>{isSignUp ? 'Already have an account?' : "Don't have an account?"}</span>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className="text-white font-bold ml-1 hover:underline cursor-pointer"
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
