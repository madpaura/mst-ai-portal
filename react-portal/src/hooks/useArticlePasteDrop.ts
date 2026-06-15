import { useState, useEffect, useRef, useMemo } from 'react';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { api, toApiError } from '../api/client';

export interface InlineUpload {
  url: string;
  filename: string;
  mime_type: string;
  file_size: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface Options {
  /** Functional update of the markdown content backing the textarea. */
  setContent: (update: (prev: string) => string) => void;
  /** Called after a dropped/pasted PDF uploads — switch the article to PDF mode. */
  onPdfUploaded: (upload: InlineUpload) => void;
  /** Window-level drop capture only runs while true (e.g. an article is open). */
  active: boolean;
}

/**
 * Shared rich-paste / file-drop behaviour for the article markdown editors:
 * pasted HTML converts to GFM markdown (turndown), pasted/dropped images
 * upload to /articles/uploads and insert as ![](url), and a PDF anywhere on
 * the page routes to onPdfUploaded instead of the browser opening it.
 */
export function useArticlePasteDrop({ setContent, onPdfUploaded, active }: Options) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);

  const turndown = useMemo(() => {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    });
    td.use(gfm);
    return td;
  }, []);

  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    setContent((prev) => {
      const focused = ta && document.activeElement === ta;
      const start = focused ? ta.selectionStart : prev.length;
      const end = focused ? ta.selectionEnd : prev.length;
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      const needsNewline = before.length > 0 && !before.endsWith('\n') && text.startsWith('!');
      const inserted = (needsNewline ? '\n' : '') + text;
      requestAnimationFrame(() => {
        if (ta) ta.selectionStart = ta.selectionEnd = (before + inserted).length;
      });
      return before + inserted + after;
    });
  };

  const uploadInline = (file: File) => api.upload<InlineUpload>('/articles/uploads', file);

  const uploadAndInsertImage = async (file: File) => {
    const token = `![Uploading ${file.name || 'image'}…]()`;
    insertAtCursor(`${token}\n`);
    try {
      const res = await uploadInline(file);
      setContent((prev) => prev.replace(token, `![${res.filename}](${res.url})`));
    } catch (err: unknown) {
      setContent((prev) => prev.replace(`${token}\n`, '').replace(token, ''));
      alert(err instanceof Error ? toApiError(err) : 'Image upload failed');
    }
  };

  // Convert pasted HTML to markdown; embedded data-URI images are uploaded
  // and replaced with portal URLs so the markdown stays lightweight.
  const htmlToMarkdown = async (html: string): Promise<string> => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('data:image/')) {
        try {
          const blob = await (await fetch(src)).blob();
          const ext = MIME_TO_EXT[blob.type] || 'png';
          const file = new File([blob], `pasted-image.${ext}`, { type: blob.type });
          const res = await uploadInline(file);
          img.setAttribute('src', res.url);
        } catch {
          img.remove(); // unsupported/oversized embedded image — drop it
        }
      } else if (src.startsWith('file:') || src.startsWith('blob:')) {
        img.remove(); // local references are unreachable from the portal
      }
    }
    return turndown.turndown(doc.body.innerHTML).trim();
  };

  // Latest-closure ref so window listeners (registered once per `active`)
  // and async handlers never call a stale callback.
  const onPdfUploadedRef = useRef(onPdfUploaded);
  onPdfUploadedRef.current = onPdfUploaded;

  const handlePdf = async (file: File) => {
    setUploadingPdf(true);
    try {
      const res = await uploadInline(file);
      onPdfUploadedRef.current(res);
    } catch (err: unknown) {
      alert(err instanceof Error ? toApiError(err) : 'PDF upload failed');
    }
    setUploadingPdf(false);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    const files = Array.from(cd.files);
    if (files.length === 0) {
      // Some browsers expose pasted files only through items
      for (const item of Array.from(cd.items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    const html = cd.getData('text/html');

    // PDF file pasted from the OS file manager → switch to PDF mode
    const pdf = files.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdf) {
      e.preventDefault();
      await handlePdf(pdf);
      return;
    }

    // Screenshot / copied image (no meaningful HTML alongside it)
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length > 0 && !html.trim()) {
      e.preventDefault();
      for (const f of imageFiles) await uploadAndInsertImage(f);
      return;
    }

    if (html.trim()) {
      e.preventDefault();
      try {
        const md = await htmlToMarkdown(html);
        insertAtCursor(md || cd.getData('text/plain'));
      } catch {
        insertAtCursor(cd.getData('text/plain'));
      }
    }
    // Plain text → default browser paste
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const pdf = files.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdf) {
      await handlePdf(pdf);
      return;
    }
    for (const f of files.filter((f) => f.type.startsWith('image/'))) {
      await uploadAndInsertImage(f);
    }
  };

  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;

  // Capture file drags at the window level: dropping anywhere on the page
  // routes into the editor instead of the browser opening the file in a
  // new tab (the default for drops that miss a drop zone).
  useEffect(() => {
    if (!active) return;
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types || []).includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (isFileDrag(e)) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragOver(false);
      handleFilesRef.current(Array.from(e.dataTransfer?.files || []));
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false); // drag left the window
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragleave', onDragLeave);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragleave', onDragLeave);
      setDragOver(false);
    };
  }, [active]);

  return { textareaRef, dragOver, uploadingPdf, handlePaste };
}
