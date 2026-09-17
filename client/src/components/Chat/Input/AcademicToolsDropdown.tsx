import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, ArrowLeft } from 'lucide-react';
import { useGetStartupConfig } from '~/data-provider';

interface AcademicToolsDropdownProps {
  disabled?: boolean;
  specName?: string | null;
}

type AIHModelSpec = {
  name?: string;
  label?: string;
  description?: string;
  academicAgentType?: string;
  academicAgentId?: string;
};

const PRIMARY_KEY = 'aih-primary-academic-experience';

function selectModelSpec(specName: string) {
  window.dispatchEvent(
    new CustomEvent('aih:select-model-spec', {
      detail: { specName },
    }),
  );
}

function isAgent(spec?: AIHModelSpec | null) {
  return String(spec?.academicAgentType || '')
    .trim()
    .toUpperCase() === 'AGENT';
}

const AcademicToolsDropdown = ({
  disabled = false,
  specName,
}: AcademicToolsDropdownProps) => {
  const [open, setOpen] = useState(false);
  const { data: startupConfig } = useGetStartupConfig();

  const allSpecs =
    (startupConfig?.modelSpecs?.list ?? []) as AIHModelSpec[];

  const availableAgents = useMemo(
    () =>
      allSpecs
        .filter(isAgent)
        .filter((spec) => typeof spec.name === 'string' && spec.name.trim())
        .sort((a, b) =>
          String(a.label || a.name || '')
            .localeCompare(String(b.label || b.name || '')),
        ),
    [allSpecs],
  );

  const activeAgent = useMemo(
    () => availableAgents.find((spec) => spec.name === specName) ?? null,
    [availableAgents, specName],
  );

  const currentSpec = useMemo(
    () => allSpecs.find((spec) => spec.name === specName) ?? null,
    [allSpecs, specName],
  );

  const chooseAgent = (spec: AIHModelSpec) => {
    if (!isAgent(currentSpec) && specName) {
      localStorage.setItem(PRIMARY_KEY, specName);
    }

    if (spec.name) {
      selectModelSpec(spec.name);
    }

    setOpen(false);
  };

  const restorePrimary = () => {
    const primary = localStorage.getItem(PRIMARY_KEY);

    if (primary) {
      selectModelSpec(primary);
    }

    setOpen(false);
  };

  if (availableAgents.length === 0) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Academic Agents"
        title="Bring in a specialized Academic Agent for this task"
        className={[
          'group inline-flex h-8 shrink-0 items-center gap-1.5',
          'rounded-full border border-violet-200',
          'bg-violet-50 px-2.5 text-xs font-medium text-violet-800',
          'shadow-sm transition-all duration-200',
          'hover:border-violet-300 hover:bg-violet-100 hover:shadow',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-violet-300',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'dark:border-violet-800 dark:bg-violet-950/30',
          'dark:text-violet-200 dark:hover:bg-violet-950/50',
        ].join(' ')}
      >
        <Sparkles
          className="size-4 transition-transform group-hover:scale-105"
          aria-hidden="true"
        />
        <span className="whitespace-nowrap">
          Agents
        </span>
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[260] flex items-end justify-center bg-black/20 p-3 backdrop-blur-[2px] sm:items-center"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setOpen(false);
              }
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Academic Agents"
              className={[
                'flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl',
                'border border-slate-200 bg-white',
                'shadow-[0_24px_80px_rgba(15,23,42,0.22)]',
                'dark:border-border-light dark:bg-surface-dialog',
              ].join(' ')}
            >
              <header className="border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-sky-50 px-5 py-4 dark:border-border-light dark:from-violet-950/20 dark:via-surface-dialog dark:to-sky-950/20">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                      <Sparkles className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-base font-semibold text-text-primary">
                        Academic Agents
                      </h2>
                      <p className="mt-0.5 text-xs text-text-secondary">
                        Bring in specialized academic help for the current task.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close Academic Agents"
                    title="Close"
                    className="rounded-full p-2 text-text-secondary transition-colors hover:bg-slate-100 hover:text-text-primary dark:hover:bg-surface-tertiary"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 sm:p-4">
                {activeAgent && localStorage.getItem(PRIMARY_KEY) && (
                  <button
                    type="button"
                    onClick={restorePrimary}
                    title="Return to your underlying Primary Experience"
                    className="mb-2 flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-medium text-text-primary transition-colors hover:bg-slate-100 dark:border-border-light dark:bg-surface-secondary dark:hover:bg-surface-tertiary"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Return to Primary Experience
                  </button>
                )}

                {availableAgents.map((spec) => {
                  const active = spec.name === specName;
                  const label = String(spec.label || spec.name || 'Academic Agent');
                  const description =
                    String(spec.description || '').trim() ||
                    'Use this specialized Academic Agent for the current task.';

                  return (
                    <button
                      key={spec.name}
                      type="button"
                      onClick={() => chooseAgent(spec)}
                      title={description}
                      className={[
                        'flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-all duration-200 sm:p-3.5',
                        active
                          ? 'border-violet-300 bg-violet-50 shadow-sm ring-1 ring-violet-200 dark:border-violet-700 dark:bg-violet-950/30'
                          : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/50 hover:shadow-sm dark:border-border-light dark:bg-surface-dialog dark:hover:bg-surface-secondary',
                      ].join(' ')}
                    >
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                        <Sparkles className="size-4" aria-hidden="true" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold leading-5 text-text-primary">
                            {label}
                          </span>

                          {active && (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                              Active
                            </span>
                          )}
                        </span>

                        <span className="mt-1 block text-sm leading-5 text-text-secondary">
                          {description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <footer className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] leading-4 text-text-secondary sm:px-5 sm:py-3 sm:text-xs dark:border-border-light dark:bg-surface-secondary">
                Your role, permissions and Knowledge Source boundaries remain in effect.
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
};

export default React.memo(AcademicToolsDropdown);
