import { isPrivilegedAdmin, isPlatformAdmin } from '~/utils/rbac';
import { SystemRoles } from 'librechat-data-provider';
import AutoSendPrompt from '../buttons/AutoSendPrompt';
import { AdminSettings } from '~/components/Prompts';
import PromptSidePanel from './GroupSidePanel';
import { PanelFooter } from '~/components/ui';
import FilterPrompts from './FilterPrompts';
import { useAuthContext } from '~/hooks';

export default function PromptsAccordion() {
  const { user } = useAuthContext();
  return (
    <PromptSidePanel
      className="space-y-2 pt-2"
      footer={
        isPrivilegedAdmin(user) ? (
          <PanelFooter>
            <AdminSettings />
          </PanelFooter>
        ) : null
      }
    >
      <FilterPrompts />
      <AutoSendPrompt />
    </PromptSidePanel>
  );
}
