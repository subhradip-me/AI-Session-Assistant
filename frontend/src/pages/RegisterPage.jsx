import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { register, clearError } from '../slices/authSlice';
import AuthLayout from '../layouts/AuthLayout';
import Input from '../components/Input';
import Button from '../components/Button';

const RegisterPage = () => {
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading, error } = useSelector((state) => state.auth);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const result = await dispatch(register(formData));
    if (register.fulfilled.match(result)) {
      navigate('/');
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    dispatch(clearError());
  };

  return (
    <AuthLayout 
      title="Create an account" 
      subtitle="Start turning meetings into intelligence today"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          label="Full Name"
          name="name"
          placeholder="Subhradip M."
          value={formData.name}
          onChange={handleChange}
          required
        />
        <Input
          label="Email Address"
          name="email"
          type="email"
          placeholder="subhradip@example.com"
          value={formData.email}
          onChange={handleChange}
          required
        />
        <Input
          label="Password"
          name="password"
          type="password"
          placeholder="At least 8 characters"
          value={formData.password}
          onChange={handleChange}
          required
          error={error}
        />

        <Button type="submit" loading={loading} className="w-full">
          Create Account
        </Button>

        <p className="text-center text-sm text-[#9E9E9B]">
          Already have an account?{' '}
          <Link to="/login" className="text-[#37352F] font-semibold hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default RegisterPage;
