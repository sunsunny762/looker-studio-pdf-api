import 'dotenv/config';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { HttpError } from './http-error';
import { ReportService } from './report.service';

const app = express();
const reportService = new ReportService();
const port = Number(process.env.PORT || 8080);
const defaultSubmissionId = Number(process.env.DEFAULT_SUBMISSION_ID || 12659);

app.disable('x-powered-by');
app.use(cors());

function buildDownloadFileName(fileName: string | undefined, defaultBaseName: string, contentType: string): string {
  const safeBaseName = (fileName || defaultBaseName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const extension = contentType.toLowerCase().includes('application/pdf') ? '.pdf' : '.bin';
  return safeBaseName.toLowerCase().endsWith(extension) ? safeBaseName : `${safeBaseName}${extension}`;
}

function getFirstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
  if (value === undefined || value === null) return undefined;
  return String(value);
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'looker-studio-pdf-api',
  });
});

app.get('/report/looker-studio/blue-award/merged-download', async (req: Request, res: Response) => {
  try {
    const submissionIdValue = getFirstQueryValue(req.query.submissionId) || getFirstQueryValue(req.query.p_submission_id);
    const parsedSubmissionId = submissionIdValue ? Number.parseInt(submissionIdValue, 10) : defaultSubmissionId;
    if (!Number.isInteger(parsedSubmissionId) || parsedSubmissionId <= 0) {
      throw new HttpError(400, 'submissionId must be a positive integer');
    }

    const companyName = getFirstQueryValue(req.query.companyName);
    const reportUrl = getFirstQueryValue(req.query.reportUrl);
    const fileName = getFirstQueryValue(req.query.fileName);
    const pageUrls = reportUrl ? [reportUrl] : undefined;
    const buffer = await reportService.downloadMergedBlueAwardLookerStudioPdf(parsedSubmissionId, pageUrls, companyName);
    const resolvedFileName = buildDownloadFileName(fileName, `blue-award-merged-${parsedSubmissionId}`, 'application/pdf');

    res.set({
      'Content-Disposition': `attachment; filename="${resolvedFileName}"`,
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    console.error('Looker Studio PDF generation failed', { statusCode, message });
    res.status(statusCode).json({
      statusCode,
      message,
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Looker Studio PDF API listening on port ${port}`);
});
