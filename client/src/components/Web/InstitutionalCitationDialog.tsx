import { FileText } from 'lucide-react';
import { OGDialog, OGDialogTemplate } from '@librechat/client';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  snippet?: string;
  pages?: number[];
  relevance?: number;
}

export default function InstitutionalCitationDialog({ open, onOpenChange, title, snippet, pages, relevance }: Props) {
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        className="sm:max-w-2xl"
        title="Institutional knowledge excerpt"
        main={
          <div className="space-y-4 px-6 pb-4">
            <div className="flex items-start gap-3 rounded-lg border border-border-light bg-surface-secondary p-4">
              <FileText className="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-text-primary">{title}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-text-secondary">
                  {relevance != null && relevance > 0 && <span>Relevance: {Math.round(relevance * 100)}%</span>}
                  {pages && pages.length > 0 && <span>Pages: {pages.join(', ')}</span>}
                </div>
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-primary">Retrieved excerpt</h3>
              <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border-light bg-surface-primary p-4 text-sm leading-relaxed text-text-secondary">
                {snippet || 'No excerpt was retained for this citation.'}
              </p>
            </div>
            <p className="text-xs text-text-secondary">
              This excerpt was retrieved for the current answer. The institution-managed original is not available for preview or download.
            </p>
          </div>
        }
        selection={{ selectHandler: () => onOpenChange(false), selectText: 'Close' }}
        showCancelButton={false}
        footerClassName="flex justify-end px-6 pb-6 pt-2"
      />
    </OGDialog>
  );
}
