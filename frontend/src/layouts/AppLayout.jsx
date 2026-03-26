import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import Sidebar from './Sidebar';
import { fetchSessions } from '../slices/sessionSlice';
import { getSocket, disconnectSocket } from '../services/socket';
import { applyPipelineEvent } from '../slices/pipelineSlice';

export default function AppLayout() {
  const dispatch = useDispatch();
  const { token } = useSelector((s) => s.auth);

  useEffect(() => {
    if (!token) return;

    // Fetch sessions list once on app mount
    dispatch(fetchSessions());

    // Initialize the socket and wire pipeline events to Redux
    const socket = getSocket();
    const handlePipelineEvent = (payload) => {
      dispatch(applyPipelineEvent(payload));
    };
    socket.on('pipeline:event', handlePipelineEvent);

    return () => {
      socket.off('pipeline:event', handlePipelineEvent);
    };
  }, [dispatch, token]);

  return (
    <div className="w-full h-screen bg-white font-sans flex text-gray-800 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
