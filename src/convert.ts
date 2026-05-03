import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const OFFICE_EXT = new Set([
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

const AUDIO_EXT = new Set([".m4a", ".mp3", ".wav", ".ogg"]);

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const CONVERT_DIR = "/tmp/ingest";

export function isOfficeFile(rel: string): boolean {
  return OFFICE_EXT.has(extname(rel).toLowerCase());
}

export function convertedPdfPath(rel: string): string {
  const name = basename(rel, extname(rel)) + ".pdf";
  return join(CONVERT_DIR, dirname(rel), name);
}

export function convertOfficeToPdf(orgRoot: string, rel: string): string {
  const absPath = join(orgRoot, rel);
  const outDir = join(CONVERT_DIR, dirname(rel));
  mkdirSync(outDir, { recursive: true });

  const soffice = findSoffice();
  execFileSync(
    soffice,
    ["--headless", "--convert-to", "pdf", "--outdir", outDir, absPath],
    { stdio: "pipe" },
  );

  const out = convertedPdfPath(rel);
  if (!existsSync(out)) {
    throw new Error(`conversion failed: ${out} not produced`);
  }
  return out;
}

export function isAudioFile(rel: string): boolean {
  return AUDIO_EXT.has(extname(rel).toLowerCase());
}

export function isImageFile(rel: string): boolean {
  return IMAGE_EXT.has(extname(rel).toLowerCase());
}

export function transcribedTextPath(rel: string): string {
  const name = basename(rel, extname(rel)) + ".txt";
  return join(CONVERT_DIR, dirname(rel), name);
}

export function transcribeAudio(orgRoot: string, rel: string): string {
  const absPath = join(orgRoot, rel);
  const outDir = join(CONVERT_DIR, dirname(rel));
  mkdirSync(outDir, { recursive: true });

  const whisper = findWhisper();
  const outBase = join(outDir, basename(rel, extname(rel)));

  execFileSync(
    whisper,
    ["--model", "large", "--output_format", "txt", "--output_dir", outDir, absPath],
    { stdio: "pipe" },
  );

  const out = outBase + ".txt";
  if (!existsSync(out)) {
    throw new Error(`whisper transcription failed: ${out} not produced`);
  }
  return out;
}

function findWhisper(): string {
  for (const cmd of ["whisper", "whisper-ctranslate2"]) {
    try {
      execFileSync("which", [cmd], { stdio: "pipe" });
      return cmd;
    } catch {
      // not in PATH
    }
  }
  throw new Error(
    "Whisper not found. Install it:\n  pip install openai-whisper",
  );
}

function findSoffice(): string {
  const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  if (existsSync(macPath)) return macPath;

  for (const cmd of ["soffice", "libreoffice"]) {
    try {
      execFileSync("which", [cmd], { stdio: "pipe" });
      return cmd;
    } catch {
      // not in PATH
    }
  }

  throw new Error(
    "LibreOffice not found. Install it:\n  brew install --cask libreoffice",
  );
}
