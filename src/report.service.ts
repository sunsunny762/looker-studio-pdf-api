import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import puppeteer, { Browser, Page } from 'puppeteer';
import { HttpError } from './http-error';
import { BlueAwardReportConfig, loadBlueAwardReportConfig } from './report-config';

interface RenderSummary {
  title: string;
  bodyTextLength: number;
  canvasCount: number;
  svgCount: number;
  imgCount: number;
  iframeCount: number;
  largeVisualCount: number;
  largeIframeCount: number;
  scrollWidth: number;
  scrollHeight: number;
  hasBlueAwardText: boolean;
  hasNoDataReportText: boolean;
}

interface PageDimensions {
  docWidth: number;
  docHeight: number;
  visualMinLeft: number;
  visualMaxRight: number;
  visualMaxBottom: number;
}

export class ReportService {
  private readonly blueAwardReportConfig: BlueAwardReportConfig = loadBlueAwardReportConfig();
  private readonly lookerStudioSubmissionUrlParamKey = this.blueAwardReportConfig.lookerStudioSubmissionUrlParamKey;
  private readonly defaultBlueAwardPageUrls = this.blueAwardReportConfig.defaultBlueAwardPageUrls;

  public buildLookerStudioPageUrlWithSubmissionId(pageUrl: string, submissionId: number, companyName?: string): string {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(pageUrl);
    } catch {
      throw new HttpError(400, 'Invalid page URL');
    }

    const allowedHosts = new Set(this.blueAwardReportConfig.behavior.lookerAllowedHosts);
    if (parsedUrl.protocol !== 'https:' || !allowedHosts.has(parsedUrl.hostname)) {
      throw new HttpError(400, 'Page URL must be a valid https Looker Studio URL');
    }

    const rawParams = parsedUrl.searchParams.get('params');
    let paramsObj: Record<string, unknown> = {};
    if (rawParams) {
      try {
        paramsObj = JSON.parse(rawParams) as Record<string, unknown>;
      } catch {
        paramsObj = {};
      }
    }

    paramsObj[this.lookerStudioSubmissionUrlParamKey] = submissionId;
    paramsObj.p_submission_id = submissionId;
    paramsObj[this.blueAwardReportConfig.urlParams.submissionAliasKey] = submissionId;

    if (companyName?.trim()) {
      paramsObj.df8 = `include%EE%80%800%EE%80%80IN%EE%80%80${encodeURIComponent(companyName.trim())}`;
    } else {
      paramsObj[this.blueAwardReportConfig.urlParams.dashboardFilterKey] =
        this.blueAwardReportConfig.urlParams.dashboardFilterTemplate.replace('{{submissionId}}', String(submissionId));
    }

    parsedUrl.searchParams.set('params', JSON.stringify(paramsObj));
    parsedUrl.searchParams.set(
      this.blueAwardReportConfig.urlParams.renderModeKey,
      this.blueAwardReportConfig.urlParams.renderModeValue,
    );

    return parsedUrl.toString();
  }

  public async downloadMergedBlueAwardLookerStudioPdf(
    submissionId: number,
    pageUrls?: string[],
    companyName?: string,
  ): Promise<Buffer> {
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      throw new HttpError(400, 'submissionId must be a positive integer');
    }

    const pages = pageUrls && pageUrls.length > 0 ? pageUrls : this.defaultBlueAwardPageUrls;
    let browser: Browser | undefined;

    try {
      browser = await puppeteer.launch({
        headless: this.blueAwardReportConfig.behavior.browserHeadless,
        executablePath: process.env.LOOKER_PUPPETEER_EXECUTABLE_PATH || undefined,
        timeout: 60000,
        protocolTimeout: 60000,
        args: this.blueAwardReportConfig.behavior.browserArgs,
      });
    } catch (error) {
      throw new HttpError(
        502,
        `Puppeteer browser is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    try {
      const pagePdfBuffers: Buffer[] = [];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const urlWithParams = this.buildLookerStudioPageUrlWithSubmissionId(pages[pageIndex], submissionId, companyName);
        const pagePdfBuffer = await this.capturePagePdf(browser, urlWithParams, submissionId, pageIndex);
        pagePdfBuffers.push(pagePdfBuffer);
      }

      const mergedPdf = await PDFDocument.create();
      for (const pagePdfBuffer of pagePdfBuffers) {
        const srcPdf = await PDFDocument.load(pagePdfBuffer);
        const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
        for (const copiedPage of copiedPages) {
          mergedPdf.addPage(copiedPage);
        }
      }

      return Buffer.from(await mergedPdf.save());
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        502,
        `Failed to generate merged Looker Studio PDF: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      await browser.close();
    }
  }

  private async capturePagePdf(browser: Browser, urlWithParams: string, submissionId: number, pageIndex: number): Promise<Buffer> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.blueAwardReportConfig.behavior.maxAttempts; attempt++) {
      let page: Page | undefined;
      try {
        page = await this.createConfiguredPage(browser);
        await page.goto(urlWithParams, {
          waitUntil: this.blueAwardReportConfig.render.gotoWaitUntil,
          timeout: this.blueAwardReportConfig.behavior.navigationTimeoutMs,
        });

        const accessIssue = await this.detectAccessIssue(page);
        if (accessIssue) {
          throw new Error(`Access blocked: ${accessIssue}`);
        }

        await this.waitForReportContent(page);
        await this.scrollToTop(page);
        await this.sleep(this.blueAwardReportConfig.lookerPostLoadDelayMs);
        await page.emulateMediaType(this.blueAwardReportConfig.render.emulateMediaType);

        await this.warnIfRenderLooksIncomplete(page, urlWithParams, submissionId, pageIndex, attempt);

        const dimensions = await this.getPageDimensions(page);
        const rawPdf = await page.pdf({
          width: `${this.getPdfWidth(dimensions)}px`,
          height: `${this.getPdfHeight(dimensions)}px`,
          printBackground: true,
          preferCSSPageSize: false,
          margin: {
            top: '0',
            right: '0',
            bottom: '0',
            left: '0',
          },
        });

        if (!rawPdf || rawPdf.length < 50000) {
          const screenshotPath = await this.writeDebugScreenshot(page, submissionId, pageIndex, attempt);
          console.warn(
            `Generated PDF is smaller than expected for submissionId=${submissionId}, page=${pageIndex + 1}, attempt=${attempt}; continuing because Looker rendered a capturable page.`,
            { url: urlWithParams, rawPdfLength: rawPdf?.length || 0, screenshotPath },
          );
        }

        const singlePdf = await PDFDocument.load(Buffer.from(rawPdf));
        this.cropPdfPages(singlePdf);
        return Buffer.from(await singlePdf.save());
      } catch (error) {
        lastError = error;
        if (attempt === this.blueAwardReportConfig.behavior.maxAttempts) {
          break;
        }
        await this.sleep(this.blueAwardReportConfig.behavior.retryDelayMs);
      } finally {
        await page?.close().catch(() => undefined);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to capture Looker Studio page');
  }

  private async createConfiguredPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({
      width: this.blueAwardReportConfig.viewport.width,
      height: this.blueAwardReportConfig.viewport.height,
      deviceScaleFactor: this.blueAwardReportConfig.viewport.deviceScaleFactor,
    });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });
    return page;
  }

  private async waitForReportContent(page: Page): Promise<boolean> {
    const behavior = this.blueAwardReportConfig.behavior;
    try {
      await page.waitForFunction((b) => {
        const body = document.body;
        if (!body) return false;
        const bodyText = (body.innerText || '').toLowerCase();
        if (bodyText.includes('captcha') || bodyText.includes('recaptcha')) return false;
        if (bodyText.includes('sign in') || bodyText.includes('log in')) return false;
        if (bodyText.includes('access denied') || bodyText.includes('request access')) return false;

        const visuals = document.querySelectorAll('canvas, svg, img');
        const reportIframe = Array.from(document.querySelectorAll('iframe')).find((frame) => {
          const src = (frame.getAttribute('src') || '').toLowerCase();
          const title = (frame.getAttribute('title') || '').toLowerCase();
          if (src.includes('recaptcha') || title.includes('recaptcha')) return false;
          const rect = frame.getBoundingClientRect();
          return rect.width > b.minIframeWidth && rect.height > b.minIframeHeight;
        });
        const richText = bodyText.replace(/\s+/g, ' ').trim();
        return visuals.length >= b.minVisualCount && richText.length > b.minRichTextLength && !!reportIframe;
      }, { timeout: this.blueAwardReportConfig.lookerCaptureReadyTimeoutMs }, behavior);
      return true;
    } catch {
      return false;
    }
  }

  private async detectAccessIssue(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        if (text.includes('recaptcha') || text.includes('captcha')) return 'captcha_challenge';
        if (text.includes('sign in') || text.includes('log in')) return 'google_login_required';
        if (text.includes('request access') || text.includes('access denied')) return 'report_access_denied';
        return null;
      });
    } catch (error) {
      this.warnDetachedFrame('detectAccessIssue', error);
      return null;
    }
  }

  private async getRenderSummary(page: Page): Promise<RenderSummary> {
    try {
      return await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        const normalizedBodyText = bodyText.toLowerCase();
        const visuals = Array.from(document.querySelectorAll('canvas, svg, img'));
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const largeVisualCount = visuals.filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width >= 200 && rect.height >= 120;
        }).length;
        const largeIframeCount = iframes.filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width >= 600 && rect.height >= 600;
        }).length;

        return {
          title: document.title || '',
          bodyTextLength: bodyText.length,
          canvasCount: document.querySelectorAll('canvas').length,
          svgCount: document.querySelectorAll('svg').length,
          imgCount: document.querySelectorAll('img').length,
          iframeCount: iframes.length,
          largeVisualCount,
          largeIframeCount,
          hasBlueAwardText: normalizedBodyText.includes('blue award'),
          hasNoDataReportText:
            normalizedBodyText.includes('no data') &&
            normalizedBodyText.includes('organisational carbon footprint report'),
          scrollWidth: Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0),
          scrollHeight: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0),
        };
      });
    } catch (error) {
      this.warnDetachedFrame('getRenderSummary', error);
      return {
        title: '',
        bodyTextLength: this.blueAwardReportConfig.behavior.minRichTextLength,
        canvasCount: 0,
        svgCount: 0,
        imgCount: 0,
        iframeCount: 0,
        largeVisualCount: 1,
        largeIframeCount: 1,
        hasBlueAwardText: false,
        hasNoDataReportText: false,
        scrollWidth: this.blueAwardReportConfig.viewport.width,
        scrollHeight: this.blueAwardReportConfig.viewport.height,
      };
    }
  }

  private async warnIfRenderLooksIncomplete(
    page: Page,
    urlWithParams: string,
    submissionId: number,
    pageIndex: number,
    attempt: number,
  ): Promise<void> {
    const renderSummary = await this.getRenderSummary(page);
    const renderedEnough =
      renderSummary.largeIframeCount > 0 &&
      (renderSummary.largeVisualCount > 0 ||
        renderSummary.bodyTextLength >= this.blueAwardReportConfig.behavior.minRichTextLength);
    const renderedNoDataReport =
      renderSummary.bodyTextLength > 50 &&
      renderSummary.bodyTextLength < this.blueAwardReportConfig.behavior.minRichTextLength &&
      renderSummary.hasBlueAwardText &&
      renderSummary.hasNoDataReportText;

    if (!renderedEnough && !renderedNoDataReport) {
      const screenshotPath = await this.writeDebugScreenshot(page, submissionId, pageIndex, attempt);
      console.warn(
        `Looker report readiness heuristics were not satisfied for submissionId=${submissionId}, page=${pageIndex + 1}, attempt=${attempt}; continuing with PDF capture.`,
        { url: urlWithParams, screenshotPath, renderSummary },
      );
    }
  }

  private async getPageDimensions(page: Page): Promise<PageDimensions> {
    try {
      return await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const docWidth = Math.max(
          doc?.scrollWidth || 0,
          doc?.clientWidth || 0,
          body?.scrollWidth || 0,
          body?.clientWidth || 0,
        );
        const docHeight = Math.max(
          doc?.scrollHeight || 0,
          doc?.clientHeight || 0,
          body?.scrollHeight || 0,
          body?.clientHeight || 0,
        );
        let visualMinLeft = Number.POSITIVE_INFINITY;
        let visualMaxRight = 0;
        let visualMaxBottom = 0;
        const visualNodes = document.querySelectorAll('canvas, svg, img, iframe');
        visualNodes.forEach((node) => {
          const rect = node.getBoundingClientRect();
          const left = rect.left + window.scrollX;
          const right = rect.right + window.scrollX;
          const bottom = rect.bottom + window.scrollY;
          if (left < visualMinLeft) visualMinLeft = left;
          if (right > visualMaxRight) visualMaxRight = right;
          if (bottom > visualMaxBottom) visualMaxBottom = bottom;
        });
        return {
          docWidth,
          docHeight,
          visualMinLeft: Number.isFinite(visualMinLeft) ? Math.floor(visualMinLeft) : 0,
          visualMaxRight: Math.ceil(visualMaxRight),
          visualMaxBottom: Math.ceil(visualMaxBottom),
        };
      });
    } catch (error) {
      this.warnDetachedFrame('getPageDimensions', error);
      return this.getFallbackPageDimensions();
    }
  }

  private getPdfWidth(dimensions: PageDimensions): number {
    const visualWidth = dimensions.visualMaxRight > 0
      ? Math.max(0, dimensions.visualMaxRight - Math.max(0, dimensions.visualMinLeft))
      : 0;
    const contentWidth = visualWidth > 0 ? visualWidth : dimensions.docWidth;
    const baseWidth = Math.max(contentWidth + this.blueAwardReportConfig.behavior.horizontalPadding, 1);
    return Math.min(baseWidth, this.blueAwardReportConfig.pdfLimits.maxWidth);
  }

  private getPdfHeight(dimensions: PageDimensions): number {
    const contentHeight = dimensions.visualMaxBottom > 0 ? dimensions.visualMaxBottom : dimensions.docHeight;
    const baseHeight = Math.max(contentHeight + this.blueAwardReportConfig.behavior.verticalPadding, 1);
    return Math.min(baseHeight, this.blueAwardReportConfig.pdfLimits.maxHeight);
  }

  private cropPdfPages(pdf: PDFDocument): void {
    const leftTrimPx = this.blueAwardReportConfig.trims.left;
    const topTrimPx = this.blueAwardReportConfig.trims.top;
    const rightTrimPx = this.blueAwardReportConfig.trims.right;
    const bottomTrimPx = this.blueAwardReportConfig.trims.bottom;

    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      const cropLeft = Math.max(0, Math.min(leftTrimPx, width - 1));
      const cropRight = Math.max(0, Math.min(rightTrimPx, width - cropLeft - 1));
      const cropTop = Math.max(0, Math.min(topTrimPx, height - 1));
      const cropBottom = Math.max(0, Math.min(bottomTrimPx, height - cropTop - 1));
      const croppedWidth = Math.max(1, width - cropLeft - cropRight);
      const croppedHeight = Math.max(1, height - cropTop - cropBottom);
      page.setCropBox(cropLeft, cropBottom, croppedWidth, croppedHeight);
      page.setMediaBox(cropLeft, cropBottom, croppedWidth, croppedHeight);
    }
  }

  private async writeDebugScreenshot(page: Page, submissionId: number, pageIndex: number, attempt: number): Promise<string> {
    const filePath = path.join(os.tmpdir(), `blue-award-${submissionId}-page-${pageIndex + 1}-attempt-${attempt}.png`);
    await page.screenshot({ path: filePath, fullPage: true }).catch((error) => {
      this.warnDetachedFrame('writeDebugScreenshot', error);
    });
    return filePath;
  }

  private async scrollToTop(page: Page): Promise<void> {
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch (error) {
      this.warnDetachedFrame('scrollToTop', error);
    }
  }

  private getFallbackPageDimensions(): PageDimensions {
    return {
      docWidth: this.blueAwardReportConfig.viewport.width,
      docHeight: this.blueAwardReportConfig.viewport.height,
      visualMinLeft: 0,
      visualMaxRight: this.blueAwardReportConfig.viewport.width,
      visualMaxBottom: this.blueAwardReportConfig.viewport.height,
    };
  }

  private warnDetachedFrame(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('detached frame')) {
      console.warn(`Ignoring transient detached frame during ${context}: ${message}`);
    } else {
      console.warn(`Ignoring transient page inspection error during ${context}: ${message}`);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
