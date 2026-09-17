import React, { useMemo } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { GraduationCap, Sparkles, ChevronDown } from 'lucide-react';
import { getConfigDefaults } from 'librechat-data-provider';
import type { ModelSelectorProps } from '~/common';
import { renderModelSpecs } from './components';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import { ModelSelectorChatProvider } from './ModelSelectorChatContext';
import { CustomMenu as Menu } from './CustomMenu';
import DialogManager from './DialogManager';

const defaultInterface = getConfigDefaults().interface;

type AIHModelSpec = {
  academicAgentType?: string;
};

function getAcademicAgentType(spec: AIHModelSpec) {
  return String(spec.academicAgentType || '').trim().toUpperCase();
}

function isAcademicAgentSpec(spec: AIHModelSpec) {
  return getAcademicAgentType(spec) === 'AGENT';
}

function isPrimaryExperienceSpec(spec: AIHModelSpec) {
  return getAcademicAgentType(spec) === 'MODE';
}

function ModelSelectorContent() {
  const {
    modelSpecs,
    endpointsConfig,
    searchValue,
    selectedValues,
    setSearchValue,
    setSelectedValues,
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();

  const primaryExperiences = useMemo(
    () => modelSpecs.filter((spec) => isPrimaryExperienceSpec(spec)),
    [modelSpecs],
  );


  const selectedSpec = useMemo(
    () => modelSpecs.find((spec) => spec.name === selectedValues.modelSpec),
    [modelSpecs, selectedValues.modelSpec],
  );

  const selectedIsAgent = selectedSpec ? isAcademicAgentSpec(selectedSpec) : false;

  const experienceLabel =
    selectedSpec && !selectedIsAgent
      ? selectedSpec.label || selectedSpec.name
      : 'Experience';

  const agentLabel =
    selectedSpec && selectedIsAgent
      ? selectedSpec.label || 'Academic Agent'
      : 'Agents';

  const normalizedSearch = searchValue.trim().toLowerCase();

  const filterSpecs = <T extends { name?: string; label?: string; description?: string }>(
    specs: T[],
  ) => {
    if (!normalizedSearch) {
      return specs;
    }

    return specs.filter((spec) =>
      [spec.label, spec.name, spec.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
    );
  };

  const applyValues = (values: Record<string, any>) => {
    setSelectedValues({
      endpoint: values.endpoint || '',
      model: values.model || '',
      modelSpec: values.modelSpec || '',
    });
  };

  const experienceTrigger = (
    <TooltipAnchor
      aria-label="Choose Primary Experience"
      description="Choose how AI Scholar Hub works with you"
      render={
        <button
          type="button"
          data-testid="aih-experience-selector"
          className={[
            'group my-1 flex h-10 max-w-[48vw] items-center gap-2 rounded-full',
            'border border-border-light bg-presentation px-3.5 text-sm',
            'text-text-primary shadow-sm transition-all duration-200',
            'hover:bg-surface-active-alt hover:shadow-md',
            !selectedIsAgent && selectedSpec ? 'ring-1 ring-border-light' : '',
          ].join(' ')}
        >
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-secondary">
            <GraduationCap className="h-4 w-4" aria-hidden="true" />
          </span>

          <span className="hidden text-[11px] font-medium uppercase tracking-wide text-text-secondary xl:inline">
            Experience
          </span>

          <span className="truncate font-medium">{experienceLabel}</span>

          <ChevronDown
            className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      }
    />
  );

  return (
    <div className="relative flex min-w-0 max-w-full items-center gap-1.5 sm:gap-2">
      {primaryExperiences.length > 0 && (
        <Menu
          values={selectedValues}
          onValuesChange={applyValues}
          onSearch={(value) => setSearchValue(value)}
          combobox={<input id="experience-search" placeholder=" " />}
          comboboxLabel="Search Primary Experiences"
          trigger={experienceTrigger}
        >
          {renderModelSpecs(
            filterSpecs(primaryExperiences),
            selectedValues.modelSpec || '',
          )}
        </Menu>
      )}

      <DialogManager
        keyDialogOpen={keyDialogOpen}
        onOpenChange={onOpenChange}
        endpointsConfig={endpointsConfig || {}}
        keyDialogEndpoint={keyDialogEndpoint || undefined}
      />
    </div>
  );
}

export default function ModelSelector({ startupConfig }: ModelSelectorProps) {
  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  if (interfaceConfig.modelSelect === false && modelSpecs.length === 0) {
    return null;
  }

  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ModelSelectorContent />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
