import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { Navbar } from '../components/Navbar';
import { IgniteSidebar, ALL_VIDEOS } from '../components/IgniteSidebar';
import type { Video, Course, CourseProgress } from '../components/IgniteSidebar';
import { CourseBrowser } from '../components/CourseBrowser';
import type { CourseInfo } from '../components/CourseBrowser';
import { HlsPlayer, type HlsPlayerHandle } from '../components/HlsPlayer';
import { api } from '../api/client';
import { useAuth } from '../api/auth';

interface VideoLikeData {
  video_id: string;
  like_count: number;
  user_liked: boolean;
}

interface Chapter {
  id: string;
  video_id: string;
  title: string;
  start_time: number;
  sort_order: number;
}

interface Note {
  id: string;
  video_id: string;
  timestamp_s: number;
  content: string;
  is_seed: boolean;
  created_at: string;
}

interface HowtoGuide {
  id: string;
  video_id: string;
  title: string;
  content: string;
  version: string;
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

const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const Ignite: React.FC = () => {
  const { videoSlug } = useParams<{ videoSlug?: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const playerRef = useRef<HlsPlayerHandle>(null);
  const [activeVideo, setActiveVideo] = useState<Video | null>(ALL_VIDEOS[0] || null);
  const [shareCopied, setShareCopied] = useState(false);
  const [showContributeCTA, setShowContributeCTA] = useState(false);
  const [contributeRequest, setContributeRequest] = useState<{ status: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [activeTab, setActiveTab] = useState<'notes' | 'howto'>('howto');
  const [noteText, setNoteText] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [howto, setHowto] = useState<HowtoGuide | null>(null);
  const [likeData, setLikeData] = useState<VideoLikeData | null>(null);
  const [likePending, setLikePending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Guest email capture state
  const [showGuestEmailForm, setShowGuestEmailForm] = useState(false);
  const [guestEmail, setGuestEmail] = useState('');
  const [guestEmailSent, setGuestEmailSent] = useState(false);
  const [guestEmailSubmitting, setGuestEmailSubmitting] = useState(false);

  // Check contribute request status once auth has resolved
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setShowContributeCTA(true);
      return;
    }
    if (user.role === 'user') {
      setShowContributeCTA(true);
      api.get<{ status: string } | null>('/auth/contribute-request')
        .then(setContributeRequest)
        .catch(() => {});
    }
  }, [authLoading, user]);

  const handleGuestInterest = async () => {
    if (!guestEmail.trim() || guestEmailSubmitting) return;
    setGuestEmailSubmitting(true);
    try {
      await api.post('/auth/guest-interest', { email: guestEmail.trim(), source: 'contribute' });
      setGuestEmailSent(true);
      setShowGuestEmailForm(false);
    } catch { /* ignore */ }
    setGuestEmailSubmitting(false);
  };

  const loadVideoData = useCallback(async (video: Video) => {
    // Load chapters
    api.get<Chapter[]>(`/video/videos/${video.slug}/chapters`)
      .then(setChapters).catch(() => setChapters([]));
    // Load howto
    api.get<HowtoGuide | null>(`/video/videos/${video.slug}/howto`)
      .then(setHowto).catch(() => setHowto(null));
    // Load likes
    api.get<VideoLikeData>(`/video/videos/${video.slug}/likes`)
      .then(setLikeData).catch(() => setLikeData(null));
    // Load attachments
    api.get<Attachment[]>(`/video/videos/${video.slug}/attachments`)
      .then(setAttachments).catch(() => setAttachments([]));
    // Load notes (requires auth)
    if (!!user) {
      api.get<Note[]>(`/video/videos/${video.slug}/notes`)
        .then(setNotes).catch(() => setNotes([]));
    }
    // Track page view
    api.post('/analytics/pageview', { path: `/ignite/${video.slug}` }).catch(() => {});
  }, []);

  // If URL has a videoSlug, try to load that video
  useEffect(() => {
    if (!videoSlug) return;
    // Check if it's already in sidebar list
    const found = ALL_VIDEOS.find((v) => v.slug === videoSlug);
    if (found) {
      setActiveVideo(found);
    } else {
      // Fetch from API (may be a video not in current sidebar list)
      api.get<Video>(`/video/videos/${videoSlug}`)
        .then((v) => setActiveVideo(v))
        .catch(() => {}); // silently fail — might be invalid slug
    }
  }, [videoSlug]);

  useEffect(() => {
    if (activeVideo?.slug) loadVideoData(activeVideo);
  }, [activeVideo, loadVideoData]);

  // Resume from local cached position when video changes
  useEffect(() => {
    if (!activeVideo?.slug) return;
    // Clear any pending save timers from previous video
    if (progressSaveRef.current) {
      clearTimeout(progressSaveRef.current);
      progressSaveRef.current = null;
    }
    const savedPos = getLocalPosition(activeVideo.slug);
    if (savedPos > 5) {
      // Delay seek until player is ready (HLS manifest parsed)
      const timer = setTimeout(() => {
        playerRef.current?.seekTo(savedPos);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [activeVideo?.slug]);

  const handleSelectVideo = (video: Video) => {
    setActiveVideo(video);
    navigate(`/ignite/${video.slug}`, { replace: true });
  };

  const handleShare = async () => {
    if (!activeVideo?.slug) return;
    const url = `${window.location.origin}/ignite/${activeVideo.slug}`;
    if (navigator.share) {
      navigator.share({ title: activeVideo.title, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  // Local progress caching helpers
  const getLocalPosition = (slug: string): number => {
    try {
      const val = localStorage.getItem(`mst_vpos_${slug}`);
      return val ? parseFloat(val) : 0;
    } catch { return 0; }
  };

  const saveLocalPosition = useCallback((slug: string, time: number) => {
    try {
      localStorage.setItem(`mst_vpos_${slug}`, String(Math.floor(time)));
    } catch { /* ignore */ }
  }, []);

  const progressSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Course browser state
  const [showCourseBrowser, setShowCourseBrowser] = useState(false);
  const [allCourses, setAllCourses] = useState<CourseInfo[]>([]);

  const handleCoursesLoaded = useCallback((courses: Course[], _progress: Record<string, CourseProgress>) => {
    setAllCourses(courses.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title || c.slug,
      description: c.description ?? null,
      video_count: c.video_count ?? 0,
      thumbnail: c.thumbnail ?? null,
    })));
  }, []);

  const handleStartCourse = useCallback((courseSlug: string) => {
    // Find first video of this course and start playing it
    const courseId = allCourses.find((c) => c.slug === courseSlug)?.id;
    if (courseId) {
      const firstVideo = ALL_VIDEOS.find((v) => v.course_id === courseId);
      if (firstVideo) {
        setShowCourseBrowser(false);
        handleSelectVideo(firstVideo);
        return;
      }
    }
    setShowCourseBrowser(false);
  }, [allCourses]);

  const handleTimeUpdate = (time: number, dur: number) => {
    setCurrentTime(time);
    setVideoDuration(dur);
    const slug = activeVideo?.slug;
    if (!slug || time < 5) return;
    // Throttled save to localStorage every 5 seconds (works for all users)
    if (!progressSaveRef.current) {
      progressSaveRef.current = setTimeout(() => {
        progressSaveRef.current = null;
        saveLocalPosition(slug, time);
      }, 5000);
    }
  };

  const handleToggleLike = async () => {
    if (!activeVideo?.slug || likePending) return;
    setLikePending(true);
    try {
      if (likeData?.user_liked) {
        const res = await api.delete<VideoLikeData>(`/video/videos/${activeVideo.slug}/likes`);
        setLikeData(res);
      } else {
        const res = await api.post<VideoLikeData>(`/video/videos/${activeVideo.slug}/likes`);
        setLikeData(res);
      }
    } catch { /* ignore auth errors for non-logged-in users */ }
    setLikePending(false);
  };

  const handleChapterSeek = (startTime: number) => {
    playerRef.current?.seekTo(startTime);
    // Track chapter navigation
    const chapter = chapters.find(c => c.start_time === startTime);
    if (chapter && activeVideo) {
      api.post('/analytics/event', {
        event_type: 'chapter_navigate',
        section: 'ignite',
        entity_id: activeVideo.id,
        entity_name: chapter.title,
      }).catch(() => {});
    }
  };

  const handleSaveNote = async () => {
    if (!noteText.trim() || !activeVideo?.slug) return;
    try {
      const note = await api.post<Note>(`/video/videos/${activeVideo.slug}/notes`, {
        timestamp_s: Math.floor(currentTime),
        content: noteText.trim(),
      });
      setNotes((prev) => [...prev, note]);
      setNoteText('');
    } catch {
      // If not logged in, save locally
      setNotes((prev) => [...prev, {
        id: String(Date.now()),
        video_id: activeVideo.id,
        timestamp_s: 0,
        content: noteText.trim(),
        is_seed: false,
        created_at: new Date().toISOString(),
      }]);
      setNoteText('');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await api.delete(`/video/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch { /* ignore */ }
  };

  const handleTabClick = (tab: 'notes' | 'howto') => setActiveTab(tab);

  // Prev/next video within the same course
  const courseVideos = activeVideo?.course_id
    ? ALL_VIDEOS.filter((v) => v.course_id === activeVideo.course_id).sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const activeVideoIdx = courseVideos.findIndex((v) => v.id === activeVideo?.id);
  const prevVideo = activeVideoIdx > 0 ? courseVideos[activeVideoIdx - 1] : null;
  const nextVideo = activeVideoIdx >= 0 && activeVideoIdx < courseVideos.length - 1 ? courseVideos[activeVideoIdx + 1] : null;
  const handleFormatBold = () => {};
  const handleFormatCode = () => {};
  const handleFormatList = () => {};

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen flex flex-col font-sans">
      <Navbar variant="solutions" />

      <div className="flex flex-1 overflow-hidden pt-16">
        <IgniteSidebar
          activeVideoId={activeVideo?.id || ''}
          onSelectVideo={(v) => { setShowCourseBrowser(false); handleSelectVideo(v); }}
          onBrowseCourses={() => setShowCourseBrowser(true)}
          onCoursesLoaded={handleCoursesLoaded}
        />

        <main className="flex-1 overflow-y-auto bg-background-light dark:bg-background-dark relative p-6 lg:p-10">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

          {/* Course browser overlay */}
          {showCourseBrowser && (
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                {activeVideo && (
                  <button
                    onClick={() => setShowCourseBrowser(false)}
                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    Back to Video
                  </button>
                )}
              </div>
              <CourseBrowser
                courses={allCourses}
                onStartCourse={handleStartCourse}
              />
            </div>
          )}

          <div className={`max-w-7xl mx-auto flex flex-col gap-8 relative z-10 ${showCourseBrowser ? 'hidden' : ''}`}>
            {/* Interested in Contributing? CTA — shown to all users */}
            {showContributeCTA && (
              <div className="flex flex-col gap-2 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary text-xl">volunteer_activism</span>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">Interested in contributing?</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {!!!user
                          ? guestEmailSent
                            ? 'Thanks! We\'ll be in touch soon.'
                            : 'Share your email and we\'ll reach out about becoming a content creator.'
                          : contributeRequest?.status === 'pending'
                          ? 'Your contribution request is pending admin review.'
                          : contributeRequest?.status === 'rejected'
                          ? 'Your previous request was not approved. You may reapply.'
                          : 'Become a content creator — share videos, articles, and marketplace components.'}
                      </p>
                    </div>
                  </div>
                  {/* Logged-in user actions */}
                  {!!user && (!contributeRequest || contributeRequest.status === 'rejected') && (
                    <button
                      onClick={() => navigate('/contribute')}
                      className="shrink-0 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Apply Now
                    </button>
                  )}
                  {!!user && contributeRequest?.status === 'pending' && (
                    <span className="shrink-0 px-3 py-1.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-bold rounded-lg">
                      Under Review
                    </span>
                  )}
                  {/* Non-logged-in actions */}
                  {!!!user && !guestEmailSent && (
                    <button
                      onClick={() => setShowGuestEmailForm(!showGuestEmailForm)}
                      className="shrink-0 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Apply Now
                    </button>
                  )}
                </div>
                {/* Inline email form for guests */}
                {!!!user && showGuestEmailForm && !guestEmailSent && (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleGuestInterest()}
                      placeholder="your@email.com"
                      className="flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                    <button
                      onClick={handleGuestInterest}
                      disabled={guestEmailSubmitting || !guestEmail.trim()}
                      className="shrink-0 px-4 py-1.5 bg-primary hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                    >
                      {guestEmailSubmitting ? 'Sending...' : 'Submit'}
                    </button>
                    <button
                      onClick={() => setShowGuestEmailForm(false)}
                      className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* No content message when no video is selected */}
            {!activeVideo && (
              <div className="flex flex-col items-center justify-center py-24">
                <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">video_library</span>
                <h2 className="text-xl font-bold text-slate-400 dark:text-slate-500 mb-2">No Content Available</h2>
                <p className="text-sm text-slate-400 dark:text-slate-500">Training videos will appear here once published by an admin.</p>
              </div>
            )}

            {/* Video Player + Chapters Side by Side — only show when video content exists */}
            {activeVideo?.hls_path && (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 min-w-0">
                <HlsPlayer
                  ref={playerRef}
                  hlsPath={activeVideo.hls_path}
                  chapters={chapters}
                  onTimeUpdate={handleTimeUpdate}
                  className="shadow-2xl border border-slate-300 dark:border-slate-800"
                />
              </div>

              {/* Chapters Panel */}
              <div className="w-full lg:w-[300px] shrink-0 bg-card-light dark:bg-card-dark border border-slate-400 dark:border-white/5 rounded-xl overflow-hidden flex flex-col max-h-[500px]">
                <div className="p-4 border-b border-slate-400 dark:border-white/5 bg-slate-50 dark:bg-slate-800/20">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-primary">format_list_bulleted</span>
                    Video Chapters
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {chapters.length > 0 ? (
                    <div className="space-y-1">
                      {chapters.map((chapter) => {
                        const isActive = currentTime >= chapter.start_time &&
                          !chapters.find((c) => c.start_time > chapter.start_time && currentTime >= c.start_time);
                        return (
                          <button
                            key={chapter.id}
                            onClick={() => handleChapterSeek(chapter.start_time)}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors text-left ${
                              isActive
                                ? 'bg-primary/10 border border-primary/20'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 border border-transparent'
                            }`}
                          >
                            <span className="font-mono text-xs text-primary min-w-[36px]">{fmtTime(chapter.start_time)}</span>
                            <span className={`text-sm leading-tight ${isActive ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                              {chapter.title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm text-center py-4">No chapters available yet.</p>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Course video navigation */}
            {(prevVideo || nextVideo) && (
              <div className="flex items-stretch gap-3">
                <button
                  onClick={() => prevVideo && handleSelectVideo(prevVideo)}
                  disabled={!prevVideo}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all flex-1 text-left ${
                    prevVideo
                      ? 'border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800/40 hover:bg-primary/5 dark:hover:bg-primary/10 hover:border-primary/30 group'
                      : 'border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/20 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <span className="material-symbols-outlined text-xl text-slate-400 group-hover:text-primary transition-colors shrink-0">arrow_back</span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Previous</p>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{prevVideo?.title ?? ''}</p>
                  </div>
                </button>
                <button
                  onClick={() => nextVideo && handleSelectVideo(nextVideo)}
                  disabled={!nextVideo}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all flex-1 text-right justify-end ${
                    nextVideo
                      ? 'border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800/40 hover:bg-primary/5 dark:hover:bg-primary/10 hover:border-primary/30 group'
                      : 'border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/20 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Next</p>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{nextVideo?.title ?? ''}</p>
                  </div>
                  <span className="material-symbols-outlined text-xl text-slate-400 group-hover:text-primary transition-colors shrink-0">arrow_forward</span>
                </button>
              </div>
            )}

            {/* Video Info & Tabs */}
            {activeVideo && (
            <div className="flex flex-col gap-6">
              <div>
                <span className="inline-block px-2 py-1 rounded bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider mb-2">
                  {activeVideo.category}
                </span>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">{activeVideo.title}</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Learn how to properly configure your environment for the {activeVideo.category} AI assistant.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleToggleLike}
                      disabled={likePending}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all duration-200 group ${
                        likeData?.user_liked
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-500 hover:bg-rose-500/20'
                          : 'bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-500'
                      } ${likePending ? 'opacity-60 cursor-wait' : ''}`}
                    >
                      <span className={`material-symbols-outlined text-xl transition-transform duration-200 ${likeData?.user_liked ? 'scale-110' : 'group-hover:scale-110'}`}
                        style={{ fontVariationSettings: likeData?.user_liked ? "'FILL' 1" : "'FILL' 0" }}
                      >
                        favorite
                      </span>
                      <span className="text-sm font-bold">{likeData?.like_count ?? 0}</span>
                    </button>
                    <button
                      onClick={handleShare}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all duration-200 group"
                    >
                      <span className="material-symbols-outlined text-xl group-hover:scale-110 transition-transform duration-200">share</span>
                      <span className="text-sm font-bold">{shareCopied ? 'Copied!' : 'Share'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="bg-card-light dark:bg-card-dark border border-slate-400 dark:border-white/5 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-base text-primary">attach_file</span>
                    Attachments
                  </h3>
                  <div className="flex flex-wrap gap-2">
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
                      const apiBase = import.meta.env.VITE_API_URL || '';
                      return (
                        <a
                          key={att.id}
                          href={`${apiBase}${att.download_url}`}
                          download={att.display_name || att.filename}
                          className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 dark:bg-slate-800/40 hover:bg-primary/5 dark:hover:bg-primary/10 border border-slate-200 dark:border-white/10 hover:border-primary/30 rounded-lg transition-all group"
                        >
                          <span className="material-symbols-outlined text-lg text-primary">{icon}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[180px]">{att.display_name || att.filename}</p>
                            <p className="text-[10px] text-slate-400">{sizeStr}</p>
                          </div>
                          <span className="material-symbols-outlined text-sm text-slate-400 group-hover:text-primary transition-colors">download</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tab Navigation */}
              <div className="flex items-center gap-1 border-b border-slate-300 dark:border-white/10">
                {/* Notes tab hidden — feature disabled for now */}
                {false && <button
                  onClick={() => handleTabClick('notes')}
                  className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-lg transition-all flex items-center gap-2 ${
                    activeTab === 'notes'
                      ? 'text-primary border-primary bg-primary/5 font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  Notes
                </button>}
                <button
                  onClick={() => handleTabClick('howto')}
                  className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-lg transition-all flex items-center gap-2 ${
                    activeTab === 'howto'
                      ? 'text-primary border-primary bg-primary/5 font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">description</span>
                  How to
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'notes' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Notes List */}
                  <div className="col-span-1 bg-card-light dark:bg-card-dark border border-slate-400 dark:border-white/5 rounded-xl overflow-hidden flex flex-col h-[400px]">
                    <div className="p-4 border-b border-slate-400 dark:border-white/5 bg-slate-50 dark:bg-slate-800/20">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Your Notes</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {notes.map((note) => (
                        <div
                          key={note.id}
                          className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-400 dark:border-white/5 hover:border-primary/30 transition-colors group/note"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-primary px-1.5 py-0.5 bg-primary/10 rounded">
                                {fmtTime(note.timestamp_s)}
                              </span>
                              {note.is_seed && <span className="text-[9px] text-amber-400 bg-amber-400/10 px-1 rounded">seed</span>}
                            </div>
                            {!note.is_seed && (
                              <button
                                onClick={() => handleDeleteNote(note.id)}
                                className="text-red-400/0 group-hover/note:text-red-400/50 hover:!text-red-400 transition-colors"
                              >
                                <span className="material-symbols-outlined text-sm">close</span>
                              </button>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-300">{note.content}</p>
                        </div>
                      ))}
                      {notes.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No notes yet</p>}
                    </div>
                  </div>

                  {/* Note Editor */}
                  <div className="col-span-1 md:col-span-2 bg-card-light dark:bg-card-dark border border-slate-400 dark:border-white/5 rounded-xl overflow-hidden flex flex-col h-[400px]">
                    <div className="p-4 border-b border-slate-400 dark:border-white/5 bg-slate-50 dark:bg-slate-800/20 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-accent px-2 py-1 bg-accent/10 rounded border border-accent/20">
                          {fmtTime(currentTime)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 border border-slate-300 dark:border-white/10 rounded-lg p-1 bg-slate-100 dark:bg-slate-900/50">
                        <button
                          onClick={handleFormatBold}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        >
                          <span className="material-symbols-outlined text-[18px]">format_bold</span>
                        </button>
                        <button
                          onClick={handleFormatCode}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        >
                          <span className="material-symbols-outlined text-[18px]">code</span>
                        </button>
                        <button
                          onClick={handleFormatList}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        >
                          <span className="material-symbols-outlined text-[18px]">format_list_bulleted</span>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 p-4">
                      <textarea
                        className="w-full h-full bg-transparent border-none resize-none text-slate-900 dark:text-white placeholder-slate-500 focus:ring-0 text-sm outline-none"
                        placeholder={`Take a note at ${fmtTime(currentTime)} / ${fmtTime(videoDuration)}...`}
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                      />
                    </div>
                    <div className="p-4 border-t border-slate-300 dark:border-white/5 bg-slate-50 dark:bg-slate-800/20 flex justify-end">
                      <button
                        onClick={handleSaveNote}
                        className="px-6 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors neon-glow flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[18px]">save</span>
                        Save Note
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'howto' && (
                <div className="bg-card-light dark:bg-card-dark border border-slate-400 dark:border-white/5 rounded-xl overflow-hidden p-6">
                  {howto ? (
                    <>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{howto.title}</h3>
                      <div className="howto-markdown text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight, rehypeRaw]}
                        >
                          {howto.content}
                        </ReactMarkdown>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">How-To Guide</h3>
                      <p className="text-slate-500 text-sm">No how-to guide available for this video yet.</p>
                    </>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
          {/* End of video content area (hidden when course browser is open) */}
        </main>
      </div>
    </div>
  );
};
