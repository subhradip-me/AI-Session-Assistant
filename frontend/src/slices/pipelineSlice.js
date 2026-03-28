import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import { fetchSessions } from './sessionSlice';

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
      return rejectWithValue({
        mediaId,
        status: err.response?.status,
        error: err.response?.data?.error || err.message
      });
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
      return { mediaId, stage, data: res.data };
    } catch (err) {
      const error = err.response?.data?.error || err.message;
      return rejectWithValue({ mediaId, error });
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
      const status = err.response?.status;
      const raw    = err.response?.data?.error || err.message;
      // 422 = MinIO chunks are gone, nothing to rebuild from
      const error  = status === 422
        ? 'Cannot reprocess: original audio files are no longer in storage.'
        : raw;
      return rejectWithValue({ mediaId, error });
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
        // Merge API response — preserves any real-time socket data that arrived
        state[mediaId] = { ...state[mediaId], ...data, loading: false };
      })
      .addCase(fetchPipelineStatus.rejected, (state, action) => {
        const { mediaId, error, status: httpStatus } = action.payload || {};
        if (mediaId) {
          if (!state[mediaId]) state[mediaId] = {};
          state[mediaId].loading = false;
          // 404 = no SessionState in DB — mark as not_found to stop polling
          if (httpStatus === 404) {
            state[mediaId].status = 'not_found';
          }
        }
      })

      // ── Retry ─────────────────────────────────────────────────────────────
      .addCase(retrySession.pending, (state, action) => {
        const mediaId = action.meta.arg?.mediaId;
        if (mediaId && state[mediaId]) {
          state[mediaId].retrying = true;
          state[mediaId].actionError = null;
        }
      })
      .addCase(retrySession.fulfilled, (state, action) => {
        const { mediaId, stage } = action.payload;
        if (!state[mediaId]) state[mediaId] = {};
        state[mediaId].status = 'analyzing';
        state[mediaId].retrying = false;
        state[mediaId].actionError = null;
        state[mediaId].error = null;
        // For full retry (no stage): reset all non-transcription step statuses
        if (!stage) {
          const steps = state[mediaId].steps || {};
          ['diarization', 'grouping', 'analysis', 'blocks', 'report'].forEach((k) => {
            if (steps[k]) steps[k].status = 'pending';
          });
        }
      })
      .addCase(retrySession.rejected, (state, action) => {
        const { mediaId, error } = action.payload || {};
        if (mediaId && state[mediaId]) {
          state[mediaId].retrying = false;
          state[mediaId].actionError = error || 'Retry failed';
        }
      })

      // ── Reprocess ─────────────────────────────────────────────────────────
      .addCase(reprocessSession.pending, (state, action) => {
        const mediaId = action.meta.arg;
        if (mediaId && state[mediaId]) {
          state[mediaId].reprocessing = true;
          state[mediaId].actionError = null;
        }
      })
      .addCase(reprocessSession.fulfilled, (state, action) => {
        const { mediaId } = action.payload;
        if (!state[mediaId]) state[mediaId] = {};
        // Backend sets status = "analyzing" and resets all steps except transcription
        state[mediaId].status = 'analyzing';
        state[mediaId].progress = 0;
        state[mediaId].error = null;
        state[mediaId].reprocessing = false;
        state[mediaId].actionError = null;
        // Reset all derived steps — transcription stays completed
        state[mediaId].steps = {
          transcription: { status: 'completed' },
          diarization:   { status: 'pending' },
          grouping:      { status: 'pending' },
          analysis:      { status: 'pending', processedSegments: 0, totalSegments: 0 },
          blocks:        { status: 'pending', completedBlocks: 0, totalBlocks: 0 },
          report:        { status: 'pending' },
        };
      })
      .addCase(reprocessSession.rejected, (state, action) => {
        const { mediaId, error } = action.payload || {};
        if (mediaId && state[mediaId]) {
          state[mediaId].reprocessing = false;
          state[mediaId].actionError = error || 'Reprocess failed';
        }
      })

      // ── Delete ────────────────────────────────────────────────────────────
      .addCase(deleteSession.fulfilled, (state, action) => {
        const { mediaId } = action.payload;
        // Session is fully deleted from DB — remove from pipeline state entirely
        delete state[mediaId];
      })
      .addCase(deleteSession.rejected, (state, action) => {
        // Nothing to update on failure — session is unchanged
        console.error('Delete session failed:', action.payload?.error);
      })

      // ── Seed from sessions list ───────────────────────────────────────────
      // When the sessions list loads, pre-populate pipeline state for each session
      // that already has a known status. This means completed/failed sessions are
      // immediately visible without triggering a /status poll.
      .addCase(fetchSessions.fulfilled, (state, action) => {
        action.payload.forEach((session) => {
          const { mediaId, status, progress } = session;
          if (!mediaId || !status) return;
          // Only seed if we don't already have richer real-time data
          if (!state[mediaId]) {
            state[mediaId] = { status, progress: progress || 0, steps: {}, loading: false, error: null };
          } else if (!state[mediaId].status) {
            state[mediaId].status = status;
            state[mediaId].progress = progress || state[mediaId].progress || 0;
          }
        });
      });
  }
});

export const { applyPipelineEvent, clearPipelineState } = pipelineSlice.actions;
export default pipelineSlice.reducer;
