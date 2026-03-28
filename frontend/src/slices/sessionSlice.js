import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Thunks
export const uploadFile = createAsyncThunk(
  'session/uploadFile',
  async (file, { getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${auth.token}`
        }
      });
      return response.data; // { message, sessionId, ... }
    } catch (err) {
      return rejectWithValue(err.response.data);
    }
  }
);

export const fetchReport = createAsyncThunk(
  'session/fetchReport',
  async (mediaId, { getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const response = await axios.get(`${API_BASE_URL}/report/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      return response.data;
    } catch (err) {
      return rejectWithValue(err.response.data);
    }
  }
);

export const fetchSessions = createAsyncThunk(
  'session/fetchSessions',
  async (_, { getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const response = await axios.get(`${API_BASE_URL}/sessions`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      // The enriched sessions endpoint returns a plain array with status included.
      // Handle both old plain-array format and the sessionRoutes paginated format.
      const data = response.data;
      const rawSessions = Array.isArray(data) ? data : (data.sessions || []);
      return rawSessions.map((s) => ({
        ...s,
        mediaId:          s.mediaId || s._id,
        originalFilename: s.originalFilename || s.title || 'Untitled Session',
        // Preserve status from backend — avoids unnecessary /status polling
        status: s.status || null,
      }));
    } catch (err) {
      return rejectWithValue(err.response?.data || { error: err.message });
    }
  }
);



const sessionSlice = createSlice({
  name: 'session',
  initialState: {
    sessions: [],
    selectedSessionId: null,
    currentReport: null,
    uploading: false,
    processing: false,
    error: null,
  },
  reducers: {
    setSelectedSession: (state, action) => {
      // Always store the mediaId string (e.g. "session_1234"), never the Mongo _id
      state.selectedSessionId = action.payload;
      // Reset report state so the new session starts fresh
      state.currentReport = null;
      state.processing = false;
      state.error = null;
    },
    clearCurrentReport: (state) => {
      state.currentReport = null;
      state.processing = false;
      state.error = null;
    },
    clearSessionError: (state) => {
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(uploadFile.pending, (state) => {
        state.uploading = true;
        state.error = null;
        state.processing = false;
        state.currentReport = null;
      })
      .addCase(uploadFile.fulfilled, (state, action) => {
        state.uploading = false;
        state.processing = true;
        state.selectedSessionId = action.payload.sessionId;
      })
      .addCase(uploadFile.rejected, (state, action) => {
        state.uploading = false;
        state.error = action.payload?.error || 'Upload failed';
      })
      .addCase(fetchReport.fulfilled, (state, action) => {
        state.currentReport = action.payload;
        state.processing = false;
      })
      .addCase(fetchReport.pending, (state) => {
        // Don't reset processing here — let fulfilled/rejected handle it
        state.error = null;
      })
      .addCase(fetchReport.rejected, (state, action) => {
        const msg = action.payload?.error || '';
        // Keep polling only when the backend explicitly says it's still processing
        if (msg.includes('processing') || msg.includes('still')) {
          state.processing = true;
        } else {
          state.processing = false;
          // Only set a visible error if there was actually a report before
          // (avoids flash of error on first load before report is ready)
          if (!state.currentReport) {
            state.error = msg || null;
          }
        }
      })
      .addCase(fetchSessions.fulfilled, (state, action) => {
        state.sessions = action.payload;
      })
      // On full delete, remove the session from the list, deselect if active, and clear the report.
      .addMatcher(
        (action) => action.type === 'pipeline/delete/fulfilled',
        (state, action) => {
          const { mediaId } = action.payload;
          // Remove from sidebar list — session is gone from DB
          state.sessions = state.sessions.filter((s) => s.mediaId !== mediaId);
          // Deselect and clear report if this was the open session
          if (state.selectedSessionId === mediaId) {
            state.selectedSessionId = null;
            state.currentReport = null;
            state.processing = false;
            state.error = null;
          }
        }
      );
  },
});

export const { setSelectedSession, clearCurrentReport, clearSessionError } = sessionSlice.actions;
export default sessionSlice.reducer;
