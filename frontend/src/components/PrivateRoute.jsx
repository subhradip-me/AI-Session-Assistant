import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

const PrivateRoute = ({ children }) => {
  const { isAuthenticated, loading } = useSelector((state) => state.auth);

  if (loading) {
    return (
        <div className="h-screen flex items-center justify-center bg-[#FBFBFA]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#37352F]"></div>
        </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" />;
};

export default PrivateRoute;
