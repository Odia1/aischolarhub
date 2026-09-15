import { useAuthContext } from '~/hooks/AuthContext';
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
  'What can I use?',
  'Getting Started',
  'RAG & Documents',
  'Academic Agents',
  'Troubleshooting',
];

const SUPPORT_STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'can',
  'do',
  'for',
  'how',
  'i',
  'in',
  'is',
  'me',
  'my',
  'of',
  'on',
  'the',
  'to',
  'use',
  'what',
  'with',
]);

function meaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (word) =>
        word.length >= 3 &&
        !SUPPORT_STOP_WORDS.has(word),
    );
}

function scoreDocument(question: string, doc: SupportKnowledgeDocument): number {
  const words = meaningfulWords(question);

  if (words.length === 0) {
    return 0;
  }

  const title = doc.title.toLowerCase();
  const description = (doc.description ?? '').toLowerCase();
  const category = doc.category.toLowerCase();
  const content = doc.content.toLowerCase();

  return words.reduce((score, word) => {
    if (title.includes(word)) score += 6;
    if (description.includes(word)) score += 4;
    if (category.includes(word)) score += 3;
    if (content.includes(word)) score += 1;
    return score;
  }, 0);
}

function conciseKnowledgeAnswer(doc: SupportKnowledgeDocument): string {
  const content = doc.content.trim();

  /*
   * AIH Help should answer a user question, not reproduce an entire manual
   * article. Keep enough of the authoritative document to be useful while
   * leaving the full Support Knowledge document as the source of truth.
   */
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  let answer = '';

  for (const paragraph of paragraphs) {
    const candidate = answer
      ? `${answer}\n\n${paragraph}`
      : paragraph;

    if (candidate.length > 900 && answer) {
      break;
    }

    answer = candidate;

    if (answer.length >= 650) {
      break;
    }
  }

  if (!answer) {
    answer = doc.description ?? 'Relevant AIH Support guidance is available.';
  }

  if (answer.length > 1000) {
    answer = `${answer.slice(0, 997).trimEnd()}...`;
  }

  return `${doc.title}\n\n${answer}`;
}

function knowledgeAnswer(
  question: string,
  context: SupportContext | null,
  knowledge: SupportKnowledgeDocument[],
): string {
  const q = question.toLowerCase().trim();

  /*
   * Common natural-language questions should receive direct, role-aware
   * answers instead of being forced through document keyword matching.
   */
  if (
    q === 'what can i use?' ||
    q === 'what can i use' ||
    q.includes('what can i do') ||
    q.includes('what is available') ||
    q.includes('what features')
  ) {
    const institution = context?.institution
      ? ` at ${context.institution}`
      : '';

    return `As ${context?.role ?? 'an AIH user'}${institution}, you can use the AI Scholar Hub experiences and tools enabled for your account. These may include normal AI chat, your assigned learning experience, approved Academic Agents, and authorized personal, course, group, or institutional knowledge through RAG. What you see depends on your role, institution, group membership, and permissions.`;
  }

  if (
    q === 'academic agents' ||
    q.includes('what are academic agents') ||
    q.includes('how do i use an academic agent')
  ) {
    return 'Academic Agents are specialized AI assistants for particular learning, teaching, or research tasks. Choose an agent that matches what you want to do, ask your question clearly, and use only documents or institutional knowledge you are authorized to access. The agents available to you depend on your role and institution.';
  }

  /*
   * Personal-document workflow questions need an actionable answer rather
   * than the general RAG documentation article.
   */
  if (
    q.includes('upload document') ||
    q.includes('upload a document') ||
    q.includes('upload my document') ||
    q.includes('upload file') ||
    q.includes('upload a file') ||
    q.includes('upload my file') ||
    q.includes('add document') ||
    q.includes('add a document') ||
    q.includes('add my document') ||
    q.includes('add file') ||
    q.includes('add a file') ||
    q.includes('give my document') ||
    q.includes('give my documents') ||
    q.includes('my documents') ||
    q.includes('my files') ||
    q.includes('attach document') ||
    q.includes('attach file')
  ) {
    return 'To use one of your own documents, open **Knowledge Sources** in the chat interface, choose the option for your personal documents or files, and upload the permitted file. Wait until processing completes, then return to the conversation and ask a question about that document. Only documents and Knowledge Sources that you are authorized to use will be available.';
  }

  if (
    q.includes('rag') ||
    q.includes('knowledge source') ||
    q.includes('document')
  ) {
    const ragDoc = knowledge.find(
      (doc) =>
        doc.category === 'RAG' ||
        doc.title.toLowerCase().includes('rag'),
    );

    if (ragDoc) {
      return conciseKnowledgeAnswer(ragDoc);
    }
  }

  if (
    q.includes('password') ||
    q.includes('token') ||
    q.includes('privacy') ||
    q.includes('security') ||
    q.includes('permission')
  ) {
    const securityDoc = knowledge.find(
      (doc) =>
        doc.category === 'SECURITY_PRIVACY' ||
        doc.title.toLowerCase().includes('security'),
    );

    if (securityDoc) {
      return conciseKnowledgeAnswer(securityDoc);
    }
  }

  if (
    q.includes('start') ||
    q.includes('begin') ||
    q.includes('how do i use')
  ) {
    return `You are signed in as ${context?.role ?? 'an AIH user'}${
      context?.institution ? ` at ${context.institution}` : ''
    }. You can ask me how to use AI Scholar Hub, RAG and documents, Academic Agents, or how to resolve a visible problem.`;
  }

  const ranked = knowledge
    .map((doc) => ({ doc, score: scoreDocument(question, doc) }))
    .filter(({ score }) => score >= 3)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.doc;

  if (best) {
    return conciseKnowledgeAnswer(best);
  }

  return 'I could not find a close match in the published AIH Support guidance. Try asking about getting started, RAG and documents, Academic Agents, account access, or troubleshooting. If the issue involves access that you believe should be available, contact your instructor or Institution Admin.';
}

export default function AIHHelpPanel() {
  const { token } = useAuthContext();
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
        Authorization: `Bearer ${token}`,
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
  }, [open, context, contextError, token]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch('/api/support/knowledge', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
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
  }, [open, token]);

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
