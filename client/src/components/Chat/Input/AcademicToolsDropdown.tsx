import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GraduationCap,
  ShieldCheck,
  SearchCheck,
  Network,
  X,
  ArrowLeft,
} from 'lucide-react';
import { useGetStartupConfig } from '~/data-provider';

interface AcademicToolsDropdownProps {
  disabled?: boolean;
  specName?: string | null;
}

const PREFIX = 'AIH Academic Agent · ';

const AGENTS = [
  {
    id: 'EVIDENCE_OF_LEARNING',
    learnerLabel: 'Show What I Know',
    facultyLabel: 'Assess Understanding',
    category: 'Learning & Assessment',
    description:
      'Demonstrate understanding through a short adaptive oral review.',
    Icon: ShieldCheck,
    tone:
      'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200',
    iconTone:
      'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
  },
  {
    id: 'RESEARCH_CLAIM_AUDITOR',
    learnerLabel: 'Audit Research Claims',
    facultyLabel: 'Audit Research Claims',
    category: 'Research & Scholarship',
    description:
      'Check whether important scholarly claims are actually supported.',
    Icon: SearchCheck,
    tone:
      'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
    iconTone:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
  },
  {
    id: 'CURRICULUM_COHERENCE',
    learnerLabel: 'Review Curriculum Coherence',
    facultyLabel: 'Review Curriculum Coherence',
    category: 'Teaching & Curriculum',
    description:
      'Find prerequisite gaps, duplication, sequencing and assessment problems.',
    Icon: Network,
    tone:
      'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
    iconTone:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
  },
] as const;

const PRIMARY_KEY = 'aih-primary-academic-experience';

function derivedSpecName(agentId: string) {
  return `${PREFIX}${agentId}`;
}

function selectModelSpec(specName: string) {
  window.dispatchEvent(
    new CustomEvent('aih:select-model-spec', {
      detail: { specName },
    }),
  );
}

function isSpecializedSpec(specName?: string | null) {
  return typeof specName === 'string' && specName.startsWith(PREFIX);
}

function isFacultyExperience(specName?: string | null) {
  const value = String(specName ?? '').toLowerCase();

  return (
    value.includes('instructor') ||
    value.includes('faculty') ||
    value.includes('school teaching') ||
    value.includes('teaching assistant')
  );
}

const AcademicToolsDropdown = ({
  disabled = false,
  specName,
}: AcademicToolsDropdownProps) => {
  const [open, setOpen] = useState(false);
  const { data: startupConfig } = useGetStartupConfig();

  const availableNames = useMemo(
    () =>
      new Set(
        (startupConfig?.modelSpecs?.list ?? [])
          .map((spec) => spec?.name)
          .filter((name): name is string => typeof name === 'string'),
      ),
    [startupConfig?.modelSpecs?.list],
  );

  const availableAgents = useMemo(
    () =>
      AGENTS.filter((agent) =>
        availableNames.has(derivedSpecName(agent.id)),
      ),
    [availableNames],
  );

  const activeAgent = useMemo(
    () =>
      AGENTS.find(
        (agent) => derivedSpecName(agent.id) === specName,
      ),
    [specName],
  );

  const storedPrimary =
    typeof window !== 'undefined'
      ? localStorage.getItem(PRIMARY_KEY)
      : null;

  const effectivePrimary =
    !isSpecializedSpec(specName)
      ? specName
      : storedPrimary;

  const facultyMode = isFacultyExperience(effectivePrimary);

  if (availableAgents.length === 0) {
    return null;
  }

  const chooseAgent = (agentId: string) => {
    if (!isSpecializedSpec(specName) && specName) {
      localStorage.setItem(PRIMARY_KEY, specName);
    }

    selectModelSpec(derivedSpecName(agentId));
    setOpen(false);
  };

  const restorePrimary = () => {
    const primary = localStorage.getItem(PRIMARY_KEY);

    if (primary) {
      selectModelSpec(primary);
    }

    setOpen(false);
  };

  const triggerLabel = activeAgent
    ? facultyMode
      ? activeAgent.facultyLabel
      : activeAgent.learnerLabel
    : 'Academic Tools';

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Academic Tools"
        title="Academic Tools"
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
        <GraduationCap
          className="size-4 transition-transform group-hover:scale-105"
          aria-hidden="true"
        />
        <span className="hidden max-w-[11rem] truncate whitespace-nowrap @sm:inline">
          {triggerLabel}
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
              aria-label="Academic Tools"
              className={[
                'flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl',
                'border border-slate-200 bg-white',
                'shadow-[0_24px_80px_rgba(15,23,42,0.22)]',
                'dark:border-border-light dark:bg-surface-dialog',
              ].join(' ')}
            >
              <header className="border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-sky-50 px-5 py-4 dark:border-border-light dark:from-violet-950/20 dark:via-surface-dialog dark:to-sky-950/20">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                        <GraduationCap className="size-5" />
                      </span>
                      <div>
                        <h2 className="text-base font-semibold text-text-primary">
                          Academic Tools
                        </h2>
                        <p className="mt-0.5 text-xs text-text-secondary">
                          Apply a specialized academic workflow to this conversation.
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close Academic Tools"
                    className="rounded-full p-2 text-text-secondary transition-colors hover:bg-slate-100 hover:text-text-primary dark:hover:bg-surface-tertiary"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 sm:p-4">
                {activeAgent && storedPrimary && (
                  <button
                    type="button"
                    onClick={restorePrimary}
                    className="mb-2 flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-medium text-text-primary transition-colors hover:bg-slate-100 dark:border-border-light dark:bg-surface-secondary dark:hover:bg-surface-tertiary"
                  >
                    <ArrowLeft className="size-4" />
                    Return to primary experience
                  </button>
                )}

                {availableAgents.map((agent) => {
                  const active =
                    specName === derivedSpecName(agent.id);
                  const label = facultyMode
                    ? agent.facultyLabel
                    : agent.learnerLabel;
                  const Icon = agent.Icon;

                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => chooseAgent(agent.id)}
                      className={[
                        'flex w-full items-start gap-2.5 rounded-2xl border p-3 text-left sm:gap-3 sm:p-3.5',
                        'transition-all duration-200',
                        active
                          ? `${agent.tone} shadow-sm ring-1 ring-current/10`
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm dark:border-border-light dark:bg-surface-dialog dark:hover:bg-surface-secondary',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl',
                          agent.iconTone,
                        ].join(' ')}
                      >
                        <Icon className="size-5" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 break-words font-semibold leading-5 text-text-primary">
                            {label}
                          </span>
                          {active && (
                            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:bg-black/15">
                              Active
                            </span>
                          )}
                        </span>

                        <span className="mt-0.5 block text-xs font-medium text-text-secondary">
                          {agent.category}
                        </span>

                        <span className="mt-1 block text-sm leading-5 text-text-secondary">
                          {agent.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <footer className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] leading-4 text-text-secondary sm:px-5 sm:py-3 sm:text-xs dark:border-border-light dark:bg-surface-secondary">
                Your role, permissions and institutional knowledge boundaries remain in effect.
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
};

export default React.memo(AcademicToolsDropdown);
