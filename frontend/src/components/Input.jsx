import React from 'react';

const Input = ({ 
  label, 
  type = 'text', 
  name,
  value, 
  onChange, 
  placeholder, 
  error, 
  className = '',
  required = false
}) => {
  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9E9E9B] mb-1.5 ml-1 leading-none">
          {label}
        </label>
      )}
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className={`w-full text-sm text-[#37352F] px-3 py-2 bg-[#FBFBFA] border ${error ? 'border-red-400 focus:ring-red-500/10' : 'border-[#EDEDEB] focus:ring-blue-500/20'} rounded-md focus:outline-none focus:ring-2 transition-all font-[Inter]`}
      />
      {error && <p className="mt-1 text-xs text-red-500 ml-1">{error}</p>}
    </div>
  );
};

export default Input;
