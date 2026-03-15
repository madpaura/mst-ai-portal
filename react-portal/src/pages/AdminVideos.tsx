import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { HlsPlayer, type HlsPlayerHandle } from '../components/HlsPlayer';

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

type Tab = 'metadata' | 'chapters' | 'howto' | 'quality' | 'seed-notes';

export const AdminVideos: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('metadata');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create video form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', slug: '', description: '', category: 'Code-mate', course_id: '' });

  // Edit metadata form
  const [editForm, setEditForm] = useState({ title: '', description: '', category: '', course_id: '', sort_order: 0 });

  // Chapters
  const chapterPlayerRef = useRef<HlsPlayerHandle>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [newChapter, setNewChapter] = useState({ title: '', start_time: 0 });
  const [chapterPlayerTime, setChapterPlayerTime] = useState(0);
  const [chapterPlayerDuration, setChapterPlayerDuration] = useState(0);

  // How-to
  const [howtoTitle, setHowtoTitle] = useState('');
  const [howtoContent, setHowtoContent] = useState('');

  // Quality
  const [qualitySettings, setQualitySettings] = useState<QualitySetting[]>([]);

  // Seed notes
  const [seedNotes, setSeedNotes] = useState<SeedNote[]>([]);
  const [newSeedNote, setNewSeedNote] = useState({ timestamp_s: 0, content: '' });

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Message
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchVideos = useCallback(async () => {
    try {
      const data = await api.get<Video[]>('/admin/videos');
      setVideos(data);
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
      showMsg('success', 'Video uploaded, transcoding started');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setUploading(false);
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
    if (!selected || !confirm('Deactivate this video?')) return;
    try {
      await api.delete(`/admin/videos/${selected.id}`);
      setSelected(null);
      await fetchVideos();
      showMsg('success', 'Video deactivated');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleRetranscode = async () => {
    if (!selected) return;
    try {
      await api.post(`/admin/videos/${selected.id}/retranscode`);
      await fetchVideos();
      showMsg('success', 'Re-transcode queued');
    } catch (err: any) {
      showMsg('error', err.message);
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

  // ── Helpers ───────────────────────────────────────────

  const statusBadge = (v: Video) => {
    if (!v.is_active) return <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>;
    if (v.is_published) return <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/20 text-green-400 border border-green-500/30">Published</span>;
    if (v.status === 'ready') return <span className="px-2 py-0.5 text-[10px] rounded bg-primary/20 text-primary border border-primary/30">Ready</span>;
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

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading videos...</div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
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

      {/* Left Panel — Video List */}
      <aside className="w-80 border-r border-slate-200 dark:border-white/10 bg-sidebar-light dark:bg-sidebar-dark flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200 dark:border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Videos</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1 text-xs text-primary hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              New
            </button>
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
          {filteredVideos.map((v) => (
            <button
              key={v.id}
              onClick={() => selectVideo(v)}
              className={`w-full text-left p-4 border-b border-slate-100 dark:border-white/5 transition-colors ${
                selected?.id === v.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{v.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{v.category} · {formatDuration(v.duration_s)}</p>
                </div>
                {statusBadge(v)}
              </div>
            </button>
          ))}
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
                    onChange={(e) => setCreateForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                  >
                    <option value="Code-mate">Code-mate</option>
                    <option value="RAG">RAG</option>
                    <option value="Agents">Agents</option>
                    <option value="Deep Dive">Deep Dive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Course</label>
                  <select
                    value={createForm.course_id}
                    onChange={(e) => setCreateForm((f) => ({ ...f, course_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                  >
                    <option value="">None</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
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
          <div className="max-w-4xl">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{selected.title}</h2>
                  {statusBadge(selected)}
                </div>
                <p className="text-sm text-slate-400">{selected.slug} · {selected.category}</p>
              </div>
              <div className="flex gap-2">
                {selected.status === 'ready' && !selected.is_published && (
                  <button onClick={handlePublish} className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors">
                    <span className="material-symbols-outlined text-sm">publish</span>
                    Publish
                  </button>
                )}
                {selected.is_published && (
                  <button onClick={handleUnpublish} className="flex items-center gap-1.5 px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white text-xs font-bold rounded-lg transition-colors">
                    <span className="material-symbols-outlined text-sm">unpublished</span>
                    Unpublish
                  </button>
                )}
                <button onClick={handleRetranscode} className="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs rounded-lg transition-colors border border-slate-300 dark:border-white/10">
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  Re-transcode
                </button>
                <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg transition-colors border border-red-500/20">
                  <span className="material-symbols-outlined text-sm">delete</span>
                  Delete
                </button>
              </div>
            </div>

            {/* Upload Section */}
            <div className="mb-6 p-4 rounded-xl bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Video File</h3>
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
                  {uploading ? 'Uploading...' : 'Upload & Transcode'}
                </button>
              </div>
              {selected.job_status && (
                <div className="mt-3 text-xs text-slate-400">
                  Last job: <span className={`font-bold ${selected.job_status === 'completed' ? 'text-green-400' : selected.job_status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>{selected.job_status}</span>
                  {selected.job_error && <span className="text-red-400 ml-2">— {selected.job_error}</span>}
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/10 mb-6">
              {(['metadata', 'chapters', 'howto', 'quality', 'seed-notes'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-all capitalize ${
                    activeTab === tab
                      ? 'text-white border-primary bg-primary/5'
                      : 'text-slate-400 hover:text-white border-transparent'
                  }`}
                >
                  {tab === 'seed-notes' ? 'Seed Notes' : tab === 'howto' ? 'How-To' : tab}
                </button>
              ))}
            </div>

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
                    <select value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                      <option value="Code-mate">Code-mate</option>
                      <option value="RAG">RAG</option>
                      <option value="Agents">Agents</option>
                      <option value="Deep Dive">Deep Dive</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
                  <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Course</label>
                    <select value={editForm.course_id} onChange={(e) => setEditForm((f) => ({ ...f, course_id: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                      <option value="">None</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
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
                {/* Video Player for Chapter Marking */}
                {selected.hls_path ? (
                  <div>
                    <HlsPlayer
                      ref={chapterPlayerRef}
                      hlsPath={selected.hls_path}
                      chapters={chapters}
                      onTimeUpdate={(t, d) => { setChapterPlayerTime(t); setChapterPlayerDuration(d); }}
                      className="rounded-xl border border-white/10"
                    />

                    {/* Timeline with chapter markers */}
                    <div className="mt-3 px-1">
                      <div className="relative w-full h-8 bg-slate-800/50 rounded-lg border border-white/5 overflow-hidden">
                        {/* Playhead position */}
                        {chapterPlayerDuration > 0 && (
                          <div
                            className="absolute top-0 h-full w-0.5 bg-white/60 z-10"
                            style={{ left: `${(chapterPlayerTime / chapterPlayerDuration) * 100}%` }}
                          />
                        )}
                        {/* Chapter markers on timeline */}
                        {chapters.map((ch) => {
                          const pct = chapterPlayerDuration > 0 ? (ch.start_time / chapterPlayerDuration) * 100 : 0;
                          return (
                            <button
                              key={ch.id}
                              className="absolute top-0 h-full group/marker"
                              style={{ left: `${pct}%` }}
                              onClick={() => chapterPlayerRef.current?.seekTo(ch.start_time)}
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
                      <div className="flex items-center justify-between mt-1">
                        <span className="font-mono text-[10px] text-slate-500">0:00</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          Current: {formatDuration(Math.floor(chapterPlayerTime))}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">{formatDuration(Math.floor(chapterPlayerDuration))}</span>
                      </div>
                    </div>

                    {/* Mark chapter at current time */}
                    <div className="flex items-end gap-3 mt-4 p-3 rounded-xl bg-primary/5 border border-primary/20">
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
                        onClick={() => setNewChapter((f) => ({ ...f, start_time: Math.floor(chapterPlayerTime) }))}
                        className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-bold rounded-lg transition-colors border border-amber-500/30"
                        title="Set start time to current player position"
                      >
                        <span className="material-symbols-outlined text-sm">my_location</span>
                      </button>
                      <button onClick={handleAddChapter} className="px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                        Add Chapter
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-slate-800/30 border border-white/5 text-center">
                    <span className="material-symbols-outlined text-4xl text-slate-600 mb-2">videocam_off</span>
                    <p className="text-slate-500 text-sm">Upload and transcode a video first to use the timeline chapter marker.</p>
                  </div>
                )}

                {/* Chapter List */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Chapters ({chapters.length})
                  </h4>
                  <div className="space-y-2">
                    {chapters.map((ch) => (
                      <div key={ch.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-white/5 group/ch">
                        <button
                          onClick={() => chapterPlayerRef.current?.seekTo(ch.start_time)}
                          className="font-mono text-xs text-primary min-w-[50px] hover:text-white transition-colors cursor-pointer"
                          title="Seek to this chapter"
                        >
                          {formatDuration(ch.start_time)}
                        </button>
                        <span className="text-sm text-white flex-1">{ch.title}</span>
                        <button onClick={() => handleDeleteChapter(ch.id)} className="text-red-400/0 group-hover/ch:text-red-400/50 hover:!text-red-400 transition-colors">
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                    ))}
                    {chapters.length === 0 && <p className="text-slate-500 text-sm">No chapters yet. Play the video and mark chapter points above.</p>}
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
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Content (Markdown)</label>
                  <textarea value={howtoContent} onChange={(e) => setHowtoContent(e.target.value)}
                    rows={15} placeholder="# Step 1: Install the CLI&#10;&#10;```bash&#10;curl -s https://ai.internal.corp/install | bash&#10;```"
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none font-mono" />
                </div>
                <button onClick={handleSaveHowto} className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  Save How-To Guide
                </button>
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
