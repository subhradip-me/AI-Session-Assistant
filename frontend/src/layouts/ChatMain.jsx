import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Sparkles, MoreHorizontal, FileText, Loader2,
  CheckCircle2, XCircle, Clock, RefreshCw, Trash2,
  RotateCcw, ChevronDown, Bot, Send
} from 'lucide-react';
import { fetchReport } from '../slices/sessionSlice';
import { fetchPipelineStatus, retrySession, reprocessSession, deleteSession } from '../slices/pipelineSlice';
import { setSelectedSession } from '../slices/sessionSlice';

// ─── Pipeline Steps UI ─────────────────────────────────────────────────────────
const STEPS = [
  { key: 'upload',      label: 'Upload'       },
  { key: 'transcribe',  label: 'Transcription' },
  { key: 'diarize',     label: 'Speaker ID'   },
  { key: 'analyze',     label: 'Analysis'     },
  { key: 'report',      label: 'Report'       },
];

function StepIcon({ status }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === 'failed')    return <XCircle className="w-4 h-4 text-red-500" />;
  if (status === 'running')   return <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />;
  return <Clock className="w-4 h-4 text-gray-300" />;
}

function PipelineProgress({ mediaId }) {
  const dispatch = useDispatch();
  const pipelineState = useSelector((s) => s.pipeline[mediaId]);
  const status   = pipelineState?.status || 'uploading';
  const steps    = pipelineState?.steps  || {};
  const progress = pipelineState?.progress || 0;
  const error    = pipelineState?.error;

  return (
    <div className="flex flex-col gap-6 py-8 px-2 items-center animate-fade-in w-full max-w-xl mx-auto">
      {/* Progress bar */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider">Processing</span>
          <span className="text-[12px] font-bold text-gray-900">{progress}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="w-full flex flex-col gap-2">
        {STEPS.map(({ key, label }) => {
          const s = steps[key]?.status || 'idle';
          return (
            <div
              key={key}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300
                ${s === 'running'   ? 'bg-indigo-50   border-indigo-100' :
                  s === 'completed' ? 'bg-emerald-50  border-emerald-100' :
                  s === 'failed'    ? 'bg-red-50      border-red-100' :
                                     'bg-gray-50      border-[#ecece9]'}`}
            >
              <StepIcon status={s} />
              <span className={`text-[13px] font-medium flex-1
                ${s === 'running'   ? 'text-indigo-700' :
                  s === 'completed' ? 'text-emerald-700' :
                  s === 'failed'    ? 'text-red-700' :
                                     'text-gray-400'}`}
              >
                {label}
              </span>
              {steps[key]?.completedChunks && steps[key]?.totalChunks && (
                <span className="text-[11px] text-gray-400">
                  {steps[key].completedChunks}/{steps[key].totalChunks} chunks
                </span>
              )}
              {s === 'running' && (
                <span className="text-[11px] font-semibold text-indigo-400 animate-pulse">In Progress</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {(status === 'failed' || error) && (
        <div className="w-full bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-[13px] font-semibold text-red-800 mb-0.5">Processing Failed</p>
          <p className="text-[12px] text-red-600">{error || 'An error occurred during processing.'}</p>
        </div>
      )}
    </div>
  );
}

// ─── Report Rendering ──────────────────────────────────────────────────────────
function SessionReport({ report }) {
  if (!report) return null;

  const content = report.reportContent || report.content || report.summary || '';
  const actionItems = report.actionItems || [];
  const participants = report.participants || [];

  return (
    <div className="flex flex-col gap-6 animate-slide-in">
      {/* Summary */}
      {content && (
        <div>
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Summary</h3>
          <div className="report-body" dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br/>') }} />
        </div>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Action Items</h3>
          <div className="flex flex-col gap-2">
            {actionItems.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-gray-50 border border-[#ecece9] rounded-xl px-4 py-3">
                <div className="w-5 h-5 rounded border-2 border-gray-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-800">{item.description || item.text || item}</p>
                  {item.assignee && (
                    <p className="text-[11px] text-gray-400 mt-0.5">Assigned to: <span className="font-semibold text-gray-600">{item.assignee}</span></p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Participants */}
      {participants.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Participants</h3>
          <div className="flex flex-wrap gap-2">
            {participants.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-[12px] font-medium px-3 py-1.5 rounded-full">
                <span className="w-4 h-4 rounded-full bg-gray-300 text-gray-600 flex items-center justify-center text-[9px] font-bold">
                  {(p.name || p)[0]?.toUpperCase()}
                </span>
                {p.name || p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ChatMain Component ───────────────────────────────────────────────────
export default function ChatMain() {
  const dispatch = useDispatch();
  const selectedId = useSelector((s) => s.session.selectedSessionId);
  const sessions   = useSelector((s) => s.session.sessions);
  const report     = useSelector((s) => s.session.currentReport);
  const pipeline   = useSelector((s) => selectedId ? s.pipeline[selectedId] : null);
  const [chatInput, setChatInput] = useState('');
  const [showActions, setShowActions] = useState(false);
  const pollRef = useRef(null);

  const session = sessions.find((s) => (s._id || s.mediaId) === selectedId);
  const status  = pipeline?.status || session?.status || '';
  const isProcessing = ['uploading', 'transcribing', 'diarizing', 'analyzing'].includes(status);
  const isDone       = status === 'completed';
  const isFailed     = status === 'failed';

  // Fetch pipeline status + report when session selected
  useEffect(() => {
    if (!selectedId) return;

    dispatch(fetchPipelineStatus(selectedId));

    // Clear previous poll
    if (pollRef.current) clearInterval(pollRef.current);

    // Poll while processing
    pollRef.current = setInterval(() => {
      const currentStatus = pipeline?.status;
      if (currentStatus === 'completed' || currentStatus === 'failed') {
        clearInterval(pollRef.current);
        return;
      }
      dispatch(fetchPipelineStatus(selectedId));
    }, 4000);

    return () => clearInterval(pollRef.current);
  }, [selectedId, dispatch]);

  // Fetch report once done
  useEffect(() => {
    if (isDone && selectedId && !report) {
      dispatch(fetchReport(selectedId));
    }
  }, [isDone, selectedId, report, dispatch]);

  const handleRetry    = () => { dispatch(retrySession({ mediaId: selectedId })).then(() => dispatch(fetchPipelineStatus(selectedId))); };
  const handleReprocess = () => { dispatch(reprocessSession(selectedId)).then(() => dispatch(fetchPipelineStatus(selectedId))); };
  const handleDelete   = async () => {
    if (!window.confirm('Delete this session permanently?')) return;
    await dispatch(deleteSession(selectedId));
    dispatch(setSelectedSession(null));
  };

  // ── Empty State ───────────────────────────────────────────────────────────
  if (!selectedId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-white items-center justify-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
          <Bot className="w-7 h-7 text-gray-400" />
        </div>
        <div className="text-center">
          <h3 className="text-[15px] font-semibold text-gray-700 mb-1">Select a session</h3>
          <p className="text-[13px] text-gray-400">Choose a session from the left to view its summary and AI analysis.</p>
        </div>
      </div>
    );
  }

  const title = session?.title || session?.originalFilename || 'Session';

  // ── Session View ──────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">

      {/* Header */}
      <div className="h-14 border-b border-[#ecece9] flex items-center justify-between px-6 shrink-0 bg-white z-10 w-full">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
          <h2 className="text-[14px] font-semibold text-gray-800 truncate">{title}</h2>
          {status && (
            <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md
              ${isDone    ? 'badge-complete' :
                isFailed  ? 'badge-failed'   :
                isProcessing ? 'badge-processing' : 'badge-queued'}`}>
              {isProcessing && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />}
              {isDone   ? 'Complete' : isFailed ? 'Failed' : isProcessing ? 'Processing' : 'Queued'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isFailed && (
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
              title="Retry analysis"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          )}
          {isDone && (
            <button
              onClick={handleReprocess}
              className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="Reprocess session"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reprocess
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showActions && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[#ecece9] rounded-xl shadow-xl z-20 w-48 overflow-hidden animate-scale-in">
                <button
                  onClick={() => { handleDelete(); setShowActions(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete Session
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-8" onClick={() => setShowActions(false)}>
        <div className="max-w-3xl mx-auto pb-32">

          {/* Processing State */}
          {isProcessing && <PipelineProgress mediaId={selectedId} />}

          {/* Failed State */}
          {isFailed && !isProcessing && (
            <div className="flex flex-col items-center gap-4 py-12 animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-500" />
              </div>
              <div className="text-center">
                <h3 className="text-[15px] font-semibold text-gray-800 mb-1">Processing Failed</h3>
                <p className="text-[13px] text-gray-500">
                  {pipeline?.error || 'Something went wrong during processing.'}
                </p>
              </div>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 bg-gray-900 text-white text-[13px] font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors shadow-sm"
              >
                <RefreshCw className="w-4 h-4" /> Retry Processing
              </button>
            </div>
          )}

          {/* Report */}
          {isDone && report && <SessionReport report={report} />}

          {/* Done but no report yet */}
          {isDone && !report && (
            <div className="flex items-center justify-center gap-3 py-16">
              <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              <p className="text-[13px] text-gray-500">Loading report…</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Chat Input */}
      {isDone && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-3xl px-6 pointer-events-none">
          <div className="bg-white border border-[#ecece9] shadow-[0_4px_24px_rgba(0,0,0,0.07)] rounded-xl relative focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-200 transition-all flex items-center min-h-[52px] pl-4 pr-2 py-2 pointer-events-auto gap-2">
            <Sparkles className="w-4 h-4 text-gray-300 shrink-0" />
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask AI about this session…"
              className="flex-1 bg-transparent border-none outline-none text-[#37352f] placeholder:text-gray-400 text-[14px] font-medium"
              aria-label="Ask AI about this session"
            />
            <button
              disabled={!chatInput.trim()}
              className="bg-gray-900 text-white p-2 rounded-lg hover:bg-indigo-600 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              aria-label="Send message"
              onClick={() => setChatInput('')}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center mt-2.5 text-[11px] font-medium text-gray-400 pointer-events-none">
            AI can make mistakes. Verify important information with the source transcript.
          </p>
        </div>
      )}
    </div>
  );
}
