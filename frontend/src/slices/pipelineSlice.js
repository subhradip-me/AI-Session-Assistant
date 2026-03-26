import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// ─── Thunks ───────────────────────────────────────────────────────────────────

export const fetchPipelineStatus = createAsyncThunk(
  'pipeline/fetchStatus',
  async (mediaId, { rejectWithValue }) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_BASE}/session/${mediaId}/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { mediaId, data: res.data };
    } catch (err) {
      return rejectWithValue({ mediaId, error: err.response?.data?.error || err.message });
    }
  }
);

export const retrySession = createAsyncThunk(
  'pipeline/retry',
  async ({ mediaId, stage = null }, { rejectWithValue }) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_BASE}/session/${mediaId}/retry`, { stage }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { mediaId, data: res.data };
    } catch (err) {
      return rejectWithValue({ mediaId, error: err.response?.data?.error || err.message });
    }
  }
);

export const reprocessSession = createAsyncThunk(
  'pipeline/reprocess',
  async (mediaId, { rejectWithValue }) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.put(`${API_BASE}/session/${mediaId}/reprocess`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { mediaId, data: res.data };
    } catch (err) {
      return rejectWithValue({ mediaId, error: err.response?.data?.error || err.message });
    }
  }
);

export const deleteSession = createAsyncThunk(
  'pipeline/delete',
  async (mediaId, { rejectWithValue }) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/session/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { mediaId };
    } catch (err) {
      return rejectWithValue({ mediaId, error: err.response?.data?.error || err.message });
    }
  }
);

// ─── Slice ────────────────────────────────────────────────────────────────────

/**
 * State shape: { [mediaId]: { status, progress, steps, error, loading } }
 */
const pipelineSlice = createSlice({
  name: 'pipeline',
  initialState: {},
  reducers: {
    /**
     * Called from Socket.IO event handler to update state in real time.
     * payload: { mediaId, step, status, ...extra }
     */
    applyPipelineEvent(state, action) {
      const { mediaId, step, status, ...extra } = action.payload;
      if (!state[mediaId]) {
        state[mediaId] = { status: 'uploading', progress: 0, steps: {}, error: null, loading: false };
      }
      const session = state[mediaId];

      // Update step status
      if (step && step !== 'completed' && step !== 'failed') {
        if (!session.steps[step]) session.steps[step] = {};
        session.steps[step].status = status;
        // Merge extra fields (completedChunks, totalChunks, etc.)
        Object.assign(session.steps[step], extra);
      }

      // Update overall status
      if (status === 'completed' && step === 'report') {
        session.status = 'completed';
        session.progress = 100;
      } else if (status === 'failed') {
        session.status = 'failed';
        session.error = extra.error || 'Unknown error';
      }

      // Compute rough progress from steps
      if (extra.completedChunks && extra.totalChunks) {
        session.progress = Math.round(25 * (extra.completedChunks / extra.totalChunks));
      }
    },

    clearPipelineState(state, action) {
      delete state[action.payload];
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPipelineStatus.pending, (state, action) => {
        const mediaId = action.meta.arg;
        if (!state[mediaId]) state[mediaId] = {};
        state[mediaId].loading = true;
      })
      .addCase(fetchPipelineStatus.fulfilled, (state, action) => {
        const { mediaId, data } = action.payload;
        state[mediaId] = { ...data, loading: false };
      })
      .addCase(fetchPipelineStatus.rejected, (state, action) => {
        const { mediaId } = action.payload || {};
        if (mediaId && state[mediaId]) state[mediaId].loading = false;
      })
      .addCase(retrySession.fulfilled, (state, action) => {
        const { mediaId } = action.payload;
        if (state[mediaId]) state[mediaId].status = 'analyzing';
      })
      .addCase(reprocessSession.fulfilled, (state, action) => {
        const { mediaId } = action.payload;
        if (state[mediaId]) {
          state[mediaId].status = 'diarizing';
          state[mediaId].progress = 25;
        }
      })
      .addCase(deleteSession.fulfilled, (state, action) => {
        delete state[action.payload.mediaId];
      });
  }
});

export const { applyPipelineEvent, clearPipelineState } = pipelineSlice.actions;
export default pipelineSlice.reducer;
