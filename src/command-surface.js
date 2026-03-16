import { createOnboardingFlow } from './onboarding-flow.js';
import { createReportFormatters } from './report-formatters.js';
import {
  buildSlashCommands,
  normalizeSlashCommandName as normalizeSlashCommandNameBase,
  slashRef as slashRefBase,
} from './slash-command-surface.js';
import { createSlashCommandRouter } from './slash-command-router.js';
import { createTextCommandHandler } from './text-command-handler.js';
import { createWorkspaceBrowser } from './workspace-browser.js';

export function createCommandSurface({
  slashPrefix = '',
  botProvider = null,
  defaultUiLanguage = 'en',
  enableConfigCmd = false,
  SlashCommandBuilder,
  onboardingOptions = {},
  reportOptions = {},
  workspaceBrowserOptions = {},
  slashRouterOptions = {},
  textCommandOptions = {},
} = {}) {
  const slashCommands = buildSlashCommands({
    SlashCommandBuilder,
    slashPrefix,
    botProvider,
  });
  const normalizeSlashCommandName = (name) => normalizeSlashCommandNameBase(name, slashPrefix);
  const slashRef = (base) => slashRefBase(base, slashPrefix);

  const reports = createReportFormatters({
    ...reportOptions,
    slashRef,
  });

  const workspaceBrowser = createWorkspaceBrowser({
    ...workspaceBrowserOptions,
    formatWorkspaceUpdateReport: reports.formatWorkspaceUpdateReport,
    formatDefaultWorkspaceUpdateReport: reports.formatDefaultWorkspaceUpdateReport,
  });

  const onboarding = createOnboardingFlow({
    ...onboardingOptions,
    botProvider,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
    slashRef,
  });

  const routeSlashCommand = createSlashCommandRouter({
    botProvider,
    defaultUiLanguage,
    slashRef,
    ...slashRouterOptions,
    isOnboardingEnabled: onboarding.isOnboardingEnabled,
    buildOnboardingActionRows: onboarding.buildOnboardingActionRows,
    formatOnboardingStepReport: onboarding.formatOnboardingStepReport,
    formatOnboardingDisabledMessage: onboarding.formatOnboardingDisabledMessage,
    formatOnboardingConfigReport: onboarding.formatOnboardingConfigReport,
    formatStatusReport: reports.formatStatusReport,
    formatQueueReport: reports.formatQueueReport,
    formatDoctorReport: reports.formatDoctorReport,
    formatWorkspaceReport: reports.formatWorkspaceReport,
    formatWorkspaceSetHelp: reports.formatWorkspaceSetHelp,
    formatWorkspaceUpdateReport: reports.formatWorkspaceUpdateReport,
    formatDefaultWorkspaceSetHelp: reports.formatDefaultWorkspaceSetHelp,
    formatDefaultWorkspaceUpdateReport: reports.formatDefaultWorkspaceUpdateReport,
    formatLanguageConfigReport: reports.formatLanguageConfigReport,
    formatProfileConfigHelp: reports.formatProfileConfigHelp,
    formatProfileConfigReport: reports.formatProfileConfigReport,
    formatTimeoutConfigHelp: reports.formatTimeoutConfigHelp,
    formatTimeoutConfigReport: reports.formatTimeoutConfigReport,
    formatProgressReport: reports.formatProgressReport,
    formatCancelReport: reports.formatCancelReport,
    formatCompactStrategyConfigHelp: reports.formatCompactStrategyConfigHelp,
    formatCompactConfigReport: reports.formatCompactConfigReport,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
  });

  const handleCommand = createTextCommandHandler({
    botProvider,
    enableConfigCmd,
    ...textCommandOptions,
    isOnboardingEnabled: onboarding.isOnboardingEnabled,
    formatHelpReport: reports.formatHelpReport,
    formatStatusReport: reports.formatStatusReport,
    formatQueueReport: reports.formatQueueReport,
    formatDoctorReport: reports.formatDoctorReport,
    formatWorkspaceReport: reports.formatWorkspaceReport,
    formatWorkspaceSetHelp: reports.formatWorkspaceSetHelp,
    formatWorkspaceUpdateReport: reports.formatWorkspaceUpdateReport,
    formatDefaultWorkspaceSetHelp: reports.formatDefaultWorkspaceSetHelp,
    formatDefaultWorkspaceUpdateReport: reports.formatDefaultWorkspaceUpdateReport,
    formatOnboardingConfigHelp: onboarding.formatOnboardingConfigHelp,
    formatOnboardingConfigReport: onboarding.formatOnboardingConfigReport,
    formatOnboardingDisabledMessage: onboarding.formatOnboardingDisabledMessage,
    formatOnboardingReport: onboarding.formatOnboardingReport,
    formatLanguageConfigHelp: reports.formatLanguageConfigHelp,
    formatLanguageConfigReport: reports.formatLanguageConfigReport,
    formatProfileConfigHelp: reports.formatProfileConfigHelp,
    formatProfileConfigReport: reports.formatProfileConfigReport,
    formatTimeoutConfigHelp: reports.formatTimeoutConfigHelp,
    formatTimeoutConfigReport: reports.formatTimeoutConfigReport,
    formatProgressReport: reports.formatProgressReport,
    formatCancelReport: reports.formatCancelReport,
    formatCompactStrategyConfigHelp: reports.formatCompactStrategyConfigHelp,
    formatCompactConfigReport: reports.formatCompactConfigReport,
    formatReasoningEffortHelp: reports.formatReasoningEffortHelp,
    parseOnboardingConfigAction: onboarding.parseOnboardingConfigAction,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
  });

  return {
    formatWorkspaceBusyReport: reports.formatWorkspaceBusyReport,
    handleCommand,
    handleOnboardingButtonInteraction: onboarding.handleOnboardingButtonInteraction,
    handleWorkspaceBrowserInteraction: workspaceBrowser.handleWorkspaceBrowserInteraction,
    isOnboardingButtonId: onboarding.isOnboardingButtonId,
    isWorkspaceBrowserComponentId: workspaceBrowser.isWorkspaceBrowserComponentId,
    normalizeSlashCommandName,
    routeSlashCommand,
    slashCommands,
    slashRef,
  };
}
