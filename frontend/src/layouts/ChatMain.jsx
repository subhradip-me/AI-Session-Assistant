import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import MarkdownIt from 'markdown-it';
import {
  Sparkles, MoreHorizontal, FileText, Loader2,
  CheckCircle2, XCircle, Clock, RefreshCw, Trash2,
  RotateCcw, Bot, Send, User, ChevronRight, Copy, Check,
  MessageSquare, Zap, Activity, AlertCircle
} from 'lucide-react';
import { fetchReport, clearCurrentReport } from '../slices/sessionSlice';
import { fetchPipelineStatus, retrySession, reprocessSession, deleteSession } from '../slices/pipelineSlice';
import { setSelectedSession } from '../slices/sessionSlice';

// ─── Chat persistence helpers ─────────────────────────────────────────────────
const CHAT_STORAGE_KEY = 'ama_chat_history';
function loadChats(sessionId) {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw);
    return all[sessionId] || [];
  } catch { return []; }
}
function saveChats(sessionId, msgs) {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    // Keep only the last 100 messages per session
    all[sessionId] = msgs.slice(-100);
    // Keep at most 20 sessions to avoid localStorage bloat
    const keys = Object.keys(all);
    if (keys.length > 20) {
      delete all[keys[0]];
    }
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(all));
  } catch { /* silent fail */ }
}

// ─── Markdown renderer (singleton) ────────────────────────────────────────────
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

function renderMarkdown(text) {
  if (!text) return '';
  // Normalise ##heading## → ## heading (some LLM outputs use this pattern)
  const normalised = text
    .replace(/##([^#\n]+?)##/g, '## $1')
    .replace(/###([^#\n]+?)###/g, '### $1');
  return md.render(normalised);
}

// ─── Pipeline Steps UI ─────────────────────────────────────────────────────────
// Maps backend step keys to display labels
const STEPS = [
  { key: 'transcription', label: 'Transcription',  desc: 'Converting audio to text' },
  { key: 'diarization',   label: 'Speaker ID',     desc: 'Identifying speakers'     },
  { key: 'grouping',      label: 'Grouping',        desc: 'Structuring conversation' },
  { key: 'analysis',      label: 'Analysis',        desc: 'Extracting insights'      },
  { key: 'blocks',        label: 'Block Analysis',  desc: 'Building context blocks'  },
  { key: 'report',        label: 'Report',          desc: 'Generating final report'  },
];

function StepIcon({ status }) {
  if (status === 'completed') return <CheckCircle2 className="w-[18px] h-[18px] text-emerald-500" />;
  if (status === 'failed')    return <XCircle      className="w-[18px] h-[18px] text-red-500" />;
  if (status === 'running')   return <Loader2      className="w-[18px] h-[18px] text-indigo-500 animate-spin" />;
  return <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-200" />;
}

function StepDetail({ step }) {
  if (!step) return null;
  if (step.completedChunks && step.totalChunks) {
    return (
      <span className="text-[12px] font-medium text-indigo-500">
        {step.completedChunks}/{step.totalChunks} chunks
      </span>
    );
  }
  if (step.processedSegments && step.totalSegments) {
    return (
      <span className="text-[12px] font-medium text-indigo-500">
        {step.processedSegments}/{step.totalSegments} segments
      </span>
    );
  }
  if (step.completedBlocks && step.totalBlocks) {
    return (
      <span className="text-[12px] font-medium text-indigo-500">
        {step.completedBlocks}/{step.totalBlocks} blocks
      </span>
    );
  }
  return null;
}

function PipelineProgress({ mediaId }) {
  const pipelineState = useSelector((s) => s.pipeline[mediaId]);
  const status   = pipelineState?.status || 'uploading';
  const steps    = pipelineState?.steps  || {};
  const progress = pipelineState?.progress || 0;
  const error    = pipelineState?.error;

  const activeStep = STEPS.find(({ key }) => steps[key]?.status === 'running');
  const completedCount = STEPS.filter(({ key }) => steps[key]?.status === 'completed').length;

  return (
    <div className="flex flex-col gap-5 py-8 px-2 animate-fade-in w-full max-w-xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
          <Activity className="w-5 h-5 text-indigo-500 animate-pulse" />
        </div>
        <div className="flex-1">
          <p className="text-[15px] font-semibold text-gray-900">
            {activeStep ? activeStep.label : 'Processing…'}
          </p>
          <p className="text-[13px] text-gray-400">
            {activeStep ? activeStep.desc : `Step ${completedCount} of ${STEPS.length} complete`}
          </p>
        </div>
        <span className="text-[18px] font-bold text-gray-900 tabular-nums">{progress}%</span>
      </div>

      {/* Progress bar */}
      <div className="w-full">
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #6366f1, #8b5cf6)'
            }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[11px] text-gray-400">Started</span>
          <span className="text-[11px] text-gray-400">{completedCount}/{STEPS.length} steps</span>
        </div>
      </div>

      {/* Steps */}
      <div className="w-full flex flex-col gap-1.5">
        {STEPS.map(({ key, label }) => {
          const s = steps[key]?.status || 'idle';
          const isRunning = s === 'running';
          const isDone = s === 'completed';
          const isFailed = s === 'failed';
          return (
            <div
              key={key}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300
                ${isRunning  ? 'bg-indigo-50/80   border-indigo-200 shadow-sm' :
                  isDone     ? 'bg-emerald-50/60  border-emerald-100' :
                  isFailed   ? 'bg-red-50         border-red-100' :
                               'bg-gray-50/50     border-[#ecece9]'}`}
            >
              <StepIcon status={s} />
              <div className="flex-1 min-w-0">
                <span className={`text-[14px] font-semibold
                  ${isRunning  ? 'text-indigo-700' :
                    isDone     ? 'text-emerald-700' :
                    isFailed   ? 'text-red-700' :
                                 'text-gray-400'}`}
                >
                  {label}
                </span>
              </div>
              {isRunning && <StepDetail step={steps[key]} />}
              {isRunning && !steps[key]?.completedChunks && (
                <span className="text-[12px] font-bold text-indigo-400 animate-pulse">Running</span>
              )}
              {isDone && (
                <span className="text-[12px] font-semibold text-emerald-500">Done</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {(status === 'failed' || error) && (
        <div className="w-full bg-red-50 border border-red-200 rounded-xl px-4 py-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-red-800 mb-0.5">Processing Failed</p>
            <p className="text-[13px] text-red-600">{error || 'An error occurred during processing.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Copyable Code helper ─────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      title="Copy response"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Report Summary Card ──────────────────────────────────────────────────────
function SessionReport({ report, onAskQuestion }) {
  if (!report) return null;

  const content      = report.reportContent || report.content || report.summary || '';
  const actionItems  = report.actionItems || [];
  const participants = report.participants || [];
  const suggested    = report.suggestedQuestions || [];

  return (
    <div className="flex flex-col gap-5 animate-slide-in">

      {/* Summary Card — light dark tinted panel */}
      {content && (
        <div className="rounded-2xl border border-[#e2e2df] bg-[#f5f5f3] overflow-hidden">
          {/* Card Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e2e2df] bg-[#efeeeb]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gray-800 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-[13px] font-semibold text-gray-800">Meeting Summary</span>
            </div>
            <CopyButton text={content} />
          </div>
          {/* Rendered Markdown */}
          <div
            className="report-body px-5 py-4"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Action Items</h3>
          <div className="flex flex-col gap-2">
            {actionItems.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <div className="w-5 h-5 rounded border-2 border-amber-300 shrink-0 mt-0.5" />
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
              <span key={i} className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-[12px] font-medium px-3 py-1.5 rounded-full border border-[#e8e8e6]">
                <span className="w-4 h-4 rounded-full bg-gray-700 text-white flex items-center justify-center text-[9px] font-bold">
                  {(p.name || p)[0]?.toUpperCase()}
                </span>
                {p.name || p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suggested Questions */}
      {suggested.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-3.5 h-3.5 text-indigo-400" />
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Ask AI</h3>
          </div>
          <div className="flex flex-col gap-1.5">
            {suggested.map((q, i) => (
              <button
                key={i}
                onClick={() => onAskQuestion(q)}
                className="group flex items-center gap-3 text-left px-4 py-2.5 rounded-xl border border-[#e8e8e6] bg-white hover:bg-indigo-50 hover:border-indigo-200 transition-all duration-150"
              >
                <span className="text-[13px] text-gray-700 group-hover:text-indigo-700 flex-1">{q}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-400 shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat divider */}
      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 h-px bg-[#e8e8e6]" />
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium">
          <MessageSquare className="w-3 h-3" />
          Chat with AI below
        </div>
        <div className="flex-1 h-px bg-[#e8e8e6]" />
      </div>
    </div>
  );
}

// ─── Chat Message Bubble ──────────────────────────────────────────────────────
function ChatBubble({ msg }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="flex items-end justify-end gap-2 animate-slide-in">
        <div className="max-w-[80%] bg-gray-900 text-white rounded-2xl rounded-br-md px-4 py-3 text-[14px] leading-relaxed">
          {msg.content}
        </div>
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mb-0.5">
          <User className="w-3.5 h-3.5 text-gray-600" />
        </div>
      </div>
    );
  }

  // AI bubble
  return (
    <div className="flex items-start gap-2 animate-slide-in">
      <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 max-w-[85%]">
        {msg.loading ? (
          <div className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <div className="group relative">
            <div
              className="report-body bg-[#f5f5f3] border border-[#e8e8e6] rounded-2xl rounded-tl-md px-4 py-3"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />
            <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton text={msg.content} />
              {msg.sources && msg.sources.length > 0 && (
                <span className="text-[11px] text-gray-400 pl-1">
                  {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''} referenced
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ChatMain Component ───────────────────────────────────────────────────
export default function ChatMain() {
  const dispatch    = useDispatch();
  const selectedId  = useSelector((s) => s.session.selectedSessionId);
  const sessions    = useSelector((s) => s.session.sessions);
  const report      = useSelector((s) => s.session.currentReport);
  const pipeline    = useSelector((s) => selectedId ? s.pipeline[selectedId] : null);
  const authToken   = useSelector((s) => s.auth.token);

  const [chatInput, setChatInput]   = useState('');
  const [messages, setMessages]     = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showChat, setShowChat]     = useState(false);

  const pollRef      = useRef(null);
  const messagesRef  = useRef(null);
  const inputRef     = useRef(null);
  // Use a ref to track live status inside the poll interval (avoids stale closure)
  const statusRef    = useRef('');

  const session    = sessions.find((s) => s.mediaId === selectedId);
  const status     = pipeline?.status || session?.status || '';
  // Include 'analyzing' — backend sets this as the main status for retry & reprocess
  const isProcessing = [
    'uploading', 'transcribing', 'diarizing', 'analyzing',
    'aggregating', 'reporting', 'grouping'
  ].includes(status);
  const isDone       = status === 'completed';
  const isFailed     = status === 'failed';
  const isRetrying    = pipeline?.retrying    || false;
  const isReprocessing = pipeline?.reprocessing || false;
  const actionError   = pipeline?.actionError  || null;

  // Keep statusRef in sync
  useEffect(() => { statusRef.current = status; }, [status]);

  // Load persisted messages when session changes
  useEffect(() => {
    if (selectedId) {
      const saved = loadChats(selectedId);
      setMessages(saved);
      setShowChat(saved.length > 0);
    } else {
      setMessages([]);
      setShowChat(false);
    }
    setChatInput('');
  }, [selectedId]);

  // Helper to start/restart the polling interval
  const startPolling = useCallback((id) => {
    if (pollRef.current) clearInterval(pollRef.current);
    dispatch(fetchPipelineStatus(id));
    pollRef.current = setInterval(() => {
      const cur = statusRef.current;
      if (cur === 'completed' || cur === 'failed' || cur === 'not_found') {
        clearInterval(pollRef.current);
        pollRef.current = null;
        return;
      }
      dispatch(fetchPipelineStatus(id));
    }, 4000);
  }, [dispatch]);

  // Fetch pipeline status + start polling when session selected
  useEffect(() => {
    if (!selectedId) return;
    startPolling(selectedId);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedId, startPolling]);

  // Fetch report once done
  useEffect(() => {
    if (isDone && selectedId && !report) {
      dispatch(fetchReport(selectedId));
    }
  }, [isDone, selectedId, report, dispatch]);

  // Auto-scroll messages
  useEffect(() => {
    if (messagesRef.current && showChat) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, showChat]);

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

  const handleSend = useCallback(async (question) => {
    const q = (question || chatInput).trim();
    if (!q || chatLoading) return;

    // Show chat view when first message sent
    setShowChat(true);
    setChatInput('');

    const userMsg = { id: Date.now(), role: 'user', content: q };
    const loadingMsg = { id: Date.now() + 1, role: 'ai', loading: true, content: '' };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setChatLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ mediaId: selectedId, question: q }),
      });

      const data = await res.json();
      const answer = data.answer || data.response || data.content || 'I could not find an answer in this session.';
      const sources = data.sources || data.context || [];

      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, content: answer, sources }
            : m
        );
        // Persist (exclude loading messages)
        saveChats(selectedId, updated.filter((m) => !m.loading));
        return updated;
      });
    } catch (err) {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, content: 'Sorry, an error occurred. Please try again.' }
            : m
        );
        saveChats(selectedId, updated.filter((m) => !m.loading));
        return updated;
      });
    } finally {
      setChatLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [chatInput, chatLoading, selectedId, authToken, API_BASE_URL]);

  const handleRetry = () => {
    dispatch(retrySession({ mediaId: selectedId })).then((result) => {
      if (!retrySession.rejected.match(result)) {
        startPolling(selectedId);
      }
    });
  };

  const handleReprocess = () => {
    // Clear the existing report and chat so UI shows progress again
    dispatch(clearCurrentReport());
    setMessages([]);
    setShowChat(false);
    saveChats(selectedId, []);
    dispatch(reprocessSession(selectedId)).then((result) => {
      if (!reprocessSession.rejected.match(result)) {
        startPolling(selectedId);
      }
    });
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this session permanently?')) return;
    await dispatch(deleteSession(selectedId));
    dispatch(setSelectedSession(null));
  };

  // ── Empty State ───────────────────────────────────────────────────────────
  if (!selectedId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-white items-center justify-center gap-5">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <Bot className="w-8 h-8 text-gray-400" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
        <div className="text-center max-w-xs">
          <h3 className="text-[16px] font-semibold text-gray-800 mb-1.5">Select a session</h3>
          <p className="text-[13px] text-gray-400 leading-relaxed">Choose a meeting recording from the left panel to view its AI-generated summary and chat with your data.</p>
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
              {isDone ? 'Complete' : isFailed ? 'Failed' : isProcessing ? 'Processing' : 'Queued'}
            </span>
          )}
          {showChat && messages.length > 0 && (
            <button
              onClick={() => setShowChat(false)}
              className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 px-2 py-0.5 rounded-md hover:bg-indigo-50 transition-colors"
            >
              ← Report
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Retry — shown when failed */}
          {isFailed && (
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              title="Retry failed stages"
            >
              {isRetrying
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {isRetrying ? 'Retrying…' : 'Retry'}
            </button>
          )}
          {/* Reprocess — shown when done or failed */}
          {(isDone || isFailed) && (
            <button
              onClick={handleReprocess}
              disabled={isReprocessing || isRetrying}
              className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              title="Reprocess: re-run full analysis pipeline from scratch"
            >
              {isReprocessing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RotateCcw className="w-3.5 h-3.5" />}
              {isReprocessing ? 'Reprocessing…' : 'Reprocess'}
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
              <div className="absolute right-0 top-full mt-1 bg-white border border-[#ecece9] rounded-xl shadow-xl z-20 w-56 overflow-hidden animate-scale-in">
                {isDone && (
                  <button
                    onClick={() => { handleReprocess(); setShowActions(false); }}
                    disabled={isReprocessing}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <RotateCcw className="w-4 h-4" /> Reprocess Session
                  </button>
                )}
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

      {/* Action error banner */}
      {actionError && (
        <div className="shrink-0 mx-6 mt-0 mb-0 border-b border-red-100 bg-red-50 px-4 py-2.5 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-[13px] text-red-700 font-medium flex-1">{actionError}</p>
        </div>
      )}

      {/* ── Report View (default) ────────────────────────────────────────────── */}
      {!showChat && (
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-7" onClick={() => setShowActions(false)}>
          <div className="max-w-3xl mx-auto pb-36">

            {/* Processing State */}
            {isProcessing && <PipelineProgress mediaId={selectedId} />}

            {/* Failed State */}
            {isFailed && !isProcessing && (
              <div className="flex flex-col items-center gap-5 py-12 animate-fade-in max-w-sm mx-auto">
                <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-500" />
                </div>
                <div className="text-center">
                  <h3 className="text-[16px] font-semibold text-gray-800 mb-1.5">Processing Failed</h3>
                  <p className="text-[13px] text-gray-500 leading-relaxed">
                    {pipeline?.error || 'Something went wrong during processing.'}
                  </p>
                </div>
                <div className="flex flex-col gap-2.5 w-full">
                  <button
                    onClick={handleRetry}
                    disabled={isRetrying || isReprocessing}
                    className="flex items-center justify-center gap-2 bg-gray-900 text-white text-[13px] font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed w-full"
                  >
                    {isRetrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {isRetrying ? 'Retrying…' : 'Retry Failed Stages'}
                  </button>
                  <button
                    onClick={handleReprocess}
                    disabled={isReprocessing || isRetrying}
                    className="flex items-center justify-center gap-2 bg-white border border-[#ecece9] text-gray-700 text-[13px] font-medium px-5 py-2.5 rounded-xl hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed w-full"
                  >
                    {isReprocessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    {isReprocessing ? 'Reprocessing…' : 'Full Reprocess'}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 text-center">
                  <span className="font-semibold text-gray-500">Retry</span> re-queues only missing stages · <span className="font-semibold text-gray-500">Reprocess</span> restarts from scratch
                </p>
              </div>
            )}

            {/* Report */}
            {isDone && report && (
              <SessionReport
                report={report}
                onAskQuestion={(q) => { handleSend(q); }}
              />
            )}

            {/* Done but no report yet */}
            {isDone && !report && (
              <div className="flex items-center justify-center gap-3 py-16">
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                <p className="text-[13px] text-gray-500">Loading report…</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Chat View ────────────────────────────────────────────────────────── */}
      {showChat && (
        <div ref={messagesRef} className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6" onClick={() => setShowActions(false)}>
          <div className="max-w-3xl mx-auto flex flex-col gap-5 pb-36">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
          </div>
        </div>
      )}

      {/* ── AI Chat Input Bar (shown when done) ─────────────────────────────── */}
      {(isDone || showChat) && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white/95 to-transparent pt-8 pb-5 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white border border-[#d8d8d5] shadow-[0_4px_24px_rgba(0,0,0,0.08)] rounded-2xl overflow-hidden focus-within:border-indigo-300 focus-within:shadow-[0_4px_24px_rgba(99,102,241,0.12)] transition-all duration-200">
              {/* Input row */}
              <div className="flex items-end px-4 pt-3.5 pb-3 gap-3">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 mb-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <textarea
                  ref={inputRef}
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);
                    // Auto-resize
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask AI anything about this session…"
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none resize-none text-[#37352f] placeholder:text-gray-400 text-[14px] font-medium leading-relaxed overflow-hidden max-h-[140px]"
                  aria-label="Ask AI about this session"
                  disabled={chatLoading}
                  style={{ height: 'auto' }}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!chatInput.trim() || chatLoading}
                  className="w-8 h-8 rounded-xl bg-gray-900 text-white flex items-center justify-center hover:bg-indigo-600 transition-colors shadow-sm disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-gray-900 shrink-0 mb-0.5"
                  aria-label="Send message"
                >
                  {chatLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {/* Footer hint */}
              <div className="px-4 pb-2.5 flex items-center justify-between">
                <span className="text-[11px] text-gray-400">
                  Press <kbd className="font-mono bg-gray-100 border border-[#e0e0de] rounded px-1 py-0.5 text-[10px]">Enter</kbd> to send · <kbd className="font-mono bg-gray-100 border border-[#e0e0de] rounded px-1 py-0.5 text-[10px]">Shift+Enter</kbd> for new line
                </span>
                <span className="text-[11px] text-gray-400">AI can make mistakes</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
