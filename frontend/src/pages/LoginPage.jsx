import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { login, clearError } from '../slices/authSlice';
import AuthLayout from '../layouts/AuthLayout';
import Input from '../components/Input';
import Button from '../components/Button';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading, error } = useSelector((state) => state.auth);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const result = await dispatch(login({ email, password }));
    if (login.fulfilled.match(result)) {
      navigate('/');
    }
  };

  return (
    <AuthLayout 
      title="Welcome back" 
      subtitle="Log in to your account to continue"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Input
          label="Email Address"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); dispatch(clearError()); }}
          required
        />
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => { setPassword(e.target.value); dispatch(clearError()); }}
          required
          error={error}
        />

        <Button type="submit" loading={loading} className="w-full">
          Sign In
        </Button>

        <p className="text-center text-sm text-[#9E9E9B]">
          Don't have an account?{' '}
          <Link to="/register" className="text-[#37352F] font-semibold hover:underline">
            Register for free
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
