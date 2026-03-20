import React from 'react';

const AuthLayout = ({ children, title, subtitle }) => {
  return (
    <div className="min-h-screen bg-[#FBFBFA] flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#F7F6F3] to-white text-[#37352F]">
      <div className="max-w-md w-full bg-white border border-[#EDEDEB] rounded-2xl shadow-xl shadow-black/[0.03] p-10 animate-fade-in-scale">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-[#37352F] mb-2">{title}</h1>
          <p className="text-sm text-[#9E9E9B] font-medium">{subtitle}</p>
        </div>
        {children}
      </div>
      <p className="mt-8 text-center text-xs text-[#9E9E9B] tracking-tight font-[Inter]">
        AI Session Assistant — Production Ready
      </p>
    </div>
  );
};

export default AuthLayout;
