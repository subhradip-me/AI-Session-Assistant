import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../slices/authSlice';
import sessionReducer from '../slices/sessionSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    session: sessionReducer,
  },
});

export default store;
