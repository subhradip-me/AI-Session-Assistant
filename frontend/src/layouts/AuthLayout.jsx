import React from 'react';
import { LayoutDashboard, Sparkles, Lock } from 'lucide-react';

const AuthLayout = ({ children, title, subtitle }) => {
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="w-full max-w-md animate-slide-in">
        <div className="flex items-center justify-center space-x-3 mb-10">
          <div className="p-2.5 bg-gray-900 text-white rounded-2xl shadow-xl shadow-gray-200">
            <LayoutDashboard size={32} strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 font-heading uppercase">AI Session</h1>
        </div>

        <div className="bg-white border border-gray-100 rounded-[32px] p-10 shadow-2xl shadow-indigo-900/[0.03] backdrop-blur-xl bg-white/90">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2 font-heading">{title}</h2>
            <p className="text-gray-500 text-sm">{subtitle}</p>
          </div>
          {children}
        </div>
        
        <div className="mt-12 flex items-center justify-center space-x-6 opacity-30">
            <div className="flex items-center space-x-2">
                <Sparkles size={14} />
                <span className="text-[10px] font-bold uppercase tracking-widest">AI Powered</span>
            </div>
            <div className="flex items-center space-x-2">
                <Lock size={14} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Secure encrypted</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;

