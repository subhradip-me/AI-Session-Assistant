import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { login, clearError } from '../slices/authSlice';
import AuthLayout from '../layouts/AuthLayout';
import { Mail, Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

function FieldError({ msg }) {
  if (!msg) return null;
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-medium text-red-500 mt-1 ml-1">
      <AlertCircle className="w-3 h-3 shrink-0" />
      {msg}
    </p>
  );
}

const LoginPage = () => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const dispatch   = useDispatch();
  const navigate   = useNavigate();
  const { loading, error } = useSelector((s) => s.auth);

  const validate = () => {
    const errs = {};
    if (!email)                           errs.email    = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) errs.email    = 'Enter a valid email address';
    if (!password)                         errs.password = 'Password is required';
    else if (password.length < 6)          errs.password = 'Password must be at least 6 characters';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const result = await dispatch(login({ email, password }));
    if (login.fulfilled.match(result)) {
      navigate('/');
    }
  };

  const inputClass = (field) =>
    `w-full bg-gray-50 rounded-2xl py-3.5 pl-12 pr-4 text-sm transition-all outline-none border
     ${fieldErrors[field]
       ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100'
       : 'border-transparent focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200'}`;

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to access your session library.">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>

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
              value={email}
              onChange={(e) => { setEmail(e.target.value); dispatch(clearError()); if (fieldErrors.email) setFieldErrors(p => ({ ...p, email: '' })); }}
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
          <div className="flex justify-between items-center ml-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Password</label>
            <a href="#" className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-wider transition-colors">Forgot?</a>
          </div>
          <div className="relative group">
            <Lock
              className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${fieldErrors.password ? 'text-red-400' : 'text-gray-300 group-focus-within:text-indigo-400'}`}
              size={16}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); dispatch(clearError()); if (fieldErrors.password) setFieldErrors(p => ({ ...p, password: '' })); }}
              className={inputClass('password')}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <FieldError msg={fieldErrors.password} />
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
            <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
          ) : (
            <><span>Sign In</span><ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" /></>
          )}
        </button>

        <p className="text-center text-[13px] text-gray-500 pt-2">
          New here?{' '}
          <Link to="/register" className="font-bold text-gray-900 hover:text-indigo-600 transition-colors underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
