import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import {
  extractContractFromText,
  extractReadablePdfText,
} from "../lib/contract-extraction";

const maximumUploadBytes = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumUploadBytes, files: 1 },
});

const router: IRouter = Router();

export function isPdf(file: Express.Multer.File): boolean {
  return file.mimetype === "application/pdf" && file.buffer.subarray(0, 5).toString() === "%PDF-";
}

router.post(
  "/contracts/extract",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Choose one PDF contract to continue." });
      return;
    }

    if (!isPdf(file)) {
      res.status(400).json({ error: "Only valid PDF files can be uploaded." });
      return;
    }

    let text: string;
    try {
      text = await extractReadablePdfText(file.buffer);
    } catch (error) {
      req.log.warn({ err: error }, "Unable to read uploaded PDF");
      res.status(422).json({
        error: "We could not read text from this PDF. Try a text-based contract PDF.",
      });
      return;
    }

    if (text.length < 50) {
      res.status(422).json({
        error: "This PDF has no readable contract text. Try a text-based PDF instead.",
      });
      return;
    }

    try {
      const result = await extractContractFromText(text, file.originalname);
      req.log.info({ bytes: file.size }, "Contract extracted");
      res.json(result);
    } catch (error) {
      req.log.error({ err: error }, "Contract extraction failed");
      res.status(502).json({
        error: "We could not extract this contract right now. Please try again.",
      });
    }
  },
);

router.use(
  (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (error instanceof multer.MulterError) {
      req.log.warn({ code: error.code }, "Invalid contract upload");
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "PDF files must be 10 MB or smaller." });
        return;
      }
      res.status(400).json({ error: "Please upload one PDF contract at a time." });
      return;
    }
    next(error);
  },
);

export default router;