import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../api/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  toolHint?: string;
}

interface PageContext {
  path: string;
  title: string;
  video_slug?: string;
}

interface AssistantWidgetProps {
  videoSlug?: string;
}

export const AssistantWidget: React.FC<AssistantWidgetProps> = ({ videoSlug }) => {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isAdminPage = location.pathname.startsWith('/admin');

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pageContext: PageContext = {
    path: location.pathname,
    title: document.title,
    video_slug: videoSlug,
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);

    // Placeholder for streaming assistant response
    const assistantIdx = nextMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${API_BASE}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          page_context: pageContext,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: 'Error: could not reach assistant.', streaming: false };
          return updated;
        });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'token') {
              setMessages(prev => {
                const updated = [...prev];
                updated[assistantIdx] = {
                  ...updated[assistantIdx],
                  content: updated[assistantIdx].content + event.content,
                  toolHint: undefined,
                };
                return updated;
              });
            } else if (event.type === 'tool_start') {
              setMessages(prev => {
                const updated = [...prev];
                updated[assistantIdx] = {
                  ...updated[assistantIdx],
                  toolHint: event.message || `Working…`,
                };
                return updated;
              });
            } else if (event.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                updated[assistantIdx] = {
                  role: 'assistant',
                  content: `⚠️ ${event.message}`,
                  streaming: false,
                };
                return updated;
              });
            } else if (event.type === 'done') {
              setMessages(prev => {
                const updated = [...prev];
                updated[assistantIdx] = { ...updated[assistantIdx], streaming: false, toolHint: undefined };
                return updated;
              });
            }
          } catch {
            // skip malformed SSE line
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', content: 'Connection error. Please try again.', streaming: false };
        return updated;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming, pageContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Don't render on admin pages or when not logged in
  if (isAdminPage || !user) return null;

  return (
    <>
      {/* Floating action button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
          aria-label="Open AI assistant"
        >
          <span className="material-symbols-outlined text-white text-2xl">smart_toy</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"
          style={{ height: '520px' }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <span className="material-symbols-outlined text-primary text-xl">smart_toy</span>
            <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 flex-1">Portal Assistant</span>
            <button
              onClick={() => { setOpen(false); abortRef.current?.abort(); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              aria-label="Close assistant"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          {/* Message list */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-8">
                Ask me anything about the portal — videos, articles, solutions, marketplace components, or your request statuses.
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                }`}>
                  {msg.toolHint && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs animate-spin">progress_activity</span>
                      {msg.toolHint}
                    </p>
                  )}
                  {msg.content || (msg.streaming && !msg.toolHint ? (
                    <span className="inline-block w-2 h-4 bg-current opacity-70 animate-pulse rounded-sm" />
                  ) : null)}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask something…"
              disabled={streaming}
              className="flex-1 text-sm bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 placeholder-slate-400"
            />
            <button
              onClick={send}
              disabled={!input.trim() || streaming}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors"
              aria-label="Send"
            >
              <span className="material-symbols-outlined text-lg">send</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
