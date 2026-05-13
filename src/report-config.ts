import fs from 'fs';
import path from 'path';

export interface BlueAwardReportConfig {
  lookerStudioSubmissionUrlParamKey: string;
  defaultBlueAwardPageUrls: string[];
  lookerCaptureReadyTimeoutMs: number;
  lookerPostLoadDelayMs: number;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  trims: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  pdfLimits: {
    maxWidth: number;
    maxHeight: number;
  };
  urlParams: {
    submissionAliasKey: string;
    dashboardFilterKey: string;
    dashboardFilterTemplate: string;
    renderModeKey: string;
    renderModeValue: string;
  };
  render: {
    gotoWaitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    emulateMediaType: 'screen' | 'print';
  };
  behavior: {
    lookerAllowedHosts: string[];
    minVisualCount: number;
    minRichTextLength: number;
    minIframeWidth: number;
    minIframeHeight: number;
    navigationTimeoutMs: number;
    maxAttempts: number;
    retryDelayMs: number;
    horizontalPadding: number;
    verticalPadding: number;
    browserHeadless: boolean;
    browserArgs: string[];
  };
}

const requiredPaths = [
  'lookerStudioSubmissionUrlParamKey',
  'defaultBlueAwardPageUrls',
  'lookerCaptureReadyTimeoutMs',
  'lookerPostLoadDelayMs',
  'viewport.width',
  'viewport.height',
  'viewport.deviceScaleFactor',
  'trims.left',
  'trims.top',
  'trims.right',
  'trims.bottom',
  'pdfLimits.maxWidth',
  'pdfLimits.maxHeight',
  'urlParams.submissionAliasKey',
  'urlParams.dashboardFilterKey',
  'urlParams.dashboardFilterTemplate',
  'urlParams.renderModeKey',
  'urlParams.renderModeValue',
  'render.gotoWaitUntil',
  'render.emulateMediaType',
  'behavior.lookerAllowedHosts',
  'behavior.minVisualCount',
  'behavior.minRichTextLength',
  'behavior.minIframeWidth',
  'behavior.minIframeHeight',
  'behavior.navigationTimeoutMs',
  'behavior.maxAttempts',
  'behavior.retryDelayMs',
  'behavior.horizontalPadding',
  'behavior.verticalPadding',
  'behavior.browserHeadless',
  'behavior.browserArgs',
];

function getPathValue(source: Record<string, unknown>, pathKey: string): unknown {
  return pathKey.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function loadBlueAwardReportConfig(): BlueAwardReportConfig {
  const configPath = process.env.BLUE_AWARD_REPORT_CONFIG_PATH
    ? path.resolve(process.env.BLUE_AWARD_REPORT_CONFIG_PATH)
    : path.resolve(process.cwd(), 'config', 'blue-award-report.json');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as BlueAwardReportConfig;

  for (const pathKey of requiredPaths) {
    const value = getPathValue(parsed as unknown as Record<string, unknown>, pathKey);
    if (value === undefined || value === null) {
      throw new Error(`Missing required blue-award-report config: ${pathKey}`);
    }
  }

  const envHeadless = parseBoolean(process.env.LOOKER_PUPPETEER_HEADLESS);
  if (envHeadless !== undefined) {
    parsed.behavior.browserHeadless = envHeadless;
  }

  const envPostLoadDelayMs = parseInteger(process.env.LOOKER_POST_LOAD_DELAY_MS);
  if (envPostLoadDelayMs !== undefined) {
    parsed.lookerPostLoadDelayMs = envPostLoadDelayMs;
  }

  const envCaptureReadyTimeoutMs = parseInteger(process.env.LOOKER_CAPTURE_READY_TIMEOUT_MS);
  if (envCaptureReadyTimeoutMs !== undefined) {
    parsed.lookerCaptureReadyTimeoutMs = envCaptureReadyTimeoutMs;
  }

  return parsed;
}
