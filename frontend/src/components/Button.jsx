import React from 'react';

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  type = 'button', 
  disabled = false, 
  loading = false,
  className = ''
}) => {
  const baseStyles = "px-4 py-2 rounded-md text-sm font-medium transition-notion flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-[#37352F] text-white hover:bg-[#2F2E2A]",
    secondary: "bg-[#F5F5F4] text-[#37352F] hover:bg-[#EBEAE4] border border-[#EDEDEB]",
    ghost: "text-[#9E9E9B] hover:text-[#37352F] hover:bg-[#EBEAE4]",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 border border-red-100"
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {loading ? (
        <span className="flex items-center">
             <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
           Processing...
        </span>
      ) : children}
    </button>
  );
};

export default Button;
