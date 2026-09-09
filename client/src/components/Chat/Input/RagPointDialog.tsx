import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';
import type { TRagPoint, TRagSelection } from 'librechat-data-provider';
import { useGetRagPointsQuery } from '~/data-provider';
import { readRagSelection, writeRagSelection } from '~/utils/ragSelection';
import { useAuthContext } from '~/hooks';

interface RagPointDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RagPointDialog({ isOpen, onOpenChange }: RagPointDialogProps) {
  const { user } = useAuthContext();
  const userId = user?.id;
  const { data, isLoading, isError } = useGetRagPointsQuery({ enabled: isOpen });
  const [selection, setSelection] = useState<TRagSelection>(() => readRagSelection(userId));

  const points = useMemo(() => data?.points ?? [], [data?.points]);

  useEffect(() => {
    if (!isOpen || !data) {
      return;
    }
    setSelection((current) => {
      const permissible = new Set(data.points.map((point) => point.key));
      const selectedPointKeys = current.selectedPointKeys.filter((key) => permissible.has(key));
      const next = {
        enabled: current.enabled,
        selectedPointKeys:
          selectedPointKeys.length > 0
            ? selectedPointKeys
            : data.selectedPointKeysDefault.filter((key) => permissible.has(key)),
      };
      writeRagSelection(next, userId);
      return next;
    });
  }, [data, isOpen, userId]);

  const togglePoint = (point: TRagPoint) => {
    setSelection((current) => {
      const selected = new Set(current.selectedPointKeys);
      selected.has(point.key) ? selected.delete(point.key) : selected.add(point.key);
      const next = { ...current, selectedPointKeys: [...selected] };
      writeRagSelection(next, userId);
      return next;
    });
  };

  return (
    <OGDialog open={isOpen} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        className="sm:max-w-lg"
        title="Document knowledge (RAG)"
        main={
          <div className="space-y-4 px-6 pb-3">
            <p className="text-sm text-text-secondary">
              Choose which authorized knowledge sources may be searched. Access is checked again
              by the server whenever you send a message.
            </p>
            {isLoading && (
              <div className="flex items-center gap-2 py-3 text-sm text-text-secondary">
                <Spinner className="size-4" /> Loading available RAG Points…
              </div>
            )}
            {isError && (
              <p className="text-sm text-text-destructive">
                Available RAG Points could not be loaded. Try opening this dialog again.
              </p>
            )}
            {!isLoading && !isError && points.length === 0 && (
              <p className="text-sm text-text-secondary">No RAG Points are available.</p>
            )}
            <fieldset className="space-y-2" disabled={isLoading || isError}>
              <legend className="sr-only">Available RAG Points</legend>
              {points.map((point) => (
                <label
                  key={point.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-light px-3 py-3 hover:bg-surface-hover"
                >
                  <Checkbox
                    checked={selection.selectedPointKeys.includes(point.key)}
                    onCheckedChange={() => togglePoint(point)}
                    aria-label={point.label}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text-primary">{point.label}</span>
                    <span className="block text-xs capitalize text-text-secondary">
                      {point.type.toLowerCase()} knowledge
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        }
        selection={{
          selectHandler: () => onOpenChange(false),
          selectText: 'Done',
        }}
        showCancelButton={false}
        footerClassName="flex justify-end px-6 pb-6 pt-2"
      />
    </OGDialog>
  );
}
