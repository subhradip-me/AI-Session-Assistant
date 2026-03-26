import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { register, clearError } from '../slices/authSlice';
import AuthLayout from '../layouts/AuthLayout';
import { Mail, Lock, User, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

function FieldError({ msg }) {
  if (!msg) return null;
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-medium text-red-500 mt-1 ml-1">
      <AlertCircle className="w-3 h-3 shrink-0" />
      {msg}
    </p>
  );
}

function PasswordStrength({ password }) {
  if (!password) return null;
  const score = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  const levels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['bg-gray-200', 'bg-red-400', 'bg-amber-400', 'bg-lime-500', 'bg-emerald-500'];

  return (
    <div className="mt-2 ml-1">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= score ? colors[score] : 'bg-gray-100'}`} />
        ))}
      </div>
      {score > 0 && (
        <p className={`text-[10px] font-semibold ${score <= 1 ? 'text-red-500' : score === 2 ? 'text-amber-500' : score === 3 ? 'text-lime-600' : 'text-emerald-600'}`}>
          {levels[score]}
        </p>
      )}
    </div>
  );
}

const RegisterPage = () => {
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const dispatch  = useDispatch();
  const navigate  = useNavigate();
  const { loading, error } = useSelector((s) => s.auth);

  const validate = () => {
    const errs = {};
    if (!formData.name.trim())                      errs.name = 'Full name is required';
    else if (formData.name.trim().length < 2)       errs.name = 'Name must be at least 2 characters';
    if (!formData.email)                             errs.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formData.email))  errs.email = 'Enter a valid email address';
    if (!formData.password)                          errs.password = 'Password is required';
    else if (formData.password.length < 6)           errs.password = 'Password must be at least 6 characters';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (e) => {
    setFormData((p) => ({ ...p, [e.target.name]: e.target.value }));
    dispatch(clearError());
    if (fieldErrors[e.target.name]) setFieldErrors((p) => ({ ...p, [e.target.name]: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const result = await dispatch(register(formData));
    if (register.fulfilled.match(result)) {
      navigate('/');
    }
  };

  const inputClass = (field) =>
    `w-full bg-gray-50 rounded-2xl py-3.5 pl-12 pr-4 text-sm transition-all outline-none border
     ${fieldErrors[field]
       ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100'
       : 'border-transparent focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200'}`;

  return (
    <AuthLayout title="Create account" subtitle="Start analyzing your meetings with AI.">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>

        {/* Name */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Full Name</label>
          <div className="relative group">
            <User
              className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${fieldErrors.name ? 'text-red-400' : 'text-gray-300 group-focus-within:text-indigo-400'}`}
              size={16}
            />
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className={inputClass('name')}
              placeholder="Alex Johnson"
              autoComplete="name"
              required
            />
          </div>
          <FieldError msg={fieldErrors.name} />
        </div>

        {/* Email */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Email</label>
          <div className="relative group">
            <Mail
              className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${fieldErrors.email ? 'text-red-400' : 'text-gray-300 group-focus-within:text-indigo-400'}`}
              size={16}
            />
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={inputClass('email')}
              placeholder="name@company.com"
              autoComplete="email"
              required
            />
          </div>
          <FieldError msg={fieldErrors.email} />
        </div>

        {/* Password */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Password</label>
          <div className="relative group">
            <Lock
              className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${fieldErrors.password ? 'text-red-400' : 'text-gray-300 group-focus-within:text-indigo-400'}`}
              size={16}
            />
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className={inputClass('password')}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </div>
          <FieldError msg={fieldErrors.password} />
          <PasswordStrength password={formData.password} />
        </div>

        {/* API Error */}
        {error && (
          <div className="flex items-center gap-2.5 p-3.5 bg-red-50 text-red-600 text-[12px] font-semibold rounded-2xl border border-red-100">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 bg-gray-900 text-white rounded-2xl font-bold hover:bg-indigo-600 transition-all duration-300 shadow-lg shadow-gray-200/80 hover:shadow-indigo-200/60 flex items-center justify-center gap-2.5 group active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed mt-2"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Creating account…</>
          ) : (
            <><span>Create Account</span><ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" /></>
          )}
        </button>

        <p className="text-center text-[13px] text-gray-500 pt-2">
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-gray-900 hover:text-indigo-600 transition-colors underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default RegisterPage;
