import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AiModelsSettings } from './AiModelsSettings';
import { AiRuntimeSettings } from './AiRuntimeSettings';
import { AuxiliaryInstructionProfilesSettings } from './AuxiliaryInstructionProfilesSettings';
import { DefaultModelSettings } from './DefaultModelSettings';
import { CreativeRuntimeModelSettings } from './CreativeRuntimeModelSettings';
import { InstructionProfileSettings } from './InstructionProfileSettings';
import { LocalModelsSettings } from './LocalModelsSettings';
import { PrimaryPromptProfilesSettings } from './PrimaryPromptProfilesSettings';
import { ProvidersSettings } from './ProvidersSettings';
import { VisionSettings } from './VisionSettings';

const COMMON_AI_SETTINGS_SECTIONS = [
  { value: 'general', label: 'General' },
] as const;

const ADVANCED_AI_SETTINGS_SECTIONS = [
  { value: 'model-catalog', label: 'Model catalog' },
  { value: 'creative-models', label: 'Creative models' },
  { value: 'local-models', label: 'Local Models' },
  { value: 'prompts', label: 'Prompts' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'providers', label: 'Providers' },
  { value: 'vision', label: 'Vision' },
] as const;

type AiSettingsTab =
  | (typeof COMMON_AI_SETTINGS_SECTIONS)[number]['value']
  | (typeof ADVANCED_AI_SETTINGS_SECTIONS)[number]['value'];

export function AiSettingsSection() {
  const [activeSection, setActiveSection] = useState<AiSettingsTab>('general');

  return (
    <section className="min-w-0 rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 text-adam-neutral-100 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-adam-neutral-50">
          AI Settings
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-300">
          Start with your default models and AI profile. Advanced sections
          control model visibility, Creative runtimes, providers, prompts and
          vision.
        </p>
      </div>

      <Tabs
        value={activeSection}
        onValueChange={(value) => setActiveSection(value as AiSettingsTab)}
        orientation="vertical"
        className="min-w-0"
      >
        <div className="mb-4 md:hidden">
          <label
            htmlFor="ai-settings-section"
            className="text-xs font-medium text-adam-neutral-200"
          >
            Section
          </label>
          <Select
            value={activeSection}
            onValueChange={(value) => setActiveSection(value as AiSettingsTab)}
          >
            <SelectTrigger
              id="ai-settings-section"
              aria-label="AI settings section"
              className="mt-2 h-11 w-full border-adam-neutral-700 bg-adam-background-1 text-adam-neutral-50"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Common</SelectLabel>
                {COMMON_AI_SETTINGS_SECTIONS.map((section) => (
                  <SelectItem key={section.value} value={section.value}>
                    {section.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Advanced</SelectLabel>
                {ADVANCED_AI_SETTINGS_SECTIONS.map((section) => (
                  <SelectItem key={section.value} value={section.value}>
                    {section.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="grid min-w-0 gap-5 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6">
          <TabsList
            aria-label="AI settings sections"
            className="hidden h-auto w-full flex-col items-stretch justify-start gap-1 rounded-xl bg-adam-neutral-800 p-1 md:flex"
          >
            <div
              role="presentation"
              aria-hidden="true"
              className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-adam-neutral-300"
            >
              Common
            </div>
            {COMMON_AI_SETTINGS_SECTIONS.map((section) => (
              <TabsTrigger
                key={section.value}
                value={section.value}
                className="min-h-10 w-full justify-start px-3 py-2 text-left motion-reduce:transition-none"
              >
                {section.label}
              </TabsTrigger>
            ))}

            <div
              role="presentation"
              aria-hidden="true"
              className="mt-2 border-t border-adam-neutral-700 px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-adam-neutral-300"
            >
              Advanced
            </div>
            {ADVANCED_AI_SETTINGS_SECTIONS.map((section) => (
              <TabsTrigger
                key={section.value}
                value={section.value}
                className="min-h-10 w-full justify-start px-3 py-2 text-left motion-reduce:transition-none"
              >
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="min-w-0">
            <TabsContent
              value="general"
              className="mt-0 flex min-w-0 flex-col gap-4"
            >
              <DefaultModelSettings />
              <InstructionProfileSettings />
            </TabsContent>
            <TabsContent value="model-catalog" className="mt-0 min-w-0">
              <AiModelsSettings />
            </TabsContent>
            <TabsContent value="creative-models" className="mt-0 min-w-0">
              <CreativeRuntimeModelSettings />
            </TabsContent>
            <TabsContent value="local-models" className="mt-0 min-w-0">
              <LocalModelsSettings />
            </TabsContent>
            <TabsContent value="prompts" className="mt-0 min-w-0">
              <Tabs defaultValue="generative" className="min-w-0">
                <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1 sm:w-max">
                  <TabsTrigger
                    value="generative"
                    className="min-h-10 motion-reduce:transition-none"
                  >
                    Generative
                  </TabsTrigger>
                  <TabsTrigger
                    value="creative"
                    className="min-h-10 motion-reduce:transition-none"
                  >
                    Creative
                  </TabsTrigger>
                  <TabsTrigger
                    value="instructions"
                    className="min-h-10 motion-reduce:transition-none"
                  >
                    Instructions
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="generative" className="min-w-0">
                  <PrimaryPromptProfilesSettings scope="parametric" />
                </TabsContent>
                <TabsContent value="creative" className="min-w-0">
                  <PrimaryPromptProfilesSettings scope="creative" />
                </TabsContent>
                <TabsContent value="instructions" className="min-w-0">
                  <AuxiliaryInstructionProfilesSettings />
                </TabsContent>
              </Tabs>
            </TabsContent>
            <TabsContent value="runtime" className="mt-0 min-w-0">
              <AiRuntimeSettings />
            </TabsContent>
            <TabsContent value="providers" className="mt-0 min-w-0">
              <ProvidersSettings />
            </TabsContent>
            <TabsContent value="vision" className="mt-0 min-w-0">
              <VisionSettings />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </section>
  );
}
