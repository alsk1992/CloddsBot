/**
 * Open Prose Extension
 * Provides document editing capabilities with AI assistance
 *
 * Supports: Markdown, rich text, collaborative editing
 */

import { logger } from '../../utils/logger';
import { generateId as generateSecureId } from '../../utils/id';

// Lazy-load puppeteer to avoid startup cost
let puppeteerModule: typeof import('puppeteer') | null = null;
async function getPuppeteer() {
  if (!puppeteerModule) {
    puppeteerModule = await import('puppeteer');
  }
  return puppeteerModule;
}

// Lazy-load docx library (for writing)
let docxModule: typeof import('docx') | null = null;
async function getDocx() {
  if (!docxModule) {
    docxModule = await import('docx');
  }
  return docxModule;
}

// Lazy-load mammoth library (for reading DOCX)
interface MammothResult {
  value: string;
  messages: Array<{ type: string; message: string }>;
}
interface MammothModule {
  convertToMarkdown(options: { buffer: Buffer }): Promise<MammothResult>;
  convertToHtml(options: { buffer: Buffer }): Promise<MammothResult>;
  extractRawText(options: { buffer: Buffer }): Promise<MammothResult>;
}
let mammothModule: MammothModule | null = null;
async function getMammoth(): Promise<MammothModule> {
  if (!mammothModule) {
    mammothModule = await import('mammoth') as unknown as MammothModule;
  }
  return mammothModule;
}

export interface OpenProseConfig {
  enabled: boolean;
  /** Document storage path */
  storagePath?: string;
  /** Enable version history */
  enableHistory?: boolean;
  /** Maximum history entries per document */
  maxHistoryEntries?: number;
  /** Auto-save interval in milliseconds */
  autoSaveIntervalMs?: number;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  format: 'markdown' | 'html' | 'plaintext';
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface DocumentVersion {
  version: number;
  content: string;
  timestamp: number;
  author?: string;
  message?: string;
}

export interface EditOperation {
  type: 'insert' | 'delete' | 'replace';
  position: number;
  length?: number;
  text?: string;
}

export interface OpenProseExtension {
  /** Create a new document */
  createDocument(title: string, content?: string, format?: Document['format']): Promise<Document>;
  /** Get document by ID */
  getDocument(id: string): Promise<Document | null>;
  /** Update document content */
  updateDocument(id: string, content: string, message?: string): Promise<Document>;
  /** Apply edit operations */
  applyEdits(id: string, operations: EditOperation[]): Promise<Document>;
  /** Get document history */
  getHistory(id: string): Promise<DocumentVersion[]>;
  /** Restore document to version */
  restoreVersion(id: string, version: number): Promise<Document>;
  /** Delete document */
  deleteDocument(id: string): Promise<boolean>;
  /** List all documents */
  listDocuments(): Promise<Document[]>;
  /** AI-assisted editing */
  aiEdit(id: string, instruction: string, provider?: any): Promise<{ document: Document; changes: string }>;
  /** AI-assisted completion */
  aiComplete(id: string, position: number, provider?: any): Promise<string>;
  /** AI-assisted summarization */
  aiSummarize(id: string, provider?: any): Promise<string>;
  /** AI-assisted rewrite */
  aiRewrite(id: string, style: string, provider?: any): Promise<{ document: Document; changes: string }>;
  /** AI-assisted expand */
  aiExpand(id: string, section?: string, provider?: any): Promise<{ document: Document; changes: string }>;
  /** Export document */
  exportDocument(id: string, format: 'md' | 'html' | 'pdf' | 'docx'): Promise<Buffer>;
  /** Import document */
  importDocument(content: Buffer, format: 'md' | 'html' | 'docx'): Promise<Document>;
}

export async function createOpenProseExtension(config: OpenProseConfig): Promise<OpenProseExtension> {
  const documents = new Map<string, Document>();
  const history = new Map<string, DocumentVersion[]>();
  const maxHistoryEntries = config.maxHistoryEntries || 100;

  function generateId(): string {
    return generateSecureId('doc');
  }

  function addToHistory(docId: string, doc: Document, message?: string): void {
    if (!config.enableHistory) return;

    if (!history.has(docId)) {
      history.set(docId, []);
    }

    const versions = history.get(docId)!;
    versions.push({
      version: doc.version,
      content: doc.content,
      timestamp: doc.updatedAt,
      message,
    });

    // Trim history
    while (versions.length > maxHistoryEntries) {
      versions.shift();
    }
  }

  function applyOperation(content: string, op: EditOperation): string {
    switch (op.type) {
      case 'insert':
        return content.slice(0, op.position) + (op.text || '') + content.slice(op.position);

      case 'delete':
        return content.slice(0, op.position) + content.slice(op.position + (op.length || 0));

      case 'replace':
        return (
          content.slice(0, op.position) +
          (op.text || '') +
          content.slice(op.position + (op.length || 0))
        );

      default:
        return content;
    }
  }

  const extension: OpenProseExtension = {
    async createDocument(
      title: string,
      content?: string,
      format?: Document['format']
    ): Promise<Document> {
      const id = generateId();
      const now = Date.now();

      const doc: Document = {
        id,
        title,
        content: content || '',
        format: format || 'markdown',
        metadata: {},
        createdAt: now,
        updatedAt: now,
        version: 1,
      };

      documents.set(id, doc);
      addToHistory(id, doc, 'Created document');

      logger.info({ id, title }, 'Document created');
      return doc;
    },

    async getDocument(id: string): Promise<Document | null> {
      return documents.get(id) || null;
    },

    async updateDocument(id: string, content: string, message?: string): Promise<Document> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      doc.content = content;
      doc.updatedAt = Date.now();
      doc.version++;

      addToHistory(id, doc, message);

      logger.debug({ id, version: doc.version }, 'Document updated');
      return doc;
    },

    async applyEdits(id: string, operations: EditOperation[]): Promise<Document> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      let content = doc.content;
      for (const op of operations) {
        content = applyOperation(content, op);
      }

      doc.content = content;
      doc.updatedAt = Date.now();
      doc.version++;

      addToHistory(id, doc, `Applied ${operations.length} edit(s)`);

      return doc;
    },

    async getHistory(id: string): Promise<DocumentVersion[]> {
      return history.get(id) || [];
    },

    async restoreVersion(id: string, version: number): Promise<Document> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      const versions = history.get(id) || [];
      const targetVersion = versions.find((v) => v.version === version);

      if (!targetVersion) {
        throw new Error(`Version ${version} not found`);
      }

      doc.content = targetVersion.content;
      doc.updatedAt = Date.now();
      doc.version++;

      addToHistory(id, doc, `Restored to version ${version}`);

      logger.info({ id, restoredVersion: version, newVersion: doc.version }, 'Document restored');
      return doc;
    },

    async deleteDocument(id: string): Promise<boolean> {
      const deleted = documents.delete(id);
      history.delete(id);

      if (deleted) {
        logger.info({ id }, 'Document deleted');
      }

      return deleted;
    },

    async listDocuments(): Promise<Document[]> {
      return Array.from(documents.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async aiEdit(
      id: string,
      instruction: string,
      provider?: any
    ): Promise<{ document: Document; changes: string }> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      if (!provider) {
        throw new Error('Provider required for AI edit');
      }

      const prompt = `You are an expert editor. Apply this instruction to the document.

Instruction: ${instruction}

Document (${doc.format}):
${doc.content}

Respond with ONLY the edited document content, no explanations. Preserve the original format.`;

      const response = await provider.complete({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 8192,
      });

      const newContent = response.text.trim();
      const previousContent = doc.content;

      doc.content = newContent;
      doc.updatedAt = Date.now();
      doc.version++;
      addToHistory(id, doc, `AI edit: ${instruction.substring(0, 50)}...`);

      // Calculate diff summary
      const oldWords = previousContent.split(/\s+/).length;
      const newWords = newContent.split(/\s+/).length;
      const wordDiff = newWords - oldWords;
      const changes = wordDiff > 0
        ? `Added ~${wordDiff} words`
        : wordDiff < 0
          ? `Removed ~${Math.abs(wordDiff)} words`
          : 'Content restructured';

      logger.info({ id, instruction, changes }, 'AI edit completed');

      return {
        document: doc,
        changes,
      };
    },

    async aiComplete(id: string, position: number, provider?: any): Promise<string> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      if (!provider) {
        throw new Error('Provider required for AI completion');
      }

      const textBefore = doc.content.substring(0, position);
      const textAfter = doc.content.substring(position);

      const prompt = `Continue writing this ${doc.format} document naturally.
Match the style, tone, and format of the existing content.

Text before cursor:
${textBefore}

${textAfter ? `Text after cursor:\n${textAfter}` : ''}

Provide only the completion text, no explanations. Write 1-3 sentences that naturally continue from where the cursor is.`;

      const response = await provider.complete({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 500,
      });

      const completion = response.text.trim();
      logger.info({ id, position, completionLength: completion.length }, 'AI completion generated');

      return completion;
    },

    async aiSummarize(id: string, provider?: any): Promise<string> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      if (!provider) {
        throw new Error('Provider required for AI summarize');
      }

      const prompt = `Summarize this document in 2-3 concise sentences:

${doc.content}`;

      const response = await provider.complete({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 200,
      });

      return response.text.trim();
    },

    async aiRewrite(id: string, style: string, provider?: any): Promise<{ document: Document; changes: string }> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      if (!provider) {
        throw new Error('Provider required for AI rewrite');
      }

      const prompt = `Rewrite this document in a ${style} style while preserving the core meaning:

${doc.content}

Output only the rewritten document content.`;

      const response = await provider.complete({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 8192,
      });

      const newContent = response.text.trim();
      doc.content = newContent;
      doc.updatedAt = Date.now();
      doc.version++;
      addToHistory(id, doc, `AI rewrite: ${style} style`);

      return {
        document: doc,
        changes: `Rewritten in ${style} style`,
      };
    },

    async aiExpand(id: string, section?: string, provider?: any): Promise<{ document: Document; changes: string }> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      if (!provider) {
        throw new Error('Provider required for AI expand');
      }

      const prompt = section
        ? `Expand this section with more detail while fitting the document context:

Section to expand:
${section}

Full document:
${doc.content}

Output the full document with the expanded section.`
        : `Expand this document with more detail, examples, and elaboration:

${doc.content}

Output the expanded document.`;

      const response = await provider.complete({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 8192,
      });

      const newContent = response.text.trim();
      const oldWords = doc.content.split(/\s+/).length;
      const newWords = newContent.split(/\s+/).length;

      doc.content = newContent;
      doc.updatedAt = Date.now();
      doc.version++;
      addToHistory(id, doc, 'AI expand');

      return {
        document: doc,
        changes: `Expanded from ${oldWords} to ${newWords} words`,
      };
    },

    async exportDocument(
      id: string,
      format: 'md' | 'html' | 'pdf' | 'docx'
    ): Promise<Buffer> {
      const doc = documents.get(id);
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      switch (format) {
        case 'md':
          return Buffer.from(doc.content, 'utf-8');

        case 'html': {
          // Simple markdown to HTML conversion
          let html = doc.content
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*)\*/gim, '<em>$1</em>')
            .replace(/\n/gim, '<br>');

          html = `<!DOCTYPE html>
<html>
<head><title>${doc.title}</title></head>
<body>${html}</body>
</html>`;

          return Buffer.from(html, 'utf-8');
        }

        case 'pdf': {
          // Convert markdown to HTML first
          let pdfHtml = doc.content
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*)\*/gim, '<em>$1</em>')
            .replace(/\n/gim, '<br>');

          const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${doc.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
    h1, h2, h3 { margin-top: 1.5em; margin-bottom: 0.5em; }
    h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body>${pdfHtml}</body>
</html>`;

          try {
            const puppeteer = await getPuppeteer();
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
            const pdfBuffer = await page.pdf({
              format: 'A4',
              margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
              printBackground: true,
            });
            await browser.close();
            return Buffer.from(pdfBuffer);
          } catch (err) {
            logger.error({ err }, 'Failed to generate PDF with puppeteer');
            throw new Error('PDF export failed - puppeteer error');
          }
        }

        case 'docx': {
          try {
            const docx = await getDocx();

            // Parse markdown content into paragraphs
            const lines = doc.content.split('\n');
            const children: InstanceType<typeof docx.Paragraph>[] = [];

            for (const line of lines) {
              // Handle headings
              if (line.startsWith('### ')) {
                children.push(new docx.Paragraph({
                  text: line.slice(4),
                  heading: docx.HeadingLevel.HEADING_3,
                }));
              } else if (line.startsWith('## ')) {
                children.push(new docx.Paragraph({
                  text: line.slice(3),
                  heading: docx.HeadingLevel.HEADING_2,
                }));
              } else if (line.startsWith('# ')) {
                children.push(new docx.Paragraph({
                  text: line.slice(2),
                  heading: docx.HeadingLevel.HEADING_1,
                }));
              } else if (line.startsWith('- ') || line.startsWith('* ')) {
                // Bullet list
                children.push(new docx.Paragraph({
                  text: line.slice(2),
                  bullet: { level: 0 },
                }));
              } else if (/^\d+\.\s/.test(line)) {
                // Numbered list
                children.push(new docx.Paragraph({
                  text: line.replace(/^\d+\.\s/, ''),
                  numbering: { reference: 'default-numbering', level: 0 },
                }));
              } else if (line.trim() === '') {
                // Empty line = spacing
                children.push(new docx.Paragraph({ text: '' }));
              } else {
                // Regular paragraph - handle bold/italic
                const textRuns: InstanceType<typeof docx.TextRun>[] = [];
                let remaining = line;

                // Simple parsing for **bold** and *italic*
                const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
                let match;
                while ((match = regex.exec(remaining)) !== null) {
                  if (match[2]) {
                    // Bold
                    textRuns.push(new docx.TextRun({ text: match[2], bold: true }));
                  } else if (match[3]) {
                    // Italic
                    textRuns.push(new docx.TextRun({ text: match[3], italics: true }));
                  } else if (match[4]) {
                    // Plain text
                    textRuns.push(new docx.TextRun({ text: match[4] }));
                  }
                }

                children.push(new docx.Paragraph({ children: textRuns.length ? textRuns : [new docx.TextRun(line)] }));
              }
            }

            const docxDoc = new docx.Document({
              title: doc.title,
              creator: 'Clodds',
              numbering: {
                config: [{
                  reference: 'default-numbering',
                  levels: [{
                    level: 0,
                    format: docx.LevelFormat.DECIMAL,
                    text: '%1.',
                    alignment: docx.AlignmentType.LEFT,
                  }],
                }],
              },
              sections: [{
                properties: {},
                children,
              }],
            });

            const buffer = await docx.Packer.toBuffer(docxDoc);
            return Buffer.from(buffer);
          } catch (err) {
            logger.error({ err }, 'Failed to generate DOCX');
            throw new Error('DOCX export failed');
          }
        }

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    },

    async importDocument(
      content: Buffer,
      format: 'md' | 'html' | 'docx'
    ): Promise<Document> {
      let textContent = content.toString('utf-8');
      let title = 'Imported Document';

      switch (format) {
        case 'md': {
          // Extract title from first heading
          const titleMatch = textContent.match(/^#\s+(.+)$/m);
          if (titleMatch) {
            title = titleMatch[1];
          }
          break;
        }

        case 'html': {
          // Extract title from <title> or first <h1>
          const titleTagMatch = textContent.match(/<title>([^<]+)<\/title>/i);
          const h1Match = textContent.match(/<h1[^>]*>([^<]+)<\/h1>/i);
          title = titleTagMatch?.[1] || h1Match?.[1] || title;

          // Strip HTML tags for simple conversion
          textContent = textContent
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          break;
        }

        case 'docx': {
          try {
            const mammoth = await getMammoth();
            // Convert DOCX to markdown
            const result = await mammoth.convertToMarkdown({ buffer: content });
            textContent = result.value;

            // Extract title from first heading
            const docxTitleMatch = textContent.match(/^#\s+(.+)$/m);
            if (docxTitleMatch) {
              title = docxTitleMatch[1];
            }

            if (result.messages.length > 0) {
              logger.warn({ messages: result.messages }, 'DOCX import warnings');
            }
          } catch (err) {
            logger.error({ err }, 'Failed to import DOCX');
            throw new Error('DOCX import failed');
          }
          break;
        }
      }

      return extension.createDocument(title, textContent, 'markdown');
    },
  };

  return extension;
}
