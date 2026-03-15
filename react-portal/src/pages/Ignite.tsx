import React, { useState, useEffect, useCallback, useRef } from 'react';
import { IgniteHeader } from '../components/IgniteHeader';
import { IgniteSidebar, ALL_VIDEOS } from '../components/IgniteSidebar';
import type { Video } from '../components/IgniteSidebar';
import { HlsPlayer, type HlsPlayerHandle } from '../components/HlsPlayer';
import { api } from '../api/client';
import { isLoggedIn } from '../api/client';

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

const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const Ignite: React.FC = () => {
  const playerRef = useRef<HlsPlayerHandle>(null);
  const [activeVideo, setActiveVideo] = useState<Video>(ALL_VIDEOS[0]);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [activeTab, setActiveTab] = useState<'chapters' | 'notes' | 'howto'>('notes');
  const [noteText, setNoteText] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [howto, setHowto] = useState<HowtoGuide | null>(null);

  const loadVideoData = useCallback(async (video: Video) => {
    // Load chapters
    api.get<Chapter[]>(`/video/videos/${video.slug}/chapters`)
      .then(setChapters).catch(() => setChapters([]));
    // Load howto
    api.get<HowtoGuide | null>(`/video/videos/${video.slug}/howto`)
      .then(setHowto).catch(() => setHowto(null));
    // Load notes (requires auth)
    if (isLoggedIn()) {
      api.get<Note[]>(`/video/videos/${video.slug}/notes`)
        .then(setNotes).catch(() => setNotes([]));
    }
  }, []);

  useEffect(() => {
    if (activeVideo?.slug) loadVideoData(activeVideo);
  }, [activeVideo, loadVideoData]);

  const handleSelectVideo = (video: Video) => {
    setActiveVideo(video);
  };

  const handleTimeUpdate = (time: number, dur: number) => {
    setCurrentTime(time);
    setVideoDuration(dur);
  };

  const handleChapterSeek = (startTime: number) => {
    playerRef.current?.seekTo(startTime);
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

  const handleTabClick = (tab: 'chapters' | 'notes' | 'howto') => setActiveTab(tab);
  const handleFormatBold = () => {};
  const handleFormatCode = () => {};
  const handleFormatList = () => {};

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen flex flex-col">
      <IgniteHeader notesTaken={notes.length} />

      <div className="flex flex-1 overflow-hidden">
        <IgniteSidebar activeVideoId={activeVideo.id} onSelectVideo={handleSelectVideo} />

        <main className="flex-1 overflow-y-auto bg-background-light dark:bg-background-dark relative p-6 lg:p-10">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

          <div className="max-w-5xl mx-auto flex flex-col gap-8 relative z-10">
            {/* Video Player */}
            <HlsPlayer
              ref={playerRef}
              hlsPath={activeVideo.hls_path}
              chapters={chapters}
              onTimeUpdate={handleTimeUpdate}
              className="shadow-2xl border border-slate-300 dark:border-slate-800"
            />

            {/* Video Info & Tabs */}
            <div className="flex flex-col gap-6">
              <div>
                <span className="inline-block px-2 py-1 rounded bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider mb-2">
                  {activeVideo.category}
                </span>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">{activeVideo.title}</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  Learn how to properly configure your environment for the {activeVideo.category} AI assistant.
                </p>
              </div>

              {/* Tab Navigation */}
              <div className="flex items-center gap-1 border-b border-slate-300 dark:border-white/10">
                <button
                  onClick={() => handleTabClick('chapters')}
                  className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-lg transition-all flex items-center gap-2 ${
                    activeTab === 'chapters'
                      ? 'text-primary border-primary bg-primary/5 font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">format_list_bulleted</span>
                  Chapters
                </button>
                <button
                  onClick={() => handleTabClick('notes')}
                  className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-lg transition-all flex items-center gap-2 ${
                    activeTab === 'notes'
                      ? 'text-primary border-primary bg-primary/5 font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  Notes
                </button>
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

              {activeTab === 'chapters' && (
                <div className="bg-card-light dark:bg-card-dark border border-slate-400 dark:border-white/5 rounded-xl overflow-hidden p-6">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Video Chapters</h3>
                  {chapters.length > 0 ? (
                    <div className="space-y-3">
                      {chapters.map((chapter) => {
                        const isActive = currentTime >= chapter.start_time &&
                          !chapters.find((c) => c.start_time > chapter.start_time && currentTime >= c.start_time);
                        return (
                          <button
                            key={chapter.id}
                            onClick={() => handleChapterSeek(chapter.start_time)}
                            className={`w-full flex items-center gap-4 p-3 rounded-lg transition-colors ${
                              isActive
                                ? 'bg-primary/10 border border-primary/20'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 border border-transparent'
                            }`}
                          >
                            <span className="font-mono text-xs text-primary min-w-[40px]">{fmtTime(chapter.start_time)}</span>
                            <span className={`text-sm ${isActive ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                              {chapter.title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm">No chapters available for this video yet.</p>
                  )}
                </div>
              )}

              {activeTab === 'howto' && (
                <div className="bg-card-light dark:bg-card-dark border border-slate-400 dark:border-white/5 rounded-xl overflow-hidden p-6">
                  {howto ? (
                    <>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{howto.title}</h3>
                      <div className="prose dark:prose-invert prose-sm max-w-none">
                        <pre className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{howto.content}</pre>
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
          </div>
        </main>
      </div>
    </div>
  );
};
