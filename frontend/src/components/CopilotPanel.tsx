'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, X, MessageSquare, Compass } from 'lucide-react';

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

interface CopilotPanelProps {
  userLocation: { longitude: number; latitude: number };
  onRouteCalculated: (routeGeoJSON: any, destinationCoords: [number, number], message: string) => void;
  avoidanceMultiplier: number;
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:8080';

export function CopilotPanel({ userLocation, onRouteCalculated, avoidanceMultiplier }: CopilotPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'ai',
      text: 'Hello! I am your AI Copilot. Tell me where you want to go (e.g., "Take me to Gachibowli Flyover" or "Get me to Charminar avoiding highways") and I will generate a traffic-aware detour route for you.',
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat when new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const userMsg = inputText.trim();
    setInputText('');
    setMessages((prev) => [...prev, { sender: 'user', text: userMsg }]);
    setIsLoading(true);

    try {
      const response = await fetch(`${SOCKET_URL}/api/copilot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: userMsg,
          userLocation: [userLocation.longitude, userLocation.latitude],
          avoidanceMultiplier,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch route from AI Copilot');
      }

      const data = await response.json();
      
      setMessages((prev) => [...prev, { sender: 'ai', text: data.message }]);
      
      if (data.routeGeoJSON && data.destinationCoords) {
        onRouteCalculated(data.routeGeoJSON, data.destinationCoords, data.message);
      }
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { sender: 'ai', text: 'Sorry, I encountered an error while calculating your route. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="absolute bottom-10 left-4 z-50"
      onPointerDownCapture={(e) => e.stopPropagation()} // Prevent map dragging/clicks from leaking
    >
      <AnimatePresence>
        {!isOpen ? (
          // Collapsed Trigger Button
          <motion.button
            key="trigger"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-full px-5 py-3 shadow-xl transition-all font-semibold select-none border border-emerald-500/20 active:scale-95"
          >
            <Sparkles className="w-5 h-5 animate-pulse" />
            <span>AI Copilot</span>
          </motion.button>
        ) : (
          // Expanded Glassmorphic Chat Panel
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            className="w-[360px] max-w-[calc(100vw-2rem)] h-[450px] rounded-3xl bg-neutral-900/80 backdrop-blur-xl border border-neutral-800 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-gradient-to-r from-neutral-900/50 to-teal-950/20">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-teal-500/10 rounded-lg border border-teal-500/30">
                  <Sparkles className="w-4 h-4 text-teal-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">AI Navigation Copilot</h3>
                  <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Gemini Active
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-neutral-800 rounded-full transition-colors text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                      msg.sender === 'user'
                        ? 'bg-teal-600 text-white rounded-br-none'
                        : 'bg-neutral-800/85 text-neutral-100 border border-neutral-700/50 rounded-bl-none'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              
              {/* Typing Indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-neutral-800/85 text-neutral-400 border border-neutral-700/50 rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSubmit} className="p-3 border-t border-neutral-800 bg-neutral-950/40">
              <div className="relative flex items-center rounded-xl bg-neutral-800/60 border border-neutral-700/50 px-3 py-2 focus-within:border-teal-500/50 focus-within:ring-1 focus-within:ring-teal-500/20 transition-all">
                <input
                  type="text"
                  placeholder="Where would you like to go?"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="bg-transparent outline-none flex-1 text-sm text-white placeholder-neutral-500"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || isLoading}
                  className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${
                    inputText.trim() && !isLoading
                      ? 'bg-teal-600 hover:bg-teal-700 text-white'
                      : 'bg-neutral-800 text-neutral-600'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
