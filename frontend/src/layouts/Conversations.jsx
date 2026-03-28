import React, { useState, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Search, Plus, MoreHorizontal, Upload, X, FileAudio, FileVideo, Loader2, Trash2 } from 'lucide-react';
import { setSelectedSession, uploadFile, fetchSessions } from '../slices/sessionSlice';
import { joinSessionRoom } from '../services/socket';
import { fetchPipelineStatus, deleteSession } from '../slices/pipelineSlice';

const STATUS_MAP = {
  uploading:    { label: 'Uploading',    cls: 'badge-uploading'  },
  transcribing: { label: 'Transcribing', cls: 'badge-processing' },
  diarizing:    { label: 'Diarizing',    cls: 'badge-processing' },
  analyzing:    { label: 'Analyzing',    cls: 'badge-processing' },
  completed:    { label: 'Complete',     cls: 'badge-complete'   },
  failed:       { label: 'Failed',       cls: 'badge-failed'     },
};

function StatusBadge({ status }) {
  const meta = STATUS_MAP[status] || { label: status || 'Queued', cls: 'badge-queued' };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${meta.cls}`}>
      {(status === 'uploading' || status === 'transcribing' || status === 'diarizing' || status === 'analyzing') && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
      )}
      {meta.label}
    </span>
  );
}

function UploadModal({ onClose, dispatch }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const inputRef = useRef();
  const { uploading, error } = useSelector((s) => s.session);

  const handleFile = (f) => {
    if (f) setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    const res = await dispatch(uploadFile(file));
    if (uploadFile.fulfilled.match(res)) {
      // Refresh list and close modal
      dispatch(fetchSessions());
      onClose();
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 bg-black/25 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#ecece9] w-full max-w-md flex flex-col animate-scale-in overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#ecece9] flex items-center justify-between bg-[#fbfbfa]">
          <h3 className="text-[15px] font-semibold text-gray-900">Upload Recording</h3>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-10 cursor-pointer transition-all duration-200 select-none
              ${dragging ? 'drop-zone-active' : 'border-gray-200 hover:border-gray-400 bg-gray-50/50 hover:bg-gray-50'}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <div className={`p-3 rounded-full transition-colors ${dragging ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-100 text-gray-500'}`}>
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-center">
              <p className="text-[14px] font-semibold text-gray-700">
                {dragging ? 'Drop the file here' : 'Drop a file or click to browse'}
              </p>
              <p className="text-[12px] text-gray-400 mt-0.5">Supports MP3, MP4, WAV, M4A, WEBM</p>
            </div>
          </div>

          {/* File Preview */}
          {file && (
            <div className="flex items-center gap-3 bg-gray-50 border border-[#ecece9] rounded-xl px-4 py-3 animate-slide-in">
              <div className="p-2 rounded-lg bg-white border border-[#ecece9] shadow-sm">
                {file.type.startsWith('video') ? (
                  <FileVideo className="w-5 h-5 text-indigo-500" />
                ) : (
                  <FileAudio className="w-5 h-5 text-emerald-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-gray-800 truncate">{file.name}</p>
                <p className="text-[11px] text-gray-400">{formatFileSize(file.size)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); }}
                className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                aria-label="Remove file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-[12px] text-red-600 font-medium bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#ecece9] bg-[#fbfbfa] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[13px] font-medium text-gray-600 px-4 py-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="flex items-center gap-2 text-[13px] font-semibold text-white bg-gray-900 px-4 py-2 rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="w-4 h-4" /> Upload</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Conversations() {
  const dispatch = useDispatch();
  const sessions = useSelector((s) => s.session.sessions);
  const selectedId = useSelector((s) => s.session.selectedSessionId);
  const pipeline = useSelector((s) => s.pipeline);
  const [query, setQuery] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null); // mediaId of session with open menu
  const [deletingId, setDeletingId] = useState(null); // mediaId currently being deleted
  const menuRef = useRef(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  // On load: re-fetch status for all sessions so badges are current after reload
  useEffect(() => {
    if (sessions.length > 0) {
      sessions.forEach((s) => {
        const st = pipeline[s.mediaId]?.status || s.status;
        // Skip already-terminal or already-resolved sessions
        if (st !== 'completed' && st !== 'failed' && st !== 'not_found') {
          dispatch(fetchPipelineStatus(s.mediaId));
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length]);

  const filtered = sessions.filter((s) =>
    s.originalFilename?.toLowerCase().includes(query.toLowerCase()) ||
    s.title?.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (session) => {
    const id = session.mediaId;
    dispatch(setSelectedSession(id));
    joinSessionRoom(id);
  };

  const getStatus = (session) => {
    const id = session.mediaId;
    return pipeline[id]?.status || session.status || 'queued';
  };

  const handleDelete = async (e, mediaId) => {
    e.stopPropagation();
    setMenuOpenId(null);
    if (!window.confirm('Permanently delete this session and all its analysis data? This cannot be undone.')) return;
    setDeletingId(mediaId);
    try {
      await dispatch(deleteSession(mediaId));
      // Clear persisted chat history for this session from localStorage
      try {
        const raw = localStorage.getItem('ama_chat_history');
        if (raw) {
          const all = JSON.parse(raw);
          delete all[mediaId];
          localStorage.setItem('ama_chat_history', JSON.stringify(all));
        }
      } catch { /* silent */ }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="w-[272px] border-r border-[#ecece9] flex flex-col h-full bg-[#fbfbfa] shrink-0">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-gray-900 uppercase tracking-wider">Sessions</h2>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 bg-gray-900 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-all active:scale-95 shadow-sm"
              title="Upload a new recording"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              className="w-full bg-white border border-[#ecece9] text-gray-700 rounded-lg py-1.5 pl-8 pr-3 text-[13px] font-medium outline-none focus:ring-1 focus:ring-indigo-200 focus:border-indigo-300 transition-all placeholder:text-gray-400 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
              aria-label="Search sessions"
            />
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4 space-y-0.5">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 px-4 text-center">
              <div className="p-3 rounded-full bg-gray-100">
                <Upload className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-600">
                  {query ? 'No sessions found' : 'No sessions yet'}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {query ? 'Try a different search term' : 'Upload a recording to get started'}
                </p>
              </div>
              {!query && (
                <button
                  onClick={() => setShowUpload(true)}
                  className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  Upload now →
                </button>
              )}
            </div>
          )}

          {filtered.map((session) => {
            const id = session.mediaId; // Always mediaId — consistent with pipeline slice keys
            const isActive = selectedId === id;
            const status = getStatus(session);
            const title = session.title || session.originalFilename || 'Untitled Session';

            return (
              <div
                key={id}
                onClick={() => handleSelect(session)}
                className={`group flex flex-col p-3 rounded-xl cursor-pointer transition-all duration-150 border relative
                  ${isActive
                    ? 'bg-white border-[#ecece9] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
                    : 'border-transparent hover:bg-white hover:border-[#ecece9] hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
                  }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className={`text-[13px] font-semibold leading-tight truncate flex-1 ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
                    {title}
                  </h4>

                  {/* Options button */}
                  <div className="relative shrink-0" ref={menuOpenId === id ? menuRef : null}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === id ? null : id);
                      }}
                      className={`p-0.5 rounded transition-all ${
                        deletingId === id
                          ? 'text-gray-300 cursor-wait'
                          : 'text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100'
                      }`}
                      aria-label="Session options"
                      disabled={deletingId === id}
                    >
                      {deletingId === id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <MoreHorizontal className="w-3.5 h-3.5" />}
                    </button>

                    {/* Dropdown menu */}
                    {menuOpenId === id && (
                      <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#ecece9] rounded-xl shadow-lg z-50 overflow-hidden animate-scale-in">
                        <button
                          onClick={(e) => handleDelete(e, id)}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          Delete Session
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[12px] text-gray-400">{formatDate(session.createdAt)}</span>
                  <StatusBadge status={status} />
                </div>
              </div>
            );
          })}

        </div>
      </div>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} dispatch={dispatch} />
      )}
    </>
  );
}
