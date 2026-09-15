import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';

type SupportContext = {
  authenticated: boolean;
  supportName: string;
  role: string;
  institution: string | null;
  capabilities: {
    readOnly: boolean;
    supportDocumentation: boolean;
    escalationSummary: boolean;
  };
};

type Message = {
  role: 'user' | 'assistant';
  text: string;
};

type SupportKnowledgeDocument = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  content: string;
};

const TOPICS = [
  'Getting Started',
  'RAG & Documents',
  'Academic Agents',
  'Instructor Workflows',
  'Troubleshooting',
];

function scoreDocument(question: string, doc: SupportKnowledgeDocument): number {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);

  const haystack = [
    doc.title,
    doc.description ?? '',
    doc.category,
    doc.content,
  ]
    .join(' ')
    .toLowerCase();

  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

function knowledgeAnswer(
  question: string,
  context: SupportContext | null,
  knowledge: SupportKnowledgeDocument[],
): string {
  const ranked = knowledge
    .map((doc) => ({ doc, score: scoreDocument(question, doc) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.doc;

  if (best) {
    return `${best.title}\n\n${best.content}`;
  }

  const q = question.toLowerCase();

  if (q.includes('start') || q.includes('begin') || q.includes('how do i use')) {
    return `You are signed in as ${context?.role ?? 'an AIH user'}${
      context?.institution ? ` at ${context.institution}` : ''
    }. Ask about RAG, documents, Academic Agents, instructor workflows, or troubleshooting.`;
  }

  return 'I could not find a published AIH Support article that matches that question yet. Try one of the common topics or contact your institution administrator.';
}

export default function AIHHelpPanel() {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<SupportContext | null>(null);
  const [contextError, setContextError] = useState(false);
  const [knowledge, setKnowledge] = useState<SupportKnowledgeDocument[]>([]);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!open || context || contextError) {
      return;
    }

    let cancelled = false;

    fetch('/api/support/context', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Support context unavailable');
        }
        return (await response.json()) as SupportContext;
      })
      .then((data) => {
        if (!cancelled) {
          setContext(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContextError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, context, contextError]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch('/api/support/knowledge', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return { documents: [] };
        return (await response.json()) as {
          documents?: SupportKnowledgeDocument[];
        };
      })
      .then((data) => {
        if (!cancelled) {
          setKnowledge(Array.isArray(data.documents) ? data.documents : []);
        }
      })
      .catch(() => {
        if (!cancelled) setKnowledge([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const welcome = useMemo(() => {
    if (!context) {
      return 'I can help you use AI Scholar Hub.';
    }

    return `I can help you use AI Scholar Hub as ${context.role}${
      context.institution ? ` at ${context.institution}` : ''
    }.`;
  }, [context]);

  const submit = (value?: string) => {
    const question = String(value ?? input).trim();
    if (!question) {
      return;
    }

    setMessages((current) => [
      ...current,
      { role: 'user', text: question },
      { role: 'assistant', text: knowledgeAnswer(question, context, knowledge) },
    ]);
    setInput('');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-cyan-300/40 bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-xl shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2"
        aria-label="Open AIH Help"
      >
        <HelpCircle className="h-5 w-5" />
        <span className="hidden sm:inline">AIH Help</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close AIH Help"
            onClick={() => setOpen(false)}
          />

          <section
            className="relative flex h-full w-full max-w-md flex-col border-l border-border-light bg-surface-primary text-text-primary shadow-2xl"
            aria-label="AIH Help"
          >
            <header className="flex items-center justify-between border-b border-border-light bg-gradient-to-r from-cyan-500/10 via-sky-500/10 to-indigo-500/10 px-5 py-4">
              <div>
                <h2 className="bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 bg-clip-text text-lg font-bold text-transparent">AIH Support</h2>
                <p className="text-xs text-text-secondary">
                  Help with AI Scholar Hub
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 hover:bg-surface-secondary"
                aria-label="Close AIH Help"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {contextError ? (
                <div className="rounded-lg border border-border-light p-4 text-sm">
                  AIH Support is temporarily unavailable. You can continue using
                  AI Scholar Hub normally.
                </div>
              ) : (
                <>
                  <div className="mb-4 rounded-lg bg-surface-secondary p-4 text-sm">
                    <p className="font-medium">{welcome}</p>
                    {context?.institution && (
                      <p className="mt-1 text-xs text-text-secondary">
                        Institution: {context.institution}
                      </p>
                    )}
                  </div>

                  {messages.length === 0 && (
                    <div className="mb-5">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
                        Common topics
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {TOPICS.map((topic) => (
                          <button
                            key={topic}
                            type="button"
                            onClick={() => submit(topic)}
                            className="rounded-full border border-cyan-300/30 bg-gradient-to-r from-cyan-500/5 to-indigo-500/5 px-3 py-2 text-sm transition hover:border-cyan-400/50 hover:from-cyan-500/10 hover:to-indigo-500/10"
                          >
                            {topic}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={
                          message.role === 'user'
                            ? 'ml-8 rounded-xl bg-surface-secondary px-4 py-3 text-sm'
                            : 'mr-5 rounded-xl border border-border-light px-4 py-3 text-sm'
                        }
                      >
                        {message.text}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <form
              className="border-t border-border-light p-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  placeholder="Ask AIH for help..."
                  className="min-h-[48px] flex-1 resize-none rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary caret-text-primary outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-border-medium"
                />

                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500 p-3 text-white shadow-md transition hover:shadow-lg disabled:opacity-40"
                  aria-label="Send help question"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>

              <p className="mt-2 text-[11px] text-text-secondary">
                Do not enter passwords, API keys, access tokens, or other secrets.
              </p>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
