import React, { useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
import RagPointDialog from './RagPointDialog';

interface KnowledgeSourcesButtonProps {
  disabled?: boolean;
}

/**
 * User-facing institutional knowledge selector.
 *
 * "RAG Point" remains the administrative/architectural term.
 * End users choose "Knowledge Sources".
 *
 * Authorization remains server-side; RagPointDialog only exposes
 * the already-authorized source set returned by the backend.
 */
const KnowledgeSourcesButton = ({
  disabled = false,
}: KnowledgeSourcesButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        aria-label="Choose Knowledge Sources"
        title="Choose Knowledge Sources"
        className={[
          'group inline-flex h-8 shrink-0 items-center gap-1.5',
          'rounded-full border border-sky-200',
          'bg-sky-50 px-2 @sm:px-2.5',
          'text-xs font-medium text-sky-800',
          'shadow-sm transition-all duration-200',
          'hover:border-sky-300 hover:bg-sky-100 hover:shadow',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-sky-300',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'dark:border-sky-800 dark:bg-sky-950/30',
          'dark:text-sky-200 dark:hover:bg-sky-950/50',
        ].join(' ')}
      >
        <BookOpenCheck
          className="size-4 transition-transform group-hover:scale-105"
          aria-hidden="true"
        />
        <span className="hidden whitespace-nowrap @sm:inline">
          Knowledge Sources
        </span>
      </button>

      <RagPointDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
};

export default React.memo(KnowledgeSourcesButton);
