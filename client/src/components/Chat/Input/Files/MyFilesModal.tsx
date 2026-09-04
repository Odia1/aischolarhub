import { useMemo, useRef, useState } from 'react';
import {
  FileSources,
  FileContext,
  EToolResources,
} from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useGetFiles } from '~/data-provider';
import { useFileHandlingNoChatContext } from '~/hooks/Files/useFileHandling';
import { DataTable, columns } from './Table';
import { useLocalize } from '~/hooks';

export function MyFilesModal({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | HTMLDivElement | null>;
}) {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
   * Upload state is intentionally local to Manage Files.
   *
   * Files uploaded here are persisted as the user's personal
   * RAG / File Search documents. They are not attached to a
   * conversation and are not assigned to institution/group RAG.
   */
  const [uploadFiles, setUploadFiles] = useState<Map<string, ExtendedFile>>(new Map());
  const [filesLoading, setFilesLoading] = useState(false);

  const fileHandlingState = useMemo(
    () => ({
      files: uploadFiles,
      setFiles: setUploadFiles,
      setFilesLoading,
      conversation: null,
    }),
    [uploadFiles],
  );

  const { handleFiles } = useFileHandlingNoChatContext(undefined, fileHandlingState);

  const {
    data: files = [],
    refetch,
  } = useGetFiles<TFile[]>({
    select: (files) =>
      files.map((file) => {
        file.context = file.context ?? FileContext.unknown;
        file.filterSource =
          file.source === FileSources.firebase ? FileSources.local : file.source;
        return file;
      }),
  });

  const openFilePicker = () => {
    if (!fileInputRef.current) {
      return;
    }

    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handlePersonalRagUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFiles = event.target.files;

    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }

    try {
      const accepted = await handleFiles(
        selectedFiles,
        EToolResources.file_search,
      );

      if (accepted) {
        await refetch();
      }
    } finally {
      event.target.value = '';
    }
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent
        title={localize('com_nav_my_files')}
        className="w-11/12 bg-surface-dialog text-text-primary shadow-2xl"
      >
        <OGDialogHeader>
          <div className="flex w-full items-center justify-between gap-3">
            <OGDialogTitle>{localize('com_nav_my_files')}</OGDialogTitle>

            <Button
              type="button"
              variant="outline"
              disabled={filesLoading}
              onClick={openFilePicker}
            >
              {localize('com_ui_upload_file_search')}
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              multiple={true}
              tabIndex={-1}
              style={{ display: 'none' }}
              onChange={handlePersonalRagUpload}
            />
          </div>
        </OGDialogHeader>

        <DataTable columns={columns} data={files} />
      </OGDialogContent>
    </OGDialog>
  );
}
