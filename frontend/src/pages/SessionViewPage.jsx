import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchReport, clearCurrentReport } from '../slices/sessionSlice';
import { IconLoader, IconSend } from '../components/Icons';
import axios from 'axios';

// ─── Lightweight markdown → HTML renderer ────────────────────────────────────
// No external dependency required.  Handles:
//   • # / ## / ### headings
//   • **bold** and *italic*
//   • - or * bullet lists
//   • blank-line paragraph breaks
// Output is sanitised — only our own generated tags, no exec of user input.
function parseMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const html = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // — Headings —
    if (/^### (.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h3 class="md-h3">${inlineFormat(line.replace(/^### /, ''))}</h3>`);
      continue;
    }
    if (/^## (.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h2 class="md-h2">${inlineFormat(line.replace(/^## /, ''))}</h2>`);
      continue;
    }
    if (/^# (.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h1 class="md-h1">${inlineFormat(line.replace(/^# /, ''))}</h1>`);
      continue;
    }

    // — Bullet list items (- or *) —
    if (/^[-*] (.+)/.test(line)) {
      if (!inList) { html.push('<ul class="md-ul">'); inList = true; }
      html.push(`<li class="md-li">${inlineFormat(line.replace(/^[-*] /, ''))}</li>`);
      continue;
    }

    // — End of list on blank or non-list line —
    if (inList) { html.push('</ul>'); inList = false; }

    // — Blank line → paragraph break —
    if (line.trim() === '') {
      html.push('<div class="md-spacer"></div>');
      continue;
    }

    // — Normal paragraph line —
    html.push(`<p class="md-p">${inlineFormat(line)}</p>`);
  }

  if (inList) html.push('</ul>');
  return html.join('');
}

// Bold (**text**) and italic (*text*)
function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

// ─── Component ────────────────────────────────────────────────────────────────
const SessionViewPage = () => {
  const { sessionId } = useParams();
  const dispatch = useDispatch();
  const { currentReport, processing, error } = useSelector((state) => state.session);
  const { token } = useSelector((state) => state.auth);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // ── Reset everything whenever sessionId changes ────────────────────────────
  useEffect(() => {
    dispatch(clearCurrentReport());
    dispatch(fetchReport(sessionId)); // immediate first fetch
    // Reset per-session chat history so sessions don't bleed into each other
    setChatMessages([]);
    setChatInput('');
  }, [sessionId, dispatch]);

  // ── Keep polling every 5 s until report arrives ────────────────────────────
  useEffect(() => {
    if (currentReport) return; // stop as soon as we have data

    const interval = setInterval(() => {
      dispatch(fetchReport(sessionId));
    }, 5000);

    return () => clearInterval(interval);
  }, [sessionId, currentReport, dispatch]);

  // ── Scroll chat to bottom ───────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleChat = async (e) => {
    e.preventDefault();
    const question = chatInput.trim();
    if (!question) return;

    setChatMessages(prev => [...prev, { role: 'user', text: question }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const response = await axios.post('http://localhost:5000/api/chat', {
        mediaId: sessionId,
        question
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', text: response.data.answer }
      ]);
    } catch (err) {
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChat(e);
    }
  };

  // ── Loading state ───────────────────────────────────────────────────────────
  if (!currentReport) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white gap-4">
        {error ? (
          <p className="text-sm text-red-400 font-medium">{error}</p>
        ) : (
          <>
            <IconLoader />
            <p className="text-sm text-[#9E9E9B] font-medium animate-pulse">
              Generating your session intelligence…
            </p>
          </>
        )}
      </div>
    );
  }

  // ── Report content ──────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col relative h-full bg-white">

      {/* Sticky header */}
      <header className="h-12 border-b border-[#EDEDEB] flex items-center px-6 justify-between shrink-0 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <span className="text-sm font-medium text-[#9E9E9B] truncate max-w-[60ch]">
          {currentReport?.mediaId || sessionId}
        </span>
        <span className="text-xs text-[#C5C4C0]">
          {currentReport?.createdAt
            ? new Date(currentReport.createdAt).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
              })
            : ''}
        </span>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-52">
        <div className="max-w-3xl mx-auto px-6 py-10 animate-fade-in-scale">

          {/* Report */}
          <div
            className="report-body"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(currentReport?.content) }}
          />

          {/* Chat history */}
          {chatMessages.length > 0 && (
            <div className="mt-10 space-y-4">
              <div className="h-px bg-[#EDEDEB]" />
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-[#37352F] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mr-3 mt-0.5">
                      AI
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-4 py-3 rounded-2xl text-[15px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#37352F] text-white rounded-br-sm'
                        : 'bg-[#F7F6F3] text-[#37352F] rounded-bl-sm'
                    }`}
                  >
                    {msg.role === 'assistant'
                      ? <div dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.text) }} />
                      : msg.text
                    }
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-full bg-[#37352F] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mr-3 mt-0.5">AI</div>
                  <div className="bg-[#F7F6F3] px-4 py-3 rounded-2xl rounded-bl-sm">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-[#9E9E9B] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-[#9E9E9B] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-[#9E9E9B] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Sticky chat input */}
      <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 bg-gradient-to-t from-white via-white/95 to-transparent">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleChat} className="relative">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about this session…"
              disabled={chatLoading}
              className="w-full min-h-[56px] max-h-[200px] py-4 pl-4 pr-14 bg-white border border-[#EDEDEB] rounded-2xl shadow-lg shadow-black/[0.04] focus:outline-none focus:border-[#D1D1CE] focus:ring-4 focus:ring-black/[0.03] transition-notion text-[15px] leading-relaxed resize-none disabled:opacity-50"
              rows="1"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="absolute bottom-3 right-3 w-8 h-8 rounded-lg bg-[#37352F] text-white flex items-center justify-center hover:bg-[#2F2E2A] transition-notion disabled:opacity-30"
            >
              {chatLoading
                ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                : <IconSend />
              }
            </button>
          </form>
          <p className="text-center text-[11px] text-[#C5C4C0] mt-2">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
};

export default SessionViewPage;
