import React, { useState, useEffect, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../api/client';
import { HlsPlayer, type HlsPlayerHandle } from '../components/HlsPlayer';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Video {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category: string;
  duration_s: number | null;
  status: string;
  hls_path: string | null;
  thumbnail: string | null;
  is_published: boolean;
  is_active: boolean;
  sort_order: number;
  course_id: string | null;
  job_status: string | null;
  job_error: string | null;
  created_at: string;
}

interface Chapter {
  id: string;
  video_id: string;
  title: string;
  start_time: number;
  sort_order: number;
}

interface Course {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  sort_order: number;
  video_count: number;
}

interface SeedNote {
  id: string;
  video_id: string;
  timestamp_s: number;
  content: string;
  created_at: string;
}

interface QualitySetting {
  quality: string;
  enabled: boolean;
  crf: number;
}

interface BannerConfig {
  id: string;
  video_id: string;
  variant: string;
  brand_title: string;
  company_logo: string;
  series_tag: string;
  topic: string;
  subtopic: string;
  episode: string;
  duration: string;
  presenter: string;
  presenter_initial: string;
  banner_duration_s: number;
  status: string;
  banner_video_path: string | null;
  error: string | null;
}

interface Attachment {
  id: string;
  video_id: string;
  filename: string;
  display_name: string | null;
  file_size: number;
  mime_type: string | null;
  sort_order: number;
  download_url: string;
  created_at: string;
}

type Tab = 'metadata' | 'chapters' | 'howto' | 'transcript' | 'quality' | 'seed-notes' | 'banner' | 'trim' | 'attachments' | 'email';

const DEFAULT_CATEGORIES = ['Code-mate', 'RAG', 'Agents', 'Deep Dive'];

export const AdminVideos: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('metadata');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Last-edited tracking
  const [lastEditedId, setLastEditedId] = useState<string | null>(
    () => localStorage.getItem('mst_last_edited_video')
  );
  const [opsLog, setOpsLog] = useState<Array<{ op: string; file: string; ts: string }>>([]);

  const markEdited = (id: string) => {
    setLastEditedId(id);
    localStorage.setItem('mst_last_edited_video', id);
  };

  // Create video form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', slug: '', description: '', category: 'Code-mate', course_id: '' });

  // Edit metadata form
  const [editForm, setEditForm] = useState({ title: '', description: '', category: '', course_id: '', sort_order: 0 });

  // Shared video player
  const playerRef = useRef<HlsPlayerHandle>(null);
  const rawVideoRef = useRef<HTMLVideoElement>(null);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerKey, setPlayerKey] = useState(0);

  // Processing poll
  const processingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  // Chapters
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [newChapter, setNewChapter] = useState({ title: '', start_time: 0 });
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editChapterForm, setEditChapterForm] = useState({ title: '', start_time: 0 });

  // Auto mode
  const [autoMode, setAutoMode] = useState(false);
  const [autoStatus, setAutoStatus] = useState<Record<string, any> | null>(null);
  const autoStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Transcript tab
  const [transcriptData, setTranscriptData] = useState<any | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);

  // How-to
  const [howtoTitle, setHowtoTitle] = useState('');
  const [howtoContent, setHowtoContent] = useState('');

  // Quality
  const [qualitySettings, setQualitySettings] = useState<QualitySetting[]>([]);

  // Seed notes
  const [seedNotes, setSeedNotes] = useState<SeedNote[]>([]);
  const [newSeedNote, setNewSeedNote] = useState({ timestamp_s: 0, content: '' });

  // Banner
  const [bannerConfig, setBannerConfig] = useState<BannerConfig | null>(null);
  const [bannerForm, setBannerForm] = useState({
    variant: 'A', company_logo: 'SAMSUNG', series_tag: 'KNOWLEDGE SERIES',
    brand_title: 'AI Ignite',
    topic: '', subtopic: '', episode: 'EP 01', duration: '3:15',
    presenter: '', presenter_initial: '', banner_duration_s: 3,
  });
  const [bannerGenerating, setBannerGenerating] = useState(false);
  const bannerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Attachments
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachUploading, setAttachUploading] = useState(false);

  // Email
  const [emailPreview, setEmailPreview] = useState<{ subject: string; html_content: string; plain_text: string } | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailGenerating, setEmailGenerating] = useState(false);
  const [emailCustomContent, setEmailCustomContent] = useState('');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSendingProgress, setEmailSendingProgress] = useState('');
  const [emailSavedAddresses, setEmailSavedAddresses] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mst_video_email_saved') || '[]'); } catch { return []; }
  });
  const [emailShowSaved, setEmailShowSaved] = useState(false);
  const emailCsvRef = useRef<HTMLInputElement>(null);

  // Trim / Cut / Speed
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const [trimMode, setTrimMode] = useState<'trim' | 'cut' | 'speed'>('trim');
  const [speedFactor, setSpeedFactor] = useState<number>(2);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Beautify
  const [beautifying, setBeautifying] = useState<string | null>(null);

  // Storage / cleanup
  interface StorageFile { name: string; size: number; is_intermediate: boolean; is_primary: boolean }
  const [showCleanup, setShowCleanup] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{ files: StorageFile[]; hls_size: number; thumb_size: number } | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);

  // Message
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Course creation popup
  const [showCourseCreate, setShowCourseCreate] = useState(false);
  const [courseForm, setCourseForm] = useState({ title: '', slug: '', description: '' });

  // Category management
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Expand/collapse for course groups
  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());

  const allCategories = [...DEFAULT_CATEGORIES, ...customCategories];

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleBeautify = async (field: string, content: string, setter: (val: string) => void) => {
    if (!content.trim()) return;
    setBeautifying(field);
    try {
      const result = await api.post<{ content: string }>('/admin/articles/beautify', { content });
      setter(result.content);
      showMsg('success', 'Content beautified with AI');
    } catch (err: any) {
      showMsg('error', 'Beautify failed: ' + err.message);
    } finally {
      setBeautifying(null);
    }
  };

  const fetchVideos = useCallback(async () => {
    try {
      const data = await api.get<Video[]>('/admin/videos');
      setVideos(data);
      setSelected(prev => prev ? (data.find(v => v.id === prev.id) ?? prev) : null);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCourses = useCallback(async () => {
    try {
      const data = await api.get<Course[]>('/admin/courses');
      setCourses(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchVideos();
    fetchCourses();
    // Load custom categories from localStorage
    const saved = localStorage.getItem('mst_custom_categories');
    if (saved) {
      try { setCustomCategories(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, [fetchVideos, fetchCourses]);

  const selectVideo = async (video: Video) => {
    setSelected(video);
    setActiveTab('metadata');
    setEditForm({
      title: video.title,
      description: video.description || '',
      category: video.category,
      course_id: video.course_id || '',
      sort_order: video.sort_order,
    });
    // Load tab data
    try {
      const [chaps, quality, seeds] = await Promise.all([
        api.get<Chapter[]>(`/admin/videos/${video.id}/chapters`),
        api.get<QualitySetting[]>(`/admin/videos/${video.id}/quality`),
        api.get<SeedNote[]>(`/admin/videos/${video.id}/seed-notes`),
      ]);
      setChapters(chaps);
      setQualitySettings(quality);
      setSeedNotes(seeds);
    } catch { /* ignore partial failures */ }
    // Load howto
    try {
      const howto = await api.get<{ title: string; content: string } | null>(`/admin/videos/${video.id}/howto`);
      setHowtoTitle(howto?.title || '');
      setHowtoContent(howto?.content || '');
    } catch {
      setHowtoTitle('');
      setHowtoContent('');
    }
    // Load banner config
    try {
      const banner = await api.get<BannerConfig | null>(`/admin/videos/${video.id}/banner`);
      setBannerConfig(banner);
      if (banner) {
        setBannerForm({
          variant: banner.variant, company_logo: banner.company_logo,
          series_tag: banner.series_tag, brand_title: banner.brand_title || 'AI Ignite',
          topic: banner.topic,
          subtopic: banner.subtopic, episode: banner.episode,
          duration: banner.duration, presenter: banner.presenter,
          presenter_initial: banner.presenter_initial,
          banner_duration_s: banner.banner_duration_s || 3,
        });
        setBannerGenerating(banner.status === 'generating');
      } else {
        // Auto-populate duration and episode number from video metadata
        const autoDuration = video.duration_s
          ? `${Math.floor(video.duration_s / 60)}:${String(video.duration_s % 60).padStart(2, '0')}`
          : '0:00';
        const autoEpisode = (() => {
          if (!video.course_id) return 'EP 01';
          const courseVids = [...videos.filter(v => v.course_id === video.course_id)]
            .sort((a, b) => a.sort_order - b.sort_order || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          const idx = courseVids.findIndex(v => v.id === video.id);
          return `EP ${String(idx >= 0 ? idx + 1 : 1).padStart(2, '0')}`;
        })();
        setBannerForm({
          variant: 'A', company_logo: 'SAMSUNG', series_tag: 'KNOWLEDGE SERIES',
          brand_title: 'AI Ignite',
          topic: video.title, subtopic: '', episode: autoEpisode, duration: autoDuration,
          presenter: '', presenter_initial: '', banner_duration_s: 3,
        });
        setBannerGenerating(false);
      }
    } catch {
      setBannerConfig(null);
    }
    // Load attachments
    try {
      const att = await api.get<Attachment[]>(`/admin/videos/${video.id}/attachments`);
      setAttachments(att);
    } catch {
      setAttachments([]);
    }
    // Load ops log
    try {
      const ops = await api.get<Array<{ op: string; file: string; ts: string }>>(`/admin/videos/${video.id}/ops-log`);
      setOpsLog(ops);
    } catch {
      setOpsLog([]);
    }
    // Load auto-processing status
    try {
      const status = await api.get<any>(`/admin/videos/${video.id}/auto-status`);
      setAutoStatus(status);
      // Resume polling if any job is still in-progress
      const jobs = status?.jobs || {};
      const anyRunning = Object.values(jobs).some(
        (j: any) => j.status === 'pending' || j.status === 'processing'
      ) || status?.transcript_status === 'processing';
      if (anyRunning) startAutoStatusPoll(video.id);
    } catch {
      setAutoStatus(null);
    }
  };

  const refreshOpsLog = async (videoId: string) => {
    try {
      const ops = await api.get<Array<{ op: string; file: string; ts: string }>>(`/admin/videos/${videoId}/ops-log`);
      setOpsLog(ops);
    } catch { /* ignore */ }
  };

  // ── Handlers ──────────────────────────────────────────

  const handleCreate = async () => {
    try {
      const v = await api.post<Video>('/admin/videos', {
        ...createForm,
        course_id: createForm.course_id || null,
      });
      setShowCreate(false);
      setCreateForm({ title: '', slug: '', description: '', category: 'Code-mate', course_id: '' });
      await fetchVideos();
      selectVideo(v);
      showMsg('success', 'Video created');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleCreateCourse = async () => {
    if (!courseForm.title.trim()) return;
    try {
      const slug = courseForm.slug || courseForm.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      await api.post('/admin/courses', {
        title: courseForm.title,
        slug,
        description: courseForm.description || null,
      });
      setShowCourseCreate(false);
      setCourseForm({ title: '', slug: '', description: '' });
      await fetchCourses();
      showMsg('success', 'Course created');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name || allCategories.includes(name)) return;
    const updated = [...customCategories, name];
    setCustomCategories(updated);
    localStorage.setItem('mst_custom_categories', JSON.stringify(updated));
    setNewCategoryName('');
    setShowAddCategory(false);
    showMsg('success', `Category "${name}" added`);
  };

  const toggleCourseCollapse = (courseId: string) => {
    setCollapsedCourses(prev => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const handleUpdateMetadata = async () => {
    if (!selected) return;
    try {
      await api.put(`/admin/videos/${selected.id}`, {
        ...editForm,
        course_id: editForm.course_id || null,
      });
      await fetchVideos();
      showMsg('success', 'Metadata updated');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleUpload = async () => {
    if (!selected || !uploadFile) return;
    setUploading(true);
    try {
      await api.upload(`/admin/videos/${selected.id}/upload`, uploadFile);
      setUploadFile(null);
      await fetchVideos();
      markEdited(selected.id);
      refreshOpsLog(selected.id);
      if (autoMode) {
        showMsg('success', 'Video uploaded — queuing auto-processing...');
        await api.post(`/admin/videos/${selected.id}/auto-process`, {});
        startAutoStatusPoll(selected.id);
        showMsg('success', 'Auto-processing started: transcript → metadata → chapters → how-to');
      } else {
        showMsg('success', 'Video uploaded successfully');
      }
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setUploading(false);
    }
  };

  const startAutoStatusPoll = (videoId: string) => {
    if (autoStatusPollRef.current) clearInterval(autoStatusPollRef.current);
    const poll = async () => {
      try {
        const status = await api.get<any>(`/admin/videos/${videoId}/auto-status`);
        setAutoStatus(status);
        const jobs = status.jobs || {};
        const allDone = ['transcript', 'metadata', 'chapters', 'howto'].every(
          k => jobs[k] && ['completed', 'failed', 'cancelled'].includes(jobs[k].status)
        );
        if (allDone && status.transcript_status !== 'processing') {
          if (autoStatusPollRef.current) clearInterval(autoStatusPollRef.current);
          autoStatusPollRef.current = null;
          await fetchVideos();
        }
      } catch { /* ignore */ }
    };
    poll();
    autoStatusPollRef.current = setInterval(poll, 4000);
  };

  const fetchTranscript = async (videoId: string) => {
    setTranscriptLoading(true);
    try {
      const data = await api.get<any>(`/admin/videos/${videoId}/transcript`);
      setTranscriptData(data);
    } catch {
      setTranscriptData(null);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const handleSaveTranscript = async () => {
    if (!selected || !transcriptData) return;
    setTranscriptSaving(true);
    try {
      await api.put(`/admin/videos/${selected.id}/transcript`, transcriptData);
      showMsg('success', 'Transcript saved');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setTranscriptSaving(false);
    }
  };

  const handleRetryAutoJob = async (kind: string) => {
    if (!selected) return;
    try {
      await api.post(`/admin/videos/${selected.id}/auto-process/retry`, { kind });
      startAutoStatusPoll(selected.id);
      showMsg('success', `Retrying ${kind}...`);
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handlePublish = async () => {
    if (!selected) return;
    try {
      await api.post(`/admin/videos/${selected.id}/publish`);
      await fetchVideos();
      showMsg('success', 'Video published');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleUnpublish = async () => {
    if (!selected) return;
    try {
      await api.post(`/admin/videos/${selected.id}/unpublish`);
      await fetchVideos();
      showMsg('success', 'Video unpublished');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDelete = async () => {
    if (!selected || !confirm('Permanently delete this video and all associated data? This cannot be undone.')) return;
    try {
      await api.delete(`/admin/videos/${selected.id}`);
      setSelected(null);
      await fetchVideos();
      showMsg('success', 'Video permanently deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleTranscode = async () => {
    if (!selected) return;
    try {
      await api.post(`/admin/videos/${selected.id}/transcode`);
      await fetchVideos();
      markEdited(selected.id);
      showMsg('success', 'Transcode queued');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleTrim = async () => {
    if (!selected) return;
    if (trimEnd <= trimStart) {
      showMsg('error', 'End time must be after start time');
      return;
    }
    setTrimming(true);
    try {
      await api.post(`/admin/videos/${selected.id}/trim`, {
        start_seconds: trimStart,
        end_seconds: trimEnd,
      });
      await fetchVideos();
      markEdited(selected.id);
      showMsg('success', `Trim started: ${trimStart}s — ${trimEnd}s. Transcode when ready.`);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setTrimming(false);
    }
  };

  const handleCut = async () => {
    if (!selected) return;
    if (trimEnd <= trimStart) {
      showMsg('error', 'End time must be after start time');
      return;
    }
    setTrimming(true);
    try {
      await api.post(`/admin/videos/${selected.id}/cut`, {
        start_seconds: trimStart,
        end_seconds: trimEnd,
      });
      await fetchVideos();
      markEdited(selected.id);
      showMsg('success', `Cut started: removing ${trimStart}s — ${trimEnd}s. Transcode when ready.`);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setTrimming(false);
    }
  };

  const handleSpeedSection = async () => {
    if (!selected) return;
    if (trimEnd <= trimStart) {
      showMsg('error', 'End time must be after start time');
      return;
    }
    setTrimming(true);
    try {
      await api.post(`/admin/videos/${selected.id}/speed-section`, {
        start_seconds: trimStart,
        end_seconds: trimEnd,
        speed_factor: speedFactor,
      });
      await fetchVideos();
      markEdited(selected.id);
      showMsg('success', `Speed-up started: ${trimStart}s — ${trimEnd}s at ${speedFactor}x. Transcode when ready.`);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setTrimming(false);
    }
  };

  const handleTimelineDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging || !timelineRef.current || playerDuration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = Math.round(pct * playerDuration * 10) / 10;
    if (dragging === 'start') {
      setTrimStart(Math.min(t, trimEnd - 0.1));
    } else {
      setTrimEnd(Math.max(t, trimStart + 0.1));
    }
  };

  const handleAddChapter = async () => {
    if (!selected || !newChapter.title) return;
    try {
      await api.post(`/admin/videos/${selected.id}/chapters`, {
        title: newChapter.title,
        start_time: newChapter.start_time,
        sort_order: chapters.length,
      });
      setNewChapter({ title: '', start_time: 0 });
      const chaps = await api.get<Chapter[]>(`/admin/videos/${selected.id}/chapters`);
      setChapters(chaps);
      showMsg('success', 'Chapter added');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleEditChapterStart = (ch: Chapter) => {
    setEditingChapterId(ch.id);
    setEditChapterForm({ title: ch.title, start_time: ch.start_time });
  };

  const handleEditChapterSave = async () => {
    if (!editingChapterId || !editChapterForm.title) return;
    try {
      await api.put(`/admin/chapters/${editingChapterId}`, editChapterForm);
      setChapters((prev) => prev.map((c) => c.id === editingChapterId ? { ...c, ...editChapterForm } : c));
      setEditingChapterId(null);
      showMsg('success', 'Chapter updated');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    try {
      await api.delete(`/admin/chapters/${chapterId}`);
      setChapters((prev) => prev.filter((c) => c.id !== chapterId));
      showMsg('success', 'Chapter deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSaveHowto = async () => {
    if (!selected) return;
    try {
      await api.put(`/admin/videos/${selected.id}/howto`, {
        title: howtoTitle,
        content: howtoContent,
      });
      showMsg('success', 'How-to guide saved');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSaveQuality = async () => {
    if (!selected) return;
    try {
      await api.put(`/admin/videos/${selected.id}/quality`, { qualities: qualitySettings });
      showMsg('success', 'Quality settings saved');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleAddSeedNote = async () => {
    if (!selected || !newSeedNote.content) return;
    try {
      await api.post(`/admin/videos/${selected.id}/seed-notes`, newSeedNote);
      setNewSeedNote({ timestamp_s: 0, content: '' });
      const notes = await api.get<SeedNote[]>(`/admin/videos/${selected.id}/seed-notes`);
      setSeedNotes(notes);
      showMsg('success', 'Seed note added');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteSeedNote = async (noteId: string) => {
    try {
      await api.delete(`/admin/seed-notes/${noteId}`);
      setSeedNotes((prev) => prev.filter((n) => n.id !== noteId));
      showMsg('success', 'Seed note deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  // ── Banner Handlers ─────────────────────────────────────

  const handleSaveBanner = async () => {
    if (!selected) return;
    try {
      const result = await api.put<BannerConfig>(`/admin/videos/${selected.id}/banner`, bannerForm);
      setBannerConfig(result);
      showMsg('success', 'Banner config saved');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleGenerateBanner = async () => {
    if (!selected) return;
    try {
      // Save first
      await api.put(`/admin/videos/${selected.id}/banner`, bannerForm);
      // Then generate
      await api.post(`/admin/videos/${selected.id}/banner/generate`);
      setBannerGenerating(true);
      showMsg('success', 'Banner generation started...');

      // Poll for status
      if (bannerPollRef.current) clearInterval(bannerPollRef.current);
      bannerPollRef.current = setInterval(async () => {
        try {
          const b = await api.get<BannerConfig | null>(`/admin/videos/${selected.id}/banner`);
          if (b && b.status !== 'generating') {
            setBannerGenerating(false);
            setBannerConfig(b);
            if (bannerPollRef.current) clearInterval(bannerPollRef.current);
            if (b.status === 'ready') {
              showMsg('success', 'Banner generated & prepended to video! Transcode when ready.');
              markEdited(selected.id);
              refreshOpsLog(selected.id);
              fetchVideos();
            } else if (b.status === 'error') {
              showMsg('error', `Banner generation failed: ${b.error || 'Unknown error'}`);
            }
          }
        } catch { /* ignore */ }
      }, 3000);
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  // Cleanup polls on unmount
  useEffect(() => {
    return () => {
      if (bannerPollRef.current) clearInterval(bannerPollRef.current);
      if (processingPollRef.current) clearInterval(processingPollRef.current);
      if (autoStatusPollRef.current) clearInterval(autoStatusPollRef.current);
    };
  }, []);

  // Poll when processing; auto-reload player when status changes
  useEffect(() => {
    const status = selected?.status ?? null;
    if (prevStatusRef.current === 'processing' && status !== 'processing') {
      setPlayerKey(k => k + 1);
      if (selected?.id) refreshOpsLog(selected.id);
    }
    prevStatusRef.current = status;

    if (processingPollRef.current) {
      clearInterval(processingPollRef.current);
      processingPollRef.current = null;
    }
    if (status === 'processing') {
      processingPollRef.current = setInterval(() => { fetchVideos(); }, 3000);
    }
    return () => {
      if (processingPollRef.current) {
        clearInterval(processingPollRef.current);
        processingPollRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.status, selected?.id]);

  const handleReloadPlayer = async () => {
    await fetchVideos();
    setPlayerKey(k => k + 1);
  };

  const handleCancelJob = async () => {
    if (!selected) return;
    try {
      await api.post(`/admin/videos/${selected.id}/cancel-job`);
      await fetchVideos();
      showMsg('success', 'Job cancelled');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleOpenCleanup = async () => {
    if (!selected) return;
    try {
      const info = await api.get<{ files: any[]; hls_size: number; thumb_size: number }>(`/admin/videos/${selected.id}/storage-info`);
      setStorageInfo(info);
      setShowCleanup(true);
    } catch (err: any) {
      showMsg('error', 'Failed to load storage info: ' + err.message);
    }
  };

  const handleCleanup = async () => {
    if (!selected) return;
    setCleaningUp(true);
    try {
      const result = await api.post<{ deleted: string[]; freed_bytes: number }>(`/admin/videos/${selected.id}/cleanup`);
      const mb = (result.freed_bytes / 1024 / 1024).toFixed(1);
      showMsg('success', `Cleaned up ${result.deleted.length} file(s), freed ${mb} MB`);
      setShowCleanup(false);
      setStorageInfo(null);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setCleaningUp(false);
    }
  };

  const fmtBytes = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;

  const bannerPreviewHtml = `
    <!DOCTYPE html><html><head>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=Space+Grotesk:wght@600;700&display=swap');
      *{margin:0;padding:0;box-sizing:border-box;}
      html,body{width:100%;height:100%;overflow:hidden;font-family:'DM Sans',sans-serif;background:#1e293b;}
      #wrap{width:1920px;height:1080px;transform-origin:top left;overflow:hidden;}
      .banner{width:1920px;height:1080px;background:#fff;position:relative;display:flex;align-items:center;justify-content:center;}
      .samsung-text-lbl{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:0.36em;color:#1428A0;font-size:36px;text-transform:uppercase;}
      .icon-entrance{animation:iconPop .55s cubic-bezier(.22,1,.36,1) both;animation-delay:.25s;}
      @keyframes iconPop{from{opacity:0;transform:scale(0.65) rotate(-12deg)}to{opacity:1;transform:scale(1) rotate(0)}}
      .ring-pulse{transform-box:fill-box;transform-origin:center;animation:ringPulse 2.2s ease-in-out infinite;}
      @keyframes ringPulse{0%{opacity:.5;transform:scale(1)}55%{opacity:0;transform:scale(1.25)}100%{opacity:.5;transform:scale(1)}}
      .bar1{stroke-dasharray:26;stroke-dashoffset:26;animation:drawBar .38s ease .5s forwards;}
      .bar2{stroke-dasharray:26;stroke-dashoffset:26;animation:drawBar .38s ease .56s forwards;}
      @keyframes drawBar{to{stroke-dashoffset:0}}
      .dot-pop{opacity:0;transform-box:fill-box;transform-origin:center;animation:dotPop .25s cubic-bezier(.22,1,.36,1) .82s forwards;}
      @keyframes dotPop{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
      .tri-fade{opacity:0;animation:triFade .28s ease .88s forwards;}
      @keyframes triFade{to{opacity:1}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      @keyframes growV{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}
      @keyframes barUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes slideRight{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}
      @keyframes fadeInScale{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}
      .va .corner{position:absolute;width:120px;height:120px;}
      .va .corner.tl{top:0;left:0;border-top:4px solid #0a2a5e;border-left:4px solid #0a2a5e;}
      .va .corner.br{bottom:0;right:0;border-bottom:4px solid #0a2a5e;border-right:4px solid #0a2a5e;}
      .va .hline{position:absolute;width:100%;height:1px;background:linear-gradient(90deg,transparent,#0a2a5e28,#0a2a5e48,#0a2a5e28,transparent);}
      .va .hline.t{top:18%}.va .hline.b{bottom:20%}
      .va .samsung-top{position:absolute;top:8%;left:0;right:0;display:flex;justify-content:center;animation:fadeInScale .45s ease both;animation-delay:.05s;}
      .va .center{display:flex;align-items:center;gap:50px;animation:fadeUp .65s cubic-bezier(.22,1,.36,1) both;animation-delay:.15s;}
      .va .vdiv{width:3px;height:160px;background:linear-gradient(180deg,transparent,#0a2a5e55,transparent);animation:growV .45s ease both;animation-delay:.35s;}
      .va .brand{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:120px;letter-spacing:-0.03em;color:#0a2a5e;line-height:1;}
      .va .brand span{color:#e35a1a;}
      .va .stag{font-weight:300;font-size:28px;letter-spacing:0.22em;color:#6b7a99;text-transform:uppercase;margin-top:8px;}
      .va .btm{position:absolute;bottom:0;left:0;right:0;background:#0a2a5e;display:flex;align-items:center;justify-content:space-between;padding:24px 60px;animation:barUp .5s cubic-bezier(.22,1,.36,1) both;animation-delay:.55s;}
      .va .bleft{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;}
      .va .topic{font-family:'Space Grotesk',sans-serif;font-weight:600;color:#fff;font-size:36px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .va .sub{font-weight:300;color:#8aadd6;font-size:26px;}
      .va .bmid{display:flex;align-items:center;gap:24px;flex-shrink:0;}
      .va .pill{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:30px;padding:8px 22px;font-size:26px;color:#b8cee8;white-space:nowrap;}
      .va .pill.ep{background:rgba(227,90,26,0.3);border-color:rgba(227,90,26,0.45);color:#f8a87a;}
      .va .bright{display:flex;align-items:center;gap:16px;flex-shrink:0;margin-left:30px;}
      .va .avatar{width:60px;height:60px;border-radius:50%;background:#e35a1a;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:28px;color:#fff;}
      .va .pname{font-size:26px;color:#b8cee8;}
      .vb .lpanel{position:absolute;top:0;left:0;bottom:0;width:36%;background:#0a2a5e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:40px;animation:slideRight .6s cubic-bezier(.22,1,.36,1) both;animation-delay:.1s;}
      .vb .samsung-lbl{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:0.2em;color:#fff;font-size:28px;text-transform:uppercase;opacity:.6;}
      .vb .brand-vb{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:80px;letter-spacing:-0.03em;color:#fff;line-height:1;text-align:center;}
      .vb .brand-vb span{color:#e35a1a;}
      .vb .stag-vb{font-weight:300;font-size:22px;letter-spacing:0.2em;color:rgba(255,255,255,0.4);text-transform:uppercase;}
      .vb .rpanel{position:absolute;top:0;left:36%;right:0;bottom:0;display:flex;flex-direction:column;justify-content:center;padding:80px;gap:24px;animation:fadeUp .65s cubic-bezier(.22,1,.36,1) both;animation-delay:.35s;}
      .vb .epbadge{background:#e35a1a;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:28px;padding:8px 22px;border-radius:6px;}
      .vb .durbadge{background:#f0f3fa;color:#0a2a5e;font-size:26px;padding:8px 22px;border-radius:6px;border:1px solid #d0d8ee;}
      .vb .topic-vb{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:64px;color:#0a2a5e;line-height:1.15;}
      .vb .divh{width:70px;height:4px;background:#e35a1a;border-radius:2px;}
      .vb .sub-vb{font-weight:400;font-size:32px;color:#6b7a99;}
      .vb .av-vb{width:60px;height:60px;border-radius:50%;background:#0a2a5e;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:28px;color:#fff;}
      .vb .pn-vb{font-size:28px;color:#0a2a5e;font-weight:500;}
      .vb .pd-vb{font-size:22px;color:#9aa;}
      .vc .stripe-top{position:absolute;top:0;left:0;right:0;height:8px;background:linear-gradient(90deg,#0a2a5e,#1a52b0,#e35a1a);}
      .vc .stripe-bot{position:absolute;bottom:0;left:0;right:0;height:5px;background:#0a2a5e;}
      .vc .samsung-vc{position:absolute;top:10%;left:0;right:0;display:flex;justify-content:center;animation:fadeInScale .45s ease both;}
      .vc .cblock{display:flex;flex-direction:column;align-items:center;gap:32px;animation:fadeUp .65s cubic-bezier(.22,1,.36,1) both;animation-delay:.15s;}
      .vc .logo-row{display:flex;align-items:center;gap:36px;}
      .vc .brand-vc{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:110px;letter-spacing:-0.03em;color:#0a2a5e;line-height:1;}
      .vc .brand-vc span{color:#e35a1a;}
      .vc .topic-vc{font-weight:500;font-size:48px;color:#0a2a5e;text-align:center;}
      .vc .sub-vc{font-weight:300;font-size:30px;color:#8090a8;text-align:center;}
      .vc .meta-row{display:flex;align-items:center;gap:36px;}
      .vc .mdot{width:8px;height:8px;border-radius:50%;background:#e35a1a;}
      .vc .mi{font-size:26px;color:#6b7a99;letter-spacing:0.06em;}
      .vc .mi.bold{font-weight:600;color:#0a2a5e;}
    </style></head><body>
    <div id="wrap"><div id="root"></div></div>
    <script>
      // Scale the 1920x1080 canvas to fit the iframe
      function scaleWrap(){
        var w=document.getElementById('wrap');
        var s=Math.min(window.innerWidth/1920,window.innerHeight/1080);
        w.style.transform='scale('+s+')';
      }
      scaleWrap();
      window.addEventListener('resize',scaleWrap);

      const P = ${JSON.stringify(bannerForm)};
      const V = P.variant;
      const bWords = (P.brand_title || 'AI Ignite').trim().split(' ');
      const b1 = bWords[0] || '';
      const b2 = bWords.slice(1).join(' ');
      const formattedBrand = b2 ? b1 + ' <span>' + b2 + '</span>' : b1;

      let html = '';
      const logo = '<svg width="160" height="160" viewBox="0 0 72 72"><circle cx="36" cy="36" r="34" fill="'+(V==='B'?'rgba(255,255,255,0.08)':'#0d2d6b')+'"/><circle cx="36" cy="36" r="34" fill="none" stroke="'+(V==='B'?'rgba(255,255,255,0.2)':'#1e4282')+'" stroke-width="2"/><circle class="ring-pulse" cx="36" cy="36" r="34" fill="none" stroke="#e05018" stroke-width="1.5" opacity=".5"/><line class="bar1" x1="24.5" y1="23" x2="24.5" y2="49" stroke="#c03010" stroke-width="5" stroke-linecap="round"/><line class="bar2" x1="24.5" y1="23" x2="24.5" y2="49" stroke="#e85520" stroke-width="2.5" stroke-linecap="round"/><circle class="dot-pop" cx="24.5" cy="36" r="4.5" fill="#e06030"/><circle class="dot-pop" cx="24.5" cy="36" r="3" fill="#f07840" style="animation-delay:.84s"/><polygon class="tri-fade" points="28,23 50,36 28,49" fill="white"/></svg>';
      if(V==='A'){
        html='<div class="banner va"><div class="corner tl"></div><div class="corner br"></div><div class="hline t"></div><div class="hline b"></div><div class="samsung-top"><span class="samsung-text-lbl">'+P.company_logo+'</span></div><div class="center"><div class="icon-entrance">'+logo+'</div><div class="vdiv"></div><div><div class="brand">'+formattedBrand+'</div><div class="stag">'+P.series_tag+'</div></div></div><div class="btm"><div class="bleft"><div class="topic">'+P.topic+'</div><div class="sub">'+P.subtopic+'</div></div><div class="bmid"><div class="pill ep">'+P.episode+'</div><div class="pill">'+P.duration+'</div></div><div class="bright"><div class="avatar">'+P.presenter_initial+'</div><div class="pname">'+P.presenter+'</div></div></div></div>';
      } else if(V==='B'){
        html='<div class="banner vb"><div class="lpanel"><span class="samsung-lbl">'+P.company_logo+'</span><div class="icon-entrance">'+logo+'</div><div class="brand-vb">'+formattedBrand+'</div><div class="stag-vb">'+P.series_tag+'</div></div><div class="rpanel"><div style="display:flex;gap:16px;align-items:center"><div class="epbadge">'+P.episode+'</div><div class="durbadge">'+P.duration+'</div></div><div class="topic-vb">'+P.topic+'</div><div class="divh"></div><div class="sub-vb">'+P.subtopic+'</div><div style="display:flex;align-items:center;gap:20px;margin-top:8px"><div class="av-vb">'+P.presenter_initial+'</div><div><div class="pn-vb">'+P.presenter+'</div><div class="pd-vb">Presenter</div></div></div></div></div>';
      } else {
        html='<div class="banner vc"><div class="stripe-top"></div><div class="stripe-bot"></div><div class="samsung-vc"><span class="samsung-text-lbl">'+P.company_logo+'</span></div><div class="cblock"><div class="logo-row"><div class="icon-entrance">'+logo+'</div><div class="brand-vc">'+formattedBrand+'</div></div><div class="topic-vc">'+P.topic+'</div><div class="sub-vc">'+P.subtopic+'</div><div class="meta-row"><span class="mi bold">'+P.episode+'</span><div class="mdot"></div><span class="mi">'+P.duration+'</span><div class="mdot"></div><span class="mi">'+P.presenter+'</span><div class="mdot"></div><span class="mi">'+P.series_tag+'</span></div></div></div>';
      }
      document.getElementById('root').innerHTML=html;
    <\/script></body></html>
  `;

  // ── Helpers ───────────────────────────────────────────

  const statusBadge = (v: Video) => {
    if (!v.is_active) return <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>;
    if (v.is_published) return <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/20 text-green-400 border border-green-500/30">Published</span>;
    if (v.status === 'ready') return <span className="px-2 py-0.5 text-[10px] rounded bg-primary/20 text-primary border border-primary/30">Ready</span>;
    if (v.status === 'uploaded') return <span className="px-2 py-0.5 text-[10px] rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">Uploaded</span>;
    if (v.status === 'processing') return <span className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">Processing</span>;
    if (v.status === 'error') return <span className="px-2 py-0.5 text-[10px] rounded bg-red-500/20 text-red-400 border border-red-500/30">Error</span>;
    return <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Draft</span>;
  };

  const filteredVideos = videos.filter((v) =>
    v.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDuration = (s: number | null) => {
    if (!s) return '--:--';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Group videos by course for sidebar
  const groupedVideos = (() => {
    const groups: { course: Course | null; videos: Video[] }[] = [];
    const courseMap = new Map<string, Video[]>();
    const uncategorized: Video[] = [];
    for (const v of filteredVideos) {
      if (v.course_id) {
        if (!courseMap.has(v.course_id)) courseMap.set(v.course_id, []);
        courseMap.get(v.course_id)!.push(v);
      } else {
        uncategorized.push(v);
      }
    }
    for (const c of courses) {
      const vids = courseMap.get(c.id);
      if (vids && vids.length > 0) {
        groups.push({ course: c, videos: vids });
      }
    }
    if (uncategorized.length > 0) {
      groups.push({ course: null, videos: uncategorized });
    }
    return groups;
  })();

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading videos...</div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] font-sans">
      {/* Toast Message */}
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success'
            ? 'bg-green-500/10 text-green-400 border-green-500/30'
            : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      {/* Course Creation Popup Modal */}
      {showCourseCreate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">library_add</span>
                Add New Course
              </h3>
              <button onClick={() => setShowCourseCreate(false)} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Course Title *</label>
              <input
                value={courseForm.title}
                onChange={(e) => setCourseForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Introduction to AI Agents"
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Slug</label>
              <input
                value={courseForm.slug}
                onChange={(e) => setCourseForm(f => ({ ...f, slug: e.target.value }))}
                placeholder="auto-generated from title if empty"
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
              <textarea
                value={courseForm.description}
                onChange={(e) => setCourseForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="Brief description of this course..."
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={handleCreateCourse} className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                Create Course
              </button>
              <button onClick={() => setShowCourseCreate(false)} className="px-6 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Category Popup Modal */}
      {showAddCategory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">category</span>
                Add New Category
              </h3>
              <button onClick={() => setShowAddCategory(false)} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Category Name *</label>
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Fine-tuning"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] text-slate-500 w-full mb-1">Existing categories:</span>
              {allCategories.map(c => (
                <span key={c} className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">{c}</span>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={handleAddCategory} className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                Add Category
              </button>
              <button onClick={() => setShowAddCategory(false)} className="px-6 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cleanup Modal */}
      {showCleanup && storageInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400">cleaning_services</span>
                Storage Cleanup
              </h3>
              <button onClick={() => setShowCleanup(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Raw Files</p>
              {storageInfo.files.map((f) => (
                <div key={f.name} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                  f.is_intermediate ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/5'
                }`}>
                  <span className={`material-symbols-outlined text-sm ${f.is_intermediate ? 'text-amber-400' : f.is_primary ? 'text-green-400' : 'text-slate-400'}`}>
                    {f.is_primary ? 'check_circle' : f.is_intermediate ? 'warning' : 'draft'}
                  </span>
                  <span className={`flex-1 font-mono ${f.is_intermediate ? 'text-amber-300' : 'text-slate-700 dark:text-slate-300'}`}>{f.name}</span>
                  <span className="text-slate-500">{fmtBytes(f.size)}</span>
                  {f.is_intermediate && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">Backup</span>}
                  {f.is_primary && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-bold">Active</span>}
                </div>
              ))}
              {storageInfo.hls_size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/5">
                  <span className="material-symbols-outlined text-sm text-primary">video_library</span>
                  <span className="flex-1 text-slate-700 dark:text-slate-300">HLS streams/</span>
                  <span className="text-slate-500">{fmtBytes(storageInfo.hls_size)}</span>
                </div>
              )}
              {storageInfo.thumb_size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/5">
                  <span className="material-symbols-outlined text-sm text-slate-400">image</span>
                  <span className="flex-1 text-slate-700 dark:text-slate-300">thumb.jpg</span>
                  <span className="text-slate-500">{fmtBytes(storageInfo.thumb_size)}</span>
                </div>
              )}
            </div>

            {storageInfo.files.some(f => f.is_intermediate) ? (
              <div className="pt-2 border-t border-slate-200 dark:border-white/5">
                <p className="text-xs text-slate-500 mb-3">
                  Will delete {storageInfo.files.filter(f => f.is_intermediate).length} backup file(s) — freeing&nbsp;
                  <strong className="text-amber-400">{fmtBytes(storageInfo.files.filter(f => f.is_intermediate).reduce((s, f) => s + f.size, 0))}</strong>.
                  The active <code className="text-green-400">original.mp4</code> and HLS streams are untouched.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleCleanup}
                    disabled={cleaningUp}
                    className="flex items-center gap-1.5 px-5 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-sm font-bold rounded-lg transition-colors border border-amber-500/20 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">cleaning_services</span>
                    {cleaningUp ? 'Cleaning...' : 'Delete Backups'}
                  </button>
                  <button onClick={() => setShowCleanup(false)} className="px-5 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-2 border-t border-slate-200 dark:border-white/5">
                No backup files to clean up. Storage is already lean.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Left Panel — Video List grouped by course */}
      <aside className="w-80 border-r border-slate-200 dark:border-white/10 bg-sidebar-light dark:bg-sidebar-dark flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200 dark:border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Videos</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowCourseCreate(true)}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                title="Add new course"
              >
                <span className="material-symbols-outlined text-sm">library_add</span>
              </button>
              <button
                onClick={() => setShowAddCategory(true)}
                className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                title="Add new category"
              >
                <span className="material-symbols-outlined text-sm">category</span>
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1 text-xs text-primary hover:text-white transition-colors"
                title="Add new video"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                New
              </button>
            </div>
          </div>
          <input
            type="text"
            placeholder="Search videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:border-primary outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {groupedVideos.map((group) => {
            const courseId = group.course?.id || '__uncategorized__';
            const isCollapsed = collapsedCourses.has(courseId);
            return (
              <div key={courseId}>
                {/* Course header with expand/collapse */}
                <button
                  onClick={() => toggleCourseCollapse(courseId)}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className={`material-symbols-outlined text-sm text-slate-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
                    chevron_right
                  </span>
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex-1 text-left truncate">
                    {group.course?.title || 'Uncategorized'}
                  </span>
                  <span className="text-[10px] text-slate-400 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
                    {group.videos.length}
                  </span>
                </button>
                {/* Videos in this course */}
                {!isCollapsed && group.videos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => selectVideo(v)}
                    className={`w-full text-left p-4 border-b border-slate-100 dark:border-white/5 transition-colors ${
                      selected?.id === v.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-1.5">
                        {v.id === lastEditedId && (
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary" title="Last edited" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{v.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{v.category} · {formatDuration(v.duration_s)}</p>
                        </div>
                      </div>
                      {statusBadge(v)}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
          {filteredVideos.length === 0 && (
            <p className="text-center text-slate-500 text-sm p-6">No videos found</p>
          )}
        </div>
      </aside>

      {/* Right Panel — Detail / Create */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        {showCreate ? (
          <div className="max-w-2xl">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Create New Video</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Title</label>
                  <input
                    value={createForm.title}
                    onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Slug</label>
                  <input
                    value={createForm.slug}
                    onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
                    placeholder="setup-and-usage"
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
                  <select
                    value={createForm.category}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { setShowAddCategory(true); return; }
                      setCreateForm((f) => ({ ...f, category: e.target.value }));
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                  >
                    {allCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="__new__">+ Add New Category...</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Course</label>
                  <select
                    value={createForm.course_id}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { setShowCourseCreate(true); return; }
                      setCreateForm((f) => ({ ...f, course_id: e.target.value }));
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                  >
                    <option value="">None</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                    <option value="__new__">+ Add New Course...</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleCreate} className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  Create Video
                </button>
                <button onClick={() => setShowCreate(false)} className="px-6 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : selected ? (
          <div className="flex gap-6 h-full">
            {/* Left Column — Video Player (sticky) */}
            <div className="w-[45%] shrink-0 flex flex-col">
            {/* Video File Section */}
            <div className="p-4 rounded-xl bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/5 sticky top-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Video File</h3>
                <div className="flex items-center gap-1">
                  <button onClick={handleOpenCleanup} title="Cleanup backup files" className="p-1 rounded hover:bg-amber-500/10 text-slate-400 hover:text-amber-400 transition-colors">
                    <span className="material-symbols-outlined text-sm">cleaning_services</span>
                  </button>
                  <button onClick={handleReloadPlayer} title="Reload player" className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <span className="material-symbols-outlined text-sm">refresh</span>
                  </button>
                </div>
              </div>
              {selected.status === 'processing' && (
                <div className="flex flex-col items-center justify-center py-4 gap-2">
                  <svg className="w-12 h-12" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-700" />
                    <circle
                      cx="22" cy="22" r="18" fill="none"
                      stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                      strokeDasharray="56 57" className="text-primary animate-spin"
                      style={{ transformOrigin: '22px 22px' }}
                    />
                  </svg>
                  <p className="text-xs text-slate-400">Transcoding…</p>
                  <button onClick={handleCancelJob} className="mt-1 flex items-center gap-1 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors">
                    <span className="material-symbols-outlined text-xs">cancel</span>
                    Cancel
                  </button>
                </div>
              )}
              {selected.hls_path ? (
                <div>
                  <HlsPlayer
                    key={playerKey}
                    ref={playerRef}
                    hlsPath={selected.hls_path}
                    chapters={chapters}
                    captionsUrl={transcriptData?.segments?.length ? `${API_BASE}/video/videos/${selected.id}/captions.vtt` : undefined}
                    onTimeUpdate={(t, d) => { setPlayerTime(t); setPlayerDuration(d); }}
                    className="rounded-xl border border-white/10"
                  />
                  <div className="flex items-center justify-between mt-2 px-1">
                    <span className="font-mono text-[10px] text-slate-500">0:00</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      Current: {formatDuration(Math.floor(playerTime))}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">{formatDuration(Math.floor(playerDuration))}</span>
                  </div>
                </div>
              ) : selected.status !== 'draft' && selected.status !== 'processing' ? (
                <div>
                  <video
                    key={`${selected.id}-${playerKey}`}
                    ref={rawVideoRef}
                    src={`${API_BASE}/streams/${selected.id}/raw/original.mp4?_t=${playerKey}`}
                    controls
                    className="w-full rounded-xl border border-white/10 bg-black"
                    onTimeUpdate={(e) => setPlayerTime((e.target as HTMLVideoElement).currentTime)}
                    onLoadedMetadata={(e) => setPlayerDuration((e.target as HTMLVideoElement).duration)}
                  />
                  <div className="flex items-center justify-between mt-2 px-1">
                    <span className="font-mono text-[10px] text-slate-500">0:00</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      Current: {formatDuration(Math.floor(playerTime))}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">{formatDuration(Math.floor(playerDuration))}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-white/10 hover:border-primary/50 cursor-pointer transition-colors">
                      <span className="material-symbols-outlined text-slate-500 text-sm">cloud_upload</span>
                      <span className="text-xs text-slate-400">{uploadFile ? uploadFile.name : 'Choose video'}</span>
                      <input type="file" accept="video/*" className="hidden" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                    </label>
                    {uploadFile && (
                      <button onClick={handleUpload} disabled={uploading} className="px-4 py-2 bg-primary hover:bg-blue-500 disabled:opacity-30 text-white text-xs font-bold rounded-lg transition-colors">
                        {uploading ? 'Uploading...' : 'Upload'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Auto Mode toggle */}
                  <label className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/20 cursor-pointer hover:bg-primary/10 transition-colors">
                    <input
                      type="checkbox"
                      checked={autoMode}
                      onChange={(e) => setAutoMode(e.target.checked)}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="material-symbols-outlined text-primary text-sm">auto_awesome</span>
                    <div>
                      <span className="text-sm font-bold text-white">Auto Mode</span>
                      <span className="text-xs text-slate-400 ml-2">— transcribe + auto-generate metadata, chapters &amp; how-to guide</span>
                    </div>
                  </label>
                  <div className="flex items-center gap-4">
                    <label className="flex-1 flex items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-slate-300 dark:border-white/10 hover:border-primary/50 cursor-pointer transition-colors">
                      <span className="material-symbols-outlined text-slate-500">cloud_upload</span>
                      <span className="text-sm text-slate-400">{uploadFile ? uploadFile.name : 'Choose video file or drag & drop'}</span>
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <button
                      onClick={handleUpload}
                      disabled={!uploadFile || uploading}
                      className="px-6 py-3 bg-primary hover:bg-blue-500 disabled:opacity-30 text-white text-sm font-bold rounded-lg transition-colors"
                    >
                      {uploading ? 'Uploading...' : 'Upload'}
                    </button>
                  </div>
                </div>
              )}
              {selected.job_status === 'failed' && (
                <div className="mt-3 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                  <span className="font-bold">Last job failed</span>
                  {selected.job_error && <span className="ml-1 opacity-80">— {selected.job_error}</span>}
                </div>
              )}
              {/* Auto-processing pipeline progress — shown whenever jobs are active */}
              {autoStatus && (() => {
                const STAGES = ['transcript', 'metadata', 'chapters', 'howto'] as const;
                const hasAny = STAGES.some(k => autoStatus.jobs?.[k]);
                const allDone = hasAny && STAGES.every(k => autoStatus.jobs?.[k]?.status === 'completed');
                const hasFailed = STAGES.some(k => autoStatus.jobs?.[k]?.status === 'failed');
                if (!hasAny) return null;
                return (
                  <div className="mt-3 p-3 rounded-lg bg-slate-800/50 border border-white/8">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-primary">auto_awesome</span>
                        Auto-Processing Pipeline
                      </p>
                      {allDone && <span className="text-[10px] font-bold text-green-400">All done — check Transcript tab</span>}
                      {hasFailed && !allDone && <span className="text-[10px] font-bold text-red-400">Some steps failed — see Transcript tab</span>}
                      {!allDone && !hasFailed && <span className="text-[10px] text-amber-400 flex items-center gap-1"><span className="material-symbols-outlined text-xs animate-spin">autorenew</span>Running…</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      {STAGES.map((kind, i) => {
                        const job = autoStatus.jobs?.[kind];
                        const done = job?.status === 'completed';
                        const failed = job?.status === 'failed';
                        const running = job?.status === 'processing' || job?.status === 'pending';
                        return (
                          <React.Fragment key={kind}>
                            <div className={`flex-1 flex flex-col items-center gap-0.5`}>
                              <div className={`w-full h-1.5 rounded-full ${done ? 'bg-green-500' : failed ? 'bg-red-500' : running ? 'bg-amber-400 animate-pulse' : 'bg-slate-700'}`} />
                              <span className={`text-[9px] font-bold capitalize ${done ? 'text-green-400' : failed ? 'text-red-400' : running ? 'text-amber-400' : 'text-slate-600'}`}>{kind}</span>
                            </div>
                            {i < STAGES.length - 1 && <span className="text-slate-700 text-xs mb-3">›</span>}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {opsLog.length > 0 && (
                <div className="mt-3 border-t border-slate-200 dark:border-white/5 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Operations</p>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {[...opsLog].reverse().map((entry, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${
                          entry.op === 'transcode' ? 'bg-green-500/15 text-green-400' :
                          entry.op === 'banner' ? 'bg-purple-500/15 text-purple-400' :
                          entry.op === 'trim' ? 'bg-blue-500/15 text-blue-400' :
                          entry.op === 'cut' ? 'bg-orange-500/15 text-orange-400' :
                          'bg-slate-500/15 text-slate-400'
                        }`}>{entry.op}</span>
                        <span className="text-slate-500">{entry.file}</span>
                        <span className="text-slate-600 ml-auto">{new Date(entry.ts).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>

            {/* Right Panel — Tabs + Content */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between mb-4 shrink-0">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selected.title}</h2>
                  {statusBadge(selected)}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{selected.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                {selected.is_published ? (
                  <button onClick={handleUnpublish} className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs rounded-lg transition-colors border border-amber-500/20">
                    <span className="material-symbols-outlined text-sm">visibility_off</span>
                    Unpublish
                  </button>
                ) : (
                  <button onClick={handlePublish} className="flex items-center gap-1.5 px-3 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs rounded-lg transition-colors border border-green-500/20">
                    <span className="material-symbols-outlined text-sm">publish</span>
                    Publish
                  </button>
                )}
                {selected.status === 'processing' ? (
                  <button onClick={handleCancelJob} className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg transition-colors border border-red-500/20">
                    <span className="material-symbols-outlined text-sm">cancel</span>
                    Cancel Job
                  </button>
                ) : (
                  <button onClick={handleTranscode} className="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs rounded-lg transition-colors border border-slate-300 dark:border-white/10">
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    Transcode
                  </button>
                )}
                <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg transition-colors border border-red-500/20">
                  <span className="material-symbols-outlined text-sm">delete</span>
                  Delete
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/10 mb-4 shrink-0">
              {(['metadata', 'banner', 'trim', 'chapters', 'howto', 'transcript', 'quality', 'seed-notes', 'attachments', 'email'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    if (tab === 'transcript' && selected) fetchTranscript(selected.id);
                  }}
                  className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-all capitalize ${
                    activeTab === tab
                      ? 'text-white border-primary bg-primary/5'
                      : 'text-slate-400 hover:text-white border-transparent'
                  }`}
                >
                  {tab === 'seed-notes' ? 'Seed Notes' : tab === 'howto' ? 'How-To' : tab === 'transcript' ? '🎙 Transcript' : tab === 'banner' ? '🎬 Banner' : tab === 'trim' ? '✂️ Trim' : tab === 'attachments' ? 'Attachments' : tab === 'email' ? '📧 Email' : tab}
                </button>
              ))}
            </div>

            {/* Tab Content — scrollable */}
            <div className="flex-1 overflow-y-auto pr-2">

            {/* Tab Content */}
            {activeTab === 'metadata' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Title</label>
                    <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
                    <select value={editForm.category} onChange={(e) => {
                      if (e.target.value === '__new__') { setShowAddCategory(true); return; }
                      setEditForm((f) => ({ ...f, category: e.target.value }));
                    }}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                      {allCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="__new__">+ Add New Category...</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Description</label>
                    <button
                      onClick={() => handleBeautify('meta-desc', editForm.description, (v) => setEditForm((f) => ({ ...f, description: v })))}
                      disabled={beautifying === 'meta-desc' || !editForm.description.trim()}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded transition-colors disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>{beautifying === 'meta-desc' ? 'autorenew' : 'auto_fix_high'}</span>
                      {beautifying === 'meta-desc' ? 'Beautifying…' : 'Beautify'}
                    </button>
                  </div>
                  <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Course</label>
                    <select value={editForm.course_id} onChange={(e) => {
                      if (e.target.value === '__new__') { setShowCourseCreate(true); return; }
                      setEditForm((f) => ({ ...f, course_id: e.target.value }));
                    }}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                      <option value="">None</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                      <option value="__new__">+ Add New Course...</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Sort Order</label>
                    <input type="number" value={editForm.sort_order} onChange={(e) => setEditForm((f) => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                  </div>
                </div>
                <button onClick={handleUpdateMetadata} className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  Save Metadata
                </button>
              </div>
            )}

            {activeTab === 'chapters' && (
              <div className="space-y-5">
                {/* Timeline with chapter markers */}
                {selected.hls_path && playerDuration > 0 && (
                  <div className="px-1">
                    <div className="relative w-full h-8 bg-slate-800/50 rounded-lg border border-white/5 overflow-hidden">
                      {/* Playhead position */}
                      {playerDuration > 0 && (
                        <div
                          className="absolute top-0 h-full w-0.5 bg-white/60 z-10"
                          style={{ left: `${(playerTime / playerDuration) * 100}%` }}
                        />
                      )}
                      {/* Chapter markers on timeline */}
                      {chapters.map((ch) => {
                        const pct = playerDuration > 0 ? (ch.start_time / playerDuration) * 100 : 0;
                        return (
                          <button
                            key={ch.id}
                            className="absolute top-0 h-full group/marker"
                            style={{ left: `${pct}%` }}
                            onClick={() => playerRef.current?.seekTo(ch.start_time)}
                            title={`${ch.title} (${formatDuration(ch.start_time)})`}
                          >
                            <div className="w-1 h-full bg-amber-400/80 group-hover/marker:bg-amber-300" />
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-slate-900 border border-white/20 rounded text-[9px] text-white whitespace-nowrap opacity-0 group-hover/marker:opacity-100 transition-opacity pointer-events-none z-20">
                              {ch.title}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Mark chapter at current time */}
                <div className="flex items-end gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Chapter Title</label>
                    <input value={newChapter.title} onChange={(e) => setNewChapter((f) => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. Introduction, Architecture Overview..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                  </div>
                  <div className="w-32">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Start (sec)</label>
                    <input type="number" value={newChapter.start_time} onChange={(e) => setNewChapter((f) => ({ ...f, start_time: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                  </div>
                  <button
                    onClick={() => setNewChapter((f) => ({ ...f, start_time: Math.floor(playerTime) }))}
                    className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-bold rounded-lg transition-colors border border-amber-500/30"
                    title="Set start time to current player position"
                  >
                    <span className="material-symbols-outlined text-sm">my_location</span>
                  </button>
                  <button onClick={handleAddChapter} className="px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                    Add Chapter
                  </button>
                </div>

                {/* Chapter List */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Chapters ({chapters.length})
                  </h4>
                  <div className="space-y-2">
                    {chapters.map((ch) => (
                      <div key={ch.id} className="rounded-lg bg-slate-800/30 border border-white/5 group/ch">
                        {editingChapterId === ch.id ? (
                          <div className="flex items-end gap-3 p-3">
                            <div className="flex-1">
                              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Title</label>
                              <input
                                value={editChapterForm.title}
                                onChange={(e) => setEditChapterForm((f) => ({ ...f, title: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                                autoFocus
                              />
                            </div>
                            <div className="w-32">
                              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Start (sec)</label>
                              <input
                                type="number"
                                value={editChapterForm.start_time}
                                onChange={(e) => setEditChapterForm((f) => ({ ...f, start_time: parseInt(e.target.value) || 0 }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                              />
                            </div>
                            <button
                              onClick={() => setEditChapterForm((f) => ({ ...f, start_time: Math.floor(playerTime) }))}
                              className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-bold rounded-lg transition-colors border border-amber-500/30"
                              title="Set start time to current player position"
                            >
                              <span className="material-symbols-outlined text-sm">my_location</span>
                            </button>
                            <button onClick={handleEditChapterSave} className="px-3 py-2 bg-primary hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors">
                              Save
                            </button>
                            <button onClick={() => setEditingChapterId(null)} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-lg transition-colors">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 p-3">
                            <button
                              onClick={() => playerRef.current?.seekTo(ch.start_time)}
                              className="font-mono text-xs text-primary min-w-[50px] hover:text-white transition-colors cursor-pointer"
                              title="Seek to this chapter"
                            >
                              {formatDuration(ch.start_time)}
                            </button>
                            <span className="text-sm text-white flex-1">{ch.title}</span>
                            <button onClick={() => handleEditChapterStart(ch)} className="text-slate-400/0 group-hover/ch:text-slate-400/50 hover:!text-slate-300 transition-colors" title="Edit chapter">
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                            <button onClick={() => handleDeleteChapter(ch.id)} className="text-red-400/0 group-hover/ch:text-red-400/50 hover:!text-red-400 transition-colors">
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {chapters.length === 0 && <p className="text-slate-500 text-sm">No chapters yet. Play the video above and mark chapter points.</p>}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'howto' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Guide Title</label>
                  <input value={howtoTitle} onChange={(e) => setHowtoTitle(e.target.value)}
                    placeholder="Getting Started with the Coding Agent" className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Content (Markdown)</label>
                    <button
                      onClick={() => handleBeautify('howto', howtoContent, setHowtoContent)}
                      disabled={beautifying === 'howto' || !howtoContent.trim()}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded transition-colors disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>{beautifying === 'howto' ? 'autorenew' : 'auto_fix_high'}</span>
                      {beautifying === 'howto' ? 'Beautifying…' : 'Beautify'}
                    </button>
                  </div>
                  <textarea value={howtoContent} onChange={(e) => setHowtoContent(e.target.value)}
                    rows={15} placeholder="# Step 1: Install the CLI&#10;&#10;```bash&#10;curl -s https://ai.internal.corp/install | bash&#10;```"
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none font-mono" />
                </div>
                <button onClick={handleSaveHowto} className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  Save How-To Guide
                </button>
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="space-y-4">
                {/* Auto-processing status */}
                {autoStatus && (
                  <div className="p-3 rounded-lg bg-slate-800/40 border border-white/5 space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Auto-Processing Status</p>
                    <div className="flex flex-wrap gap-2">
                      {(['transcript', 'metadata', 'chapters', 'howto'] as const).map((kind) => {
                        const job = autoStatus.jobs?.[kind];
                        const colors = !job ? 'bg-slate-700/40 text-slate-500' :
                          job.status === 'completed' ? 'bg-green-500/15 text-green-400' :
                          job.status === 'failed' ? 'bg-red-500/15 text-red-400' :
                          job.status === 'processing' || job.status === 'pending' ? 'bg-amber-500/15 text-amber-400' :
                          'bg-slate-700/40 text-slate-500';
                        return (
                          <div key={kind} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${colors}`}>
                            <span className="material-symbols-outlined text-xs">
                              {!job ? 'radio_button_unchecked' :
                               job.status === 'completed' ? 'check_circle' :
                               job.status === 'failed' ? 'error' :
                               'hourglass_top'}
                            </span>
                            {kind}
                            {job?.status === 'failed' && (
                              <button onClick={() => handleRetryAutoJob(kind)} className="ml-1 hover:text-white transition-colors" title="Retry">
                                <span className="material-symbols-outlined text-xs">refresh</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!autoStatus.jobs?.transcript && (
                      <button
                        onClick={async () => {
                          if (!selected) return;
                          await api.post(`/admin/videos/${selected.id}/auto-process`, {});
                          startAutoStatusPoll(selected.id);
                          showMsg('success', 'Auto-processing started');
                        }}
                        className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-bold rounded-lg transition-colors border border-primary/30"
                      >
                        <span className="material-symbols-outlined text-sm">auto_awesome</span>
                        Start Auto-Processing
                      </button>
                    )}
                  </div>
                )}

                {/* Transcript content */}
                {transcriptLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
                    <span className="material-symbols-outlined animate-spin">autorenew</span>
                    Loading transcript...
                  </div>
                ) : transcriptData ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-3 text-xs text-slate-400">
                        {transcriptData.language && <span>Language: <span className="text-slate-200 font-bold">{transcriptData.language}</span></span>}
                        {transcriptData.duration && <span>Duration: <span className="text-slate-200 font-bold">{Math.floor(transcriptData.duration / 60)}:{String(Math.floor(transcriptData.duration % 60)).padStart(2, '0')}</span></span>}
                        {transcriptData.segments?.length && <span>Segments: <span className="text-slate-200 font-bold">{transcriptData.segments.length}</span></span>}
                      </div>
                      <button onClick={handleSaveTranscript} disabled={transcriptSaving} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
                        <span className="material-symbols-outlined text-sm">save</span>
                        {transcriptSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    {(transcriptData.segments?.length > 0) ? (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Timestamped Transcript ({transcriptData.segments.length} segments)
                        </label>
                        <div className="rounded-lg bg-slate-900 border border-white/10 max-h-96 overflow-y-auto divide-y divide-white/5">
                          {transcriptData.segments.map((seg: any, i: number) => (
                            <div key={i} className="flex gap-3 px-3 py-1.5 hover:bg-white/3 text-xs">
                              <span className="font-mono text-primary shrink-0 w-[90px]">
                                {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, '0')}
                                {' → '}
                                {Math.floor(seg.end / 60)}:{String(Math.floor(seg.end % 60)).padStart(2, '0')}
                              </span>
                              <span className="text-slate-300 leading-relaxed">{seg.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Full Transcript</label>
                        <textarea
                          value={transcriptData.full_text || ''}
                          onChange={(e) => setTranscriptData((d: any) => ({ ...d, full_text: e.target.value }))}
                          rows={14}
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none font-mono leading-relaxed"
                          placeholder="Transcript text..."
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    <span className="material-symbols-outlined text-4xl mb-3 block">mic_off</span>
                    <p className="text-sm">No transcript yet.</p>
                    <p className="text-xs mt-1">Upload a video and enable Auto Mode, or start auto-processing above.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'quality' && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">Select which quality tiers to transcode. Lower CRF = better quality (larger files).</p>
                <div className="space-y-3">
                  {['360p', '720p', '1080p'].map((q) => {
                    const setting = qualitySettings.find((s) => s.quality === q) || { quality: q, enabled: true, crf: 23 };
                    return (
                      <div key={q} className="flex items-center gap-4 p-3 rounded-lg bg-slate-800/30 border border-white/5">
                        <label className="flex items-center gap-2 cursor-pointer min-w-[80px]">
                          <input
                            type="checkbox"
                            checked={setting.enabled}
                            onChange={(e) => {
                              setQualitySettings((prev) => {
                                const existing = prev.find((s) => s.quality === q);
                                if (existing) return prev.map((s) => s.quality === q ? { ...s, enabled: e.target.checked } : s);
                                return [...prev, { quality: q, enabled: e.target.checked, crf: 23 }];
                              });
                            }}
                            className="rounded bg-slate-900 border-white/20 text-primary focus:ring-primary"
                          />
                          <span className="text-sm font-bold text-white">{q}</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">CRF:</span>
                          <input
                            type="number"
                            value={setting.crf}
                            min={18}
                            max={35}
                            onChange={(e) => {
                              const crf = parseInt(e.target.value) || 23;
                              setQualitySettings((prev) => {
                                const existing = prev.find((s) => s.quality === q);
                                if (existing) return prev.map((s) => s.quality === q ? { ...s, crf } : s);
                                return [...prev, { quality: q, enabled: true, crf }];
                              });
                            }}
                            className="w-16 px-2 py-1 rounded bg-slate-900 border border-white/10 text-white text-sm text-center focus:border-primary outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={handleSaveQuality} className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  Save Quality Settings
                </button>
              </div>
            )}

            {activeTab === 'seed-notes' && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">Seed notes are visible to all users as pre-populated key takeaways.</p>
                <div className="space-y-2">
                  {seedNotes.map((n) => (
                    <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/30 border border-white/5">
                      <span className="font-mono text-xs text-primary min-w-[50px] pt-0.5">{formatDuration(n.timestamp_s)}</span>
                      <p className="text-sm text-white flex-1">{n.content}</p>
                      <button onClick={() => handleDeleteSeedNote(n.id)} className="text-red-400/50 hover:text-red-400 transition-colors">
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  ))}
                  {seedNotes.length === 0 && <p className="text-slate-500 text-sm">No seed notes yet</p>}
                </div>
                <div className="flex items-end gap-3 pt-2 border-t border-white/5">
                  <div className="w-32">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Time (sec)</label>
                    <input type="number" value={newSeedNote.timestamp_s} onChange={(e) => setNewSeedNote((f) => ({ ...f, timestamp_s: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Note Content</label>
                    <input value={newSeedNote.content} onChange={(e) => setNewSeedNote((f) => ({ ...f, content: e.target.value }))}
                      placeholder="Key takeaway..." className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                  </div>
                  <button onClick={handleAddSeedNote} className="px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                    Add
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'trim' && (
              <div className="space-y-5">
                {/* Mode Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTrimMode('trim')}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      trimMode === 'trim'
                        ? 'bg-primary text-white'
                        : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 border border-white/10'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">crop</span>
                    Trim
                  </button>
                  <button
                    onClick={() => setTrimMode('cut')}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      trimMode === 'cut'
                        ? 'bg-red-500 text-white'
                        : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 border border-white/10'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">content_cut</span>
                    Cut
                  </button>
                  <button
                    onClick={() => setTrimMode('speed')}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      trimMode === 'speed'
                        ? 'bg-orange-500 text-white'
                        : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 border border-white/10'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">fast_forward</span>
                    Speed Up
                  </button>
                </div>
                <p className="text-sm text-slate-400">
                  {trimMode === 'trim'
                    ? 'Trim keeps only the section between start and end times. The original is backed up before the first trim.'
                    : trimMode === 'cut'
                    ? 'Cut removes the section between start and end times, keeping everything before and after. The original is backed up before the first cut.'
                    : 'Speed Up accelerates the selected section by the chosen factor. Drag the handles on the timeline or use the inputs to define the section.'}
                </p>

                {/* Speed factor selector */}
                {trimMode === 'speed' && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/5 border border-orange-500/20">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">Speed Factor</span>
                    {[2, 4, 8, 16, 32].map((f) => (
                      <button
                        key={f}
                        onClick={() => setSpeedFactor(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          speedFactor === f
                            ? 'bg-orange-500 text-white'
                            : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 border border-white/10'
                        }`}
                      >
                        {f}x
                      </button>
                    ))}
                  </div>
                )}

                {/* Timeline with trim markers */}
                {(selected.hls_path || selected.status !== 'draft') && playerDuration > 0 ? (
                  <div className="px-1">
                    <div
                      ref={timelineRef}
                      className={`relative w-full h-10 bg-slate-800/50 rounded-lg border border-white/5 overflow-hidden ${dragging ? 'cursor-grabbing' : 'cursor-default'}`}
                      onMouseMove={handleTimelineDrag}
                      onMouseUp={() => setDragging(null)}
                      onMouseLeave={() => setDragging(null)}
                    >
                      {/* Playhead */}
                      {playerDuration > 0 && (
                        <div
                          className="absolute top-0 h-full w-0.5 bg-white/60 z-20 pointer-events-none"
                          style={{ left: `${(playerTime / playerDuration) * 100}%` }}
                        />
                      )}
                      {/* Selected region */}
                      {playerDuration > 0 && trimEnd > trimStart && trimMode === 'trim' && (
                        <div
                          className="absolute top-0 h-full bg-primary/20 border-x-2 border-primary/60 z-10 pointer-events-none"
                          style={{
                            left: `${(trimStart / playerDuration) * 100}%`,
                            width: `${((trimEnd - trimStart) / playerDuration) * 100}%`,
                          }}
                        />
                      )}
                      {/* Cut region (striped to indicate removal) */}
                      {playerDuration > 0 && trimEnd > trimStart && trimMode === 'cut' && (
                        <>
                          <div
                            className="absolute top-0 h-full bg-red-500/20 border-x-2 border-red-500/60 z-10 pointer-events-none"
                            style={{
                              left: `${(trimStart / playerDuration) * 100}%`,
                              width: `${((trimEnd - trimStart) / playerDuration) * 100}%`,
                              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(239,68,68,0.15) 4px, rgba(239,68,68,0.15) 8px)',
                            }}
                          />
                          {/* Kept regions */}
                          {trimStart > 0 && (
                            <div
                              className="absolute top-0 h-full bg-green-500/10 z-[5] pointer-events-none"
                              style={{
                                left: '0%',
                                width: `${(trimStart / playerDuration) * 100}%`,
                              }}
                            />
                          )}
                          <div
                            className="absolute top-0 h-full bg-green-500/10 z-[5] pointer-events-none"
                            style={{
                              left: `${(trimEnd / playerDuration) * 100}%`,
                              width: `${((playerDuration - trimEnd) / playerDuration) * 100}%`,
                            }}
                          />
                        </>
                      )}
                      {/* Speed-up region (orange) */}
                      {playerDuration > 0 && trimEnd > trimStart && trimMode === 'speed' && (
                        <div
                          className="absolute top-0 h-full bg-orange-500/25 border-x-2 border-orange-400/60 z-10 pointer-events-none"
                          style={{
                            left: `${(trimStart / playerDuration) * 100}%`,
                            width: `${((trimEnd - trimStart) / playerDuration) * 100}%`,
                            backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(249,115,22,0.15) 4px, rgba(249,115,22,0.15) 8px)',
                          }}
                        />
                      )}
                      {/* Start marker (draggable) */}
                      {playerDuration > 0 && (
                        <div
                          className="absolute top-0 h-full w-2 bg-green-400 z-30 cursor-ew-resize hover:bg-green-300 transition-colors"
                          style={{ left: `${(trimStart / playerDuration) * 100}%`, transform: 'translateX(-50%)' }}
                          title={`Start: ${formatDuration(trimStart)} — drag to adjust`}
                          onMouseDown={(e) => { e.preventDefault(); setDragging('start'); }}
                        />
                      )}
                      {/* End marker (draggable) */}
                      {playerDuration > 0 && trimEnd > 0 && (
                        <div
                          className="absolute top-0 h-full w-2 bg-red-400 z-30 cursor-ew-resize hover:bg-red-300 transition-colors"
                          style={{ left: `${(trimEnd / playerDuration) * 100}%`, transform: 'translateX(-50%)' }}
                          title={`End: ${formatDuration(trimEnd)} — drag to adjust`}
                          onMouseDown={(e) => { e.preventDefault(); setDragging('end'); }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-600 mt-1 px-0.5">
                      <span>0:00</span>
                      <span>{formatDuration(Math.floor(playerDuration))}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-800/30 border border-white/5 text-center">
                    <p className="text-slate-500 text-sm">Upload a video first to use the trim tool.</p>
                  </div>
                )}

                {/* Trim Controls */}
                <div className="flex items-end gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="w-40">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Start (seconds)</label>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={trimStart}
                      onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                    />
                  </div>
                  <button
                    onClick={() => setTrimStart(Math.floor(playerTime * 10) / 10)}
                    className="px-3 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs font-bold rounded-lg transition-colors border border-green-500/30"
                    title="Set start to current player position"
                  >
                    <span className="material-symbols-outlined text-sm">first_page</span>
                  </button>
                  <div className="w-40">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">End (seconds)</label>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={trimEnd}
                      onChange={(e) => setTrimEnd(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                    />
                  </div>
                  <button
                    onClick={() => setTrimEnd(Math.floor(playerTime * 10) / 10)}
                    className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold rounded-lg transition-colors border border-red-500/30"
                    title="Set end to current player position"
                  >
                    <span className="material-symbols-outlined text-sm">last_page</span>
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => { if (playerDuration > 0) { setTrimStart(0); setTrimEnd(Math.floor(playerDuration * 10) / 10); } }}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
                  >
                    Full Duration
                  </button>
                </div>

                {/* Summary & Execute */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/30 border border-white/5">
                  <div className="text-sm text-slate-300">
                    {trimEnd > trimStart ? (
                      trimMode === 'trim' ? (
                        <>
                          Keep <span className="font-bold text-white">{formatDuration(Math.floor(trimStart))}</span>
                          {' → '}
                          <span className="font-bold text-white">{formatDuration(Math.floor(trimEnd))}</span>
                          {' '}
                          <span className="text-slate-500">({formatDuration(Math.floor(trimEnd - trimStart))} duration)</span>
                        </>
                      ) : trimMode === 'cut' ? (
                        <>
                          Remove <span className="font-bold text-red-400">{formatDuration(Math.floor(trimStart))}</span>
                          {' → '}
                          <span className="font-bold text-red-400">{formatDuration(Math.floor(trimEnd))}</span>
                          {' '}
                          <span className="text-slate-500">({formatDuration(Math.floor(trimEnd - trimStart))} removed)</span>
                        </>
                      ) : (
                        <>
                          Speed up <span className="font-bold text-orange-400">{formatDuration(Math.floor(trimStart))}</span>
                          {' → '}
                          <span className="font-bold text-orange-400">{formatDuration(Math.floor(trimEnd))}</span>
                          {' '}
                          <span className="text-slate-500">at {speedFactor}x ({formatDuration(Math.floor((trimEnd - trimStart) / speedFactor))} after)</span>
                        </>
                      )
                    ) : (
                      <span className="text-slate-500">Set start and end times to define the {trimMode} region</span>
                    )}
                  </div>
                  <button
                    onClick={trimMode === 'trim' ? handleTrim : trimMode === 'cut' ? handleCut : handleSpeedSection}
                    disabled={trimming || trimEnd <= trimStart}
                    className={`flex items-center gap-2 px-5 py-2.5 disabled:opacity-30 text-white text-sm font-bold rounded-lg transition-colors ${
                      trimMode === 'trim'
                        ? 'bg-primary hover:bg-blue-500'
                        : trimMode === 'cut'
                        ? 'bg-red-600 hover:bg-red-500'
                        : 'bg-orange-500 hover:bg-orange-400'
                    }`}
                  >
                    {trimming ? (
                      <>
                        <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                        {trimMode === 'trim' ? 'Trimming...' : trimMode === 'cut' ? 'Cutting...' : 'Processing...'}
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">
                          {trimMode === 'trim' ? 'crop' : trimMode === 'cut' ? 'content_cut' : 'fast_forward'}
                        </span>
                        {trimMode === 'trim' ? 'Trim Video' : trimMode === 'cut' ? 'Cut Video' : `Speed Up ${speedFactor}x`}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'banner' && (
              <div className="space-y-4">
                {/* Status bar */}
                {bannerConfig && (
                  <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${
                    bannerConfig.status === 'ready' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                    bannerConfig.status === 'generating' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                    bannerConfig.status === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                    'bg-slate-800/30 border-white/5 text-slate-400'
                  }`}>
                    <span className="material-symbols-outlined text-base">
                      {bannerConfig.status === 'ready' ? 'check_circle' :
                       bannerConfig.status === 'generating' ? 'hourglass_top' :
                       bannerConfig.status === 'error' ? 'error' : 'edit'}
                    </span>
                    <span>
                      {bannerConfig.status === 'ready' ? 'Banner generated and prepended to video' :
                       bannerConfig.status === 'generating' ? 'Generating banner video...' :
                       bannerConfig.status === 'error' ? `Error: ${bannerConfig.error}` :
                       'Banner config saved (not yet generated)'}
                    </span>
                  </div>
                )}

                {/* Variant Selector — compact row */}
                <div className="flex gap-2">
                  {[
                    { key: 'A', label: 'Classic' },
                    { key: 'B', label: 'Split' },
                    { key: 'C', label: 'Minimal' },
                  ].map((v) => (
                    <button
                      key={v.key}
                      onClick={() => setBannerForm((f) => ({ ...f, variant: v.key }))}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                        bannerForm.variant === v.key
                          ? 'bg-primary text-white'
                          : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 border border-white/10'
                      }`}
                    >
                      {v.key}: {v.label}
                    </button>
                  ))}
                </div>

                {/* Two-column layout: Preview (left) + Settings (right) */}
                <div className="flex gap-5">
                  {/* Left: Live Preview */}
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Live Preview</label>
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-slate-900">
                      <iframe
                        srcDoc={bannerPreviewHtml}
                        className="w-full aspect-video border-0"
                        sandbox="allow-scripts"
                        title="Banner Preview"
                      />
                    </div>
                  </div>

                  {/* Right: Settings */}
                  <div className="w-[320px] shrink-0 space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Settings</label>
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Company Logo</label>
                        <input value={bannerForm.company_logo} onChange={(e) => setBannerForm((f) => ({ ...f, company_logo: e.target.value }))}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Series Tag</label>
                        <input value={bannerForm.series_tag} onChange={(e) => setBannerForm((f) => ({ ...f, series_tag: e.target.value }))}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Brand Title</label>
                        <input value={bannerForm.brand_title} onChange={(e) => setBannerForm((f) => ({ ...f, brand_title: e.target.value }))}
                          placeholder="e.g. AI Ignite"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Topic (Main Title)</label>
                        <input value={bannerForm.topic} onChange={(e) => setBannerForm((f) => ({ ...f, topic: e.target.value }))}
                          placeholder="e.g. Intro to AI Agents"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Subtopic</label>
                        <input value={bannerForm.subtopic} onChange={(e) => setBannerForm((f) => ({ ...f, subtopic: e.target.value }))}
                          placeholder="e.g. Environment Setup & First Run"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Episode</label>
                          <div className="flex gap-1">
                            <input value={bannerForm.episode} onChange={(e) => setBannerForm((f) => ({ ...f, episode: e.target.value }))}
                              className="min-w-0 flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                            <button
                              onClick={() => {
                                if (!selected?.course_id) return;
                                const courseVids = [...videos.filter(v => v.course_id === selected.course_id)]
                                  .sort((a, b) => a.sort_order - b.sort_order || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                                const idx = courseVids.findIndex(v => v.id === selected.id);
                                setBannerForm((f) => ({ ...f, episode: `EP ${String(idx >= 0 ? idx + 1 : 1).padStart(2, '0')}` }));
                              }}
                              className="shrink-0 p-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary transition-colors border border-primary/30"
                              title="Sync episode number from video position in course"
                            >
                              <span className="material-symbols-outlined text-sm">sync</span>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Duration</label>
                          <div className="flex gap-1">
                            <input value={bannerForm.duration} onChange={(e) => setBannerForm((f) => ({ ...f, duration: e.target.value }))}
                              className="min-w-0 flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                            <button
                              onClick={() => {
                                const dur = playerDuration > 0 ? playerDuration : (selected?.duration_s || 0);
                                if (dur > 0) {
                                  const m = Math.floor(dur / 60);
                                  const s = Math.floor(dur % 60);
                                  setBannerForm((f) => ({ ...f, duration: `${m}:${String(s).padStart(2, '0')}` }));
                                }
                              }}
                              className="shrink-0 p-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary transition-colors border border-primary/30"
                              title="Sync duration from video"
                            >
                              <span className="material-symbols-outlined text-sm">sync</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Banner Clip Duration: {bannerForm.banner_duration_s}s</label>
                        <input type="range" min={3} max={10} step={1} value={bannerForm.banner_duration_s}
                          onChange={(e) => setBannerForm((f) => ({ ...f, banner_duration_s: parseInt(e.target.value) }))}
                          className="w-full accent-primary" />
                        <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                          <span>3s</span><span>5s</span><span>7s</span><span>10s</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Presenter</label>
                          <input value={bannerForm.presenter} onChange={(e) => setBannerForm((f) => ({ ...f, presenter: e.target.value, presenter_initial: e.target.value.charAt(0).toUpperCase() || '' }))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                        </div>
                        <div className="w-16 shrink-0">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Initial</label>
                          <input value={bannerForm.presenter_initial} onChange={(e) => setBannerForm((f) => ({ ...f, presenter_initial: e.target.value }))}
                            maxLength={2}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none text-center" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                  <button
                    onClick={handleSaveBanner}
                    className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    Save Config
                  </button>
                  <button
                    onClick={handleGenerateBanner}
                    disabled={bannerGenerating}
                    className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    {bannerGenerating ? (
                      <>
                        <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                        Generating...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">movie</span>
                        Generate & Insert Banner
                      </>
                    )}
                  </button>
                  {bannerConfig?.banner_video_path && bannerConfig.status === 'ready' && (
                    <a
                      href={bannerConfig.banner_video_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-4 py-2 text-xs text-primary hover:text-white transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">play_circle</span>
                      Preview Banner Video
                    </a>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'attachments' && (
              <div className="space-y-4">
                {/* Upload */}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-bold rounded-lg transition-colors border border-primary/20 cursor-pointer">
                    <span className="material-symbols-outlined text-sm">upload_file</span>
                    {attachUploading ? 'Uploading...' : 'Upload File'}
                    <input
                      type="file"
                      className="hidden"
                      disabled={attachUploading}
                      accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.csv,.txt,.zip,.rar,.7z,.png,.jpg,.jpeg,.gif"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !selected) return;
                        setAttachUploading(true);
                        try {
                          const att = await api.upload<Attachment>(`/admin/videos/${selected.id}/attachments`, file);
                          setAttachments((prev) => [...prev, att]);
                        } catch (err: unknown) {
                          alert(err instanceof Error ? err.message : 'Upload failed');
                        }
                        setAttachUploading(false);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <span className="text-xs text-slate-500">PDF, Word, PowerPoint, Excel, CSV, ZIP, images · Max 100 MB</span>
                </div>

                {/* List */}
                {attachments.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4">No attachments yet. Upload files for users to download.</p>
                ) : (
                  <div className="space-y-2">
                    {attachments.map((att) => {
                      const icon =
                        att.mime_type?.includes('pdf') ? 'picture_as_pdf' :
                        att.mime_type?.includes('word') || att.mime_type?.includes('document') ? 'description' :
                        att.mime_type?.includes('presentation') || att.mime_type?.includes('powerpoint') ? 'slideshow' :
                        att.mime_type?.includes('sheet') || att.mime_type?.includes('excel') ? 'table_chart' :
                        att.mime_type?.includes('zip') || att.mime_type?.includes('rar') || att.mime_type?.includes('7z') ? 'folder_zip' :
                        att.mime_type?.includes('image') ? 'image' :
                        'draft';
                      const sizeStr = att.file_size > 1048576
                        ? `${(att.file_size / 1048576).toFixed(1)} MB`
                        : `${(att.file_size / 1024).toFixed(0)} KB`;
                      return (
                        <div key={att.id} className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-lg border border-white/5 group">
                          <span className="material-symbols-outlined text-xl text-primary">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{att.display_name || att.filename}</p>
                            <p className="text-xs text-slate-500">{sizeStr}</p>
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                await api.delete(`/admin/attachments/${att.id}`);
                                setAttachments((prev) => prev.filter((a) => a.id !== att.id));
                              } catch { /* ignore */ }
                            }}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'email' && selected && (
              <div className="space-y-4">
                {/* Generate Preview */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Custom Content (optional)</label>
                    <textarea
                      value={emailCustomContent}
                      onChange={(e) => setEmailCustomContent(e.target.value)}
                      placeholder="Add any additional content to include in the email..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      if (!selected) return;
                      setEmailGenerating(true);
                      try {
                        const preview = await api.post<{ subject: string; html_content: string; plain_text: string }>(
                          `/admin/videos/${selected.id}/email-preview`,
                          { custom_content: emailCustomContent },
                        );
                        setEmailPreview(preview);
                        setEmailSubject(preview.subject);
                        showMsg('success', 'Email preview generated!');
                      } catch (err: any) {
                        showMsg('error', err.message);
                      } finally {
                        setEmailGenerating(false);
                      }
                    }}
                    disabled={emailGenerating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-sm rounded-lg transition-colors border border-primary/20 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    {emailGenerating ? 'Generating...' : 'Generate Preview'}
                  </button>
                </div>

                {/* Preview & Send */}
                {emailPreview && (
                  <div className="space-y-3 p-4 bg-slate-800/30 rounded-lg border border-white/5">
                    {/* Action buttons toolbar */}
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => {
                          const win = window.open('', '_blank');
                          if (win) { win.document.write(DOMPurify.sanitize(emailPreview.html_content)); win.document.close(); }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10"
                        title="View in new tab"
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                        View
                      </button>
                      <button
                        onClick={() => {
                          const win = window.open('', '_blank');
                          if (win) {
                            win.document.write(`<html><head><title>${emailSubject || emailPreview.subject}</title><style>@media print { body { margin: 0; } }</style></head><body onload="setTimeout(()=>{window.print();},500)">${DOMPurify.sanitize(emailPreview.html_content)}</body></html>`);
                            win.document.close();
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10"
                        title="Download as PDF"
                      >
                        <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
                        PDF
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem('mst_token');
                            const apiBase = import.meta.env.VITE_API_URL || '';
                            const res = await fetch(`${apiBase}/admin/generate-eml`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                              body: JSON.stringify({ subject: emailSubject || emailPreview.subject, html_content: emailPreview.html_content, plain_text: emailPreview.plain_text }),
                            });
                            if (!res.ok) throw new Error('Failed to generate .eml');
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = (emailSubject || emailPreview.subject).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_').slice(0, 60) + '.eml';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            showMsg('success', 'Downloaded .eml — open with Outlook, Thunderbird, or drag into Gmail');
                          } catch (err: any) {
                            showMsg('error', err.message);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium rounded-lg transition-colors border border-blue-500/20"
                        title="Download .eml for external email client (Outlook, etc.)"
                      >
                        <span className="material-symbols-outlined text-sm">forward_to_inbox</span>
                        Email Client
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Subject</label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Preview</label>
                      <div
                        className="bg-white dark:bg-slate-900 rounded-lg p-4 text-slate-900 dark:text-white text-sm max-h-64 overflow-y-auto border border-white/10"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailPreview.html_content) }}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Send To</label>
                      {/* Toolbar */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => emailCsvRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10"
                          title="Import emails from CSV"
                        >
                          <span className="material-symbols-outlined text-sm">upload_file</span>
                          CSV
                        </button>
                        <input
                          ref={emailCsvRef}
                          type="file"
                          accept=".csv,.txt"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const text = ev.target?.result as string;
                              const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
                              const found = Array.from(new Set(text.match(emailRegex) || []));
                              if (found.length === 0) { showMsg('error', 'No valid emails found in CSV'); return; }
                              const current = emailRecipients.split('\n').map(x => x.trim()).filter(Boolean);
                              setEmailRecipients([...new Set([...current, ...found])].join('\n'));
                              const updated = [...new Set([...emailSavedAddresses, ...found])];
                              setEmailSavedAddresses(updated);
                              localStorage.setItem('mst_video_email_saved', JSON.stringify(updated));
                              showMsg('success', `Loaded ${found.length} email(s) from CSV`);
                            };
                            reader.readAsText(file);
                            e.target.value = '';
                          }}
                        />
                        {emailSavedAddresses.length > 0 && (
                          <button
                            onClick={() => setEmailShowSaved(v => !v)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium rounded-lg transition-colors border border-primary/20"
                          >
                            <span className="material-symbols-outlined text-sm">bookmarks</span>
                            Saved ({emailSavedAddresses.length})
                          </button>
                        )}
                      </div>

                      {/* Saved addresses quick-select */}
                      {emailShowSaved && emailSavedAddresses.length > 0 && (
                        <div className="p-3 bg-slate-900/60 rounded-lg border border-white/5 space-y-1.5 max-h-40 overflow-y-auto">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Saved</span>
                            <button
                              onClick={() => {
                                const current = emailRecipients.split('\n').map(x => x.trim()).filter(Boolean);
                                setEmailRecipients([...new Set([...current, ...emailSavedAddresses])].join('\n'));
                              }}
                              className="text-xs text-primary hover:text-white transition-colors"
                            >Add all</button>
                          </div>
                          {emailSavedAddresses.map(addr => {
                            const active = emailRecipients.split('\n').map(x => x.trim()).includes(addr);
                            return (
                              <div key={addr} className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    const current = emailRecipients.split('\n').map(x => x.trim()).filter(Boolean);
                                    if (current.includes(addr)) {
                                      setEmailRecipients(current.filter(x => x !== addr).join('\n'));
                                    } else {
                                      setEmailRecipients([...current, addr].join('\n'));
                                    }
                                  }}
                                  className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition-colors font-mono truncate ${active ? 'bg-primary/15 text-primary border border-primary/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                                >
                                  {active && <span className="mr-1">✓</span>}{addr}
                                </button>
                                <button
                                  onClick={() => {
                                    const updated = emailSavedAddresses.filter(x => x !== addr);
                                    setEmailSavedAddresses(updated);
                                    localStorage.setItem('mst_video_email_saved', JSON.stringify(updated));
                                  }}
                                  className="text-red-400/50 hover:text-red-400 transition-colors"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>close</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Recipient textarea */}
                      <textarea
                        value={emailRecipients}
                        onChange={(e) => setEmailRecipients(e.target.value)}
                        placeholder={"user1@example.com\nuser2@example.com\nteam@example.com"}
                        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none font-mono"
                        rows={4}
                      />
                      {(() => {
                        const list = emailRecipients.split('\n').map(x => x.trim()).filter(x => x.includes('@'));
                        return (
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-500">{list.length} recipient{list.length !== 1 ? 's' : ''}</p>
                            {list.length > 0 && (
                              <button
                                onClick={() => {
                                  const updated = [...new Set([...emailSavedAddresses, ...list])];
                                  setEmailSavedAddresses(updated);
                                  localStorage.setItem('mst_video_email_saved', JSON.stringify(updated));
                                  showMsg('success', 'Saved to quick-access');
                                }}
                                className="text-xs text-slate-500 hover:text-primary transition-colors"
                              >Save to quick-access</button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      onClick={async () => {
                        if (!selected) return;
                        const emails = emailRecipients.split('\n').map(x => x.trim()).filter(x => x.includes('@'));
                        if (emails.length === 0) {
                          showMsg('error', 'Please enter at least one valid email address');
                          return;
                        }
                        setEmailSending(true);
                        try {
                          const batchSize = 50;
                          const batches: string[][] = [];
                          for (let i = 0; i < emails.length; i += batchSize) batches.push(emails.slice(i, i + batchSize));
                          let totalSent = 0;
                          for (let b = 0; b < batches.length; b++) {
                            setEmailSendingProgress(batches.length > 1 ? `Batch ${b + 1}/${batches.length}…` : '');
                            const result = await api.post<{ success: boolean; message: string; sent_count: number }>(
                              `/admin/videos/${selected.id}/send-email`,
                              { recipient_emails: batches[b], subject: emailSubject || emailPreview.subject, html_content: emailPreview.html_content },
                            );
                            totalSent += result.sent_count;
                            const updated = [...new Set([...emailSavedAddresses, ...batches[b]])];
                            setEmailSavedAddresses(updated);
                            localStorage.setItem('mst_video_email_saved', JSON.stringify(updated));
                            if (b < batches.length - 1) await new Promise(r => setTimeout(r, 600));
                          }
                          showMsg('success', `Sent to ${totalSent}/${emails.length} recipient(s)`);
                          setEmailRecipients('');
                          setEmailPreview(null);
                          setEmailSubject('');
                          setEmailCustomContent('');
                        } catch (err: any) {
                          showMsg('error', err.message);
                        } finally {
                          setEmailSending(false);
                          setEmailSendingProgress('');
                        }
                      }}
                      disabled={emailSending || !emailRecipients.trim()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 font-bold text-sm rounded-lg transition-colors border border-green-500/20 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">{emailSending ? 'hourglass_empty' : 'send'}</span>
                      {emailSending ? (emailSendingProgress || 'Sending…') : 'Send Email'}
                    </button>
                  </div>
                )}

                {!emailPreview && (
                  <p className="text-sm text-slate-500 py-4">Generate a preview first to see the email content before sending.</p>
                )}
              </div>
            )}
            </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <span className="material-symbols-outlined text-6xl mb-4 opacity-20">videocam</span>
            <p className="text-sm">Select a video or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
};
