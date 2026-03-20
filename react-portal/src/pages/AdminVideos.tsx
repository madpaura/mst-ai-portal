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

interface BannerConfig {
  id: string;
  video_id: string;
  variant: string;
  company_logo: string;
  series_tag: string;
  topic: string;
  subtopic: string;
  episode: string;
  duration: string;
  presenter: string;
  presenter_initial: string;
  status: string;
  banner_video_path: string | null;
  error: string | null;
}

type Tab = 'metadata' | 'chapters' | 'howto' | 'quality' | 'seed-notes' | 'banner' | 'trim';

export const AdminVideos: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('banner');
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

  // Banner
  const [bannerConfig, setBannerConfig] = useState<BannerConfig | null>(null);
  const [bannerForm, setBannerForm] = useState({
    variant: 'A', company_logo: 'SAMSUNG', series_tag: 'KNOWLEDGE SERIES',
    topic: '', subtopic: '', episode: 'EP 01', duration: '3:15',
    presenter: '', presenter_initial: '',
  });
  const [bannerGenerating, setBannerGenerating] = useState(false);
  const bannerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Trim
  const trimPlayerRef = useRef<HlsPlayerHandle>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimPlayerTime, setTrimPlayerTime] = useState(0);
  const [trimPlayerDuration, setTrimPlayerDuration] = useState(0);
  const [trimming, setTrimming] = useState(false);

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
    setActiveTab('banner');
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
          series_tag: banner.series_tag, topic: banner.topic,
          subtopic: banner.subtopic, episode: banner.episode,
          duration: banner.duration, presenter: banner.presenter,
          presenter_initial: banner.presenter_initial,
        });
        setBannerGenerating(banner.status === 'generating');
      } else {
        setBannerForm({
          variant: 'A', company_logo: 'SAMSUNG', series_tag: 'KNOWLEDGE SERIES',
          topic: video.title, subtopic: '', episode: 'EP 01', duration: '3:15',
          presenter: '', presenter_initial: '',
        });
        setBannerGenerating(false);
      }
    } catch {
      setBannerConfig(null);
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
      showMsg('success', `Trim started: ${trimStart}s — ${trimEnd}s. Video will re-transcode after trimming.`);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setTrimming(false);
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
              showMsg('success', 'Banner generated & prepended to video! Re-transcode queued.');
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

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (bannerPollRef.current) clearInterval(bannerPollRef.current);
    };
  }, []);

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
      let html = '';
      const logo = '<svg width="160" height="160" viewBox="0 0 72 72"><circle cx="36" cy="36" r="34" fill="'+(V==='B'?'rgba(255,255,255,0.08)':'#0d2d6b')+'"/><circle cx="36" cy="36" r="34" fill="none" stroke="'+(V==='B'?'rgba(255,255,255,0.2)':'#1e4282')+'" stroke-width="2"/><circle class="ring-pulse" cx="36" cy="36" r="34" fill="none" stroke="#e05018" stroke-width="1.5" opacity=".5"/><line class="bar1" x1="24.5" y1="23" x2="24.5" y2="49" stroke="#c03010" stroke-width="5" stroke-linecap="round"/><line class="bar2" x1="24.5" y1="23" x2="24.5" y2="49" stroke="#e85520" stroke-width="2.5" stroke-linecap="round"/><circle class="dot-pop" cx="24.5" cy="36" r="4.5" fill="#e06030"/><circle class="dot-pop" cx="24.5" cy="36" r="3" fill="#f07840" style="animation-delay:.84s"/><polygon class="tri-fade" points="28,23 50,36 28,49" fill="white"/></svg>';
      if(V==='A'){
        html='<div class="banner va"><div class="corner tl"></div><div class="corner br"></div><div class="hline t"></div><div class="hline b"></div><div class="samsung-top"><span class="samsung-text-lbl">'+P.company_logo+'</span></div><div class="center"><div class="icon-entrance">'+logo+'</div><div class="vdiv"></div><div><div class="brand">AI <span>Ignite</span></div><div class="stag">'+P.series_tag+'</div></div></div><div class="btm"><div class="bleft"><div class="topic">'+P.topic+'</div><div class="sub">'+P.subtopic+'</div></div><div class="bmid"><div class="pill ep">'+P.episode+'</div><div class="pill">'+P.duration+'</div></div><div class="bright"><div class="avatar">'+P.presenter_initial+'</div><div class="pname">'+P.presenter+'</div></div></div></div>';
      } else if(V==='B'){
        html='<div class="banner vb"><div class="lpanel"><span class="samsung-lbl">'+P.company_logo+'</span><div class="icon-entrance">'+logo+'</div><div class="brand-vb">AI <span>Ignite</span></div><div class="stag-vb">'+P.series_tag+'</div></div><div class="rpanel"><div style="display:flex;gap:16px;align-items:center"><div class="epbadge">'+P.episode+'</div><div class="durbadge">'+P.duration+'</div></div><div class="topic-vb">'+P.topic+'</div><div class="divh"></div><div class="sub-vb">'+P.subtopic+'</div><div style="display:flex;align-items:center;gap:20px;margin-top:8px"><div class="av-vb">'+P.presenter_initial+'</div><div><div class="pn-vb">'+P.presenter+'</div><div class="pd-vb">Presenter</div></div></div></div></div>';
      } else {
        html='<div class="banner vc"><div class="stripe-top"></div><div class="stripe-bot"></div><div class="samsung-vc"><span class="samsung-text-lbl">'+P.company_logo+'</span></div><div class="cblock"><div class="logo-row"><div class="icon-entrance">'+logo+'</div><div class="brand-vc">AI <span>Ignite</span></div></div><div class="topic-vc">'+P.topic+'</div><div class="sub-vc">'+P.subtopic+'</div><div class="meta-row"><span class="mi bold">'+P.episode+'</span><div class="mdot"></div><span class="mi">'+P.duration+'</span><div class="mdot"></div><span class="mi">'+P.presenter+'</span><div class="mdot"></div><span class="mi">'+P.series_tag+'</span></div></div></div>';
      }
      document.getElementById('root').innerHTML=html;
    <\/script></body></html>
  `;

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
              {(['banner', 'trim', 'metadata', 'chapters', 'howto', 'quality', 'seed-notes'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-all capitalize ${
                    activeTab === tab
                      ? 'text-white border-primary bg-primary/5'
                      : 'text-slate-400 hover:text-white border-transparent'
                  }`}
                >
                  {tab === 'seed-notes' ? 'Seed Notes' : tab === 'howto' ? 'How-To' : tab === 'banner' ? '🎬 Banner' : tab === 'trim' ? '✂️ Trim' : tab}
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

            {activeTab === 'trim' && (
              <div className="space-y-5">
                <p className="text-sm text-slate-400">Cut or trim the raw video to keep only the section between the start and end times. The original is backed up before the first trim.</p>

                {selected.hls_path ? (
                  <div>
                    <HlsPlayer
                      ref={trimPlayerRef}
                      hlsPath={selected.hls_path}
                      chapters={[]}
                      onTimeUpdate={(t, d) => { setTrimPlayerTime(t); setTrimPlayerDuration(d); }}
                      className="rounded-xl border border-white/10"
                    />

                    {/* Timeline with trim markers */}
                    <div className="mt-3 px-1">
                      <div className="relative w-full h-10 bg-slate-800/50 rounded-lg border border-white/5 overflow-hidden">
                        {/* Playhead */}
                        {trimPlayerDuration > 0 && (
                          <div
                            className="absolute top-0 h-full w-0.5 bg-white/60 z-20"
                            style={{ left: `${(trimPlayerTime / trimPlayerDuration) * 100}%` }}
                          />
                        )}
                        {/* Selected region */}
                        {trimPlayerDuration > 0 && trimEnd > trimStart && (
                          <div
                            className="absolute top-0 h-full bg-primary/20 border-x-2 border-primary/60 z-10"
                            style={{
                              left: `${(trimStart / trimPlayerDuration) * 100}%`,
                              width: `${((trimEnd - trimStart) / trimPlayerDuration) * 100}%`,
                            }}
                          />
                        )}
                        {/* Start marker */}
                        {trimPlayerDuration > 0 && (
                          <div
                            className="absolute top-0 h-full w-1 bg-green-400 z-15 cursor-pointer"
                            style={{ left: `${(trimStart / trimPlayerDuration) * 100}%` }}
                            title={`Start: ${formatDuration(trimStart)}`}
                          />
                        )}
                        {/* End marker */}
                        {trimPlayerDuration > 0 && trimEnd > 0 && (
                          <div
                            className="absolute top-0 h-full w-1 bg-red-400 z-15 cursor-pointer"
                            style={{ left: `${(trimEnd / trimPlayerDuration) * 100}%` }}
                            title={`End: ${formatDuration(trimEnd)}`}
                          />
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="font-mono text-[10px] text-slate-500">0:00</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          Current: {formatDuration(Math.floor(trimPlayerTime))}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">{formatDuration(Math.floor(trimPlayerDuration))}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-slate-800/30 border border-white/5 text-center">
                    <span className="material-symbols-outlined text-4xl text-slate-600 mb-2">videocam_off</span>
                    <p className="text-slate-500 text-sm">Upload and transcode a video first to use the trim tool.</p>
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
                    onClick={() => setTrimStart(Math.floor(trimPlayerTime * 10) / 10)}
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
                    onClick={() => setTrimEnd(Math.floor(trimPlayerTime * 10) / 10)}
                    className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold rounded-lg transition-colors border border-red-500/30"
                    title="Set end to current player position"
                  >
                    <span className="material-symbols-outlined text-sm">last_page</span>
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => { if (trimPlayerDuration > 0) { setTrimStart(0); setTrimEnd(Math.floor(trimPlayerDuration * 10) / 10); } }}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
                  >
                    Full Duration
                  </button>
                </div>

                {/* Summary & Execute */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/30 border border-white/5">
                  <div className="text-sm text-slate-300">
                    {trimEnd > trimStart ? (
                      <>
                        Keep <span className="font-bold text-white">{formatDuration(Math.floor(trimStart))}</span>
                        {' → '}
                        <span className="font-bold text-white">{formatDuration(Math.floor(trimEnd))}</span>
                        {' '}
                        <span className="text-slate-500">({formatDuration(Math.floor(trimEnd - trimStart))} duration)</span>
                      </>
                    ) : (
                      <span className="text-slate-500">Set start and end times to define the trim region</span>
                    )}
                  </div>
                  <button
                    onClick={handleTrim}
                    disabled={trimming || trimEnd <= trimStart}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-500 disabled:opacity-30 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    {trimming ? (
                      <>
                        <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                        Trimming...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">content_cut</span>
                        Trim Video
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
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Episode</label>
                          <input value={bannerForm.episode} onChange={(e) => setBannerForm((f) => ({ ...f, episode: e.target.value }))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Duration</label>
                          <input value={bannerForm.duration} onChange={(e) => setBannerForm((f) => ({ ...f, duration: e.target.value }))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
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
