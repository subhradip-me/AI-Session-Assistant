import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../slices/authSlice';
import sessionReducer from '../slices/sessionSlice';
import pipelineReducer from '../slices/pipelineSlice';

export const store = configureStore({
  reducer: {
    auth:     authReducer,
    session:  sessionReducer,
    pipeline: pipelineReducer,
  },
});

export default store;
