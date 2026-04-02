import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

export interface Video {
  id: string;
  slug: string;
  title: string;
  category: string;
  duration: string;
  duration_s: number | null;
  description: string | null;
  hls_path: string | null;
  thumbnail: string | null;
  course_id?: string | null;
  sort_order: number;
}

interface ApiVideo {
  id: string;
  slug: string;
  title: string;
  category: string;
  duration_s: number | null;
  description: string | null;
  hls_path: string | null;
  thumbnail: string | null;
  status: string;
  is_published: boolean;
  sort_order: number;
  created_at: string;
}

const formatDuration = (s: number | null): string => {
  if (!s) return '10:00';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

let ALL_VIDEOS: Video[] = [];

const CATEGORIES = ['All', 'Code-mate', 'RAG', 'Agents', 'Deep Dive'];

interface IgniteSidebarProps {
  activeVideoId: string;
  onSelectVideo: (video: Video) => void;
}

export const IgniteSidebar: React.FC<IgniteSidebarProps> = ({ activeVideoId, onSelectVideo }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [videos, setVideos] = useState<Video[]>(ALL_VIDEOS);
  const [loaded, setLoaded] = useState(false);
  const [courseNames, setCourseNames] = useState<Record<string, string>>({});
  const [videoCourseMap, setVideoCourseMap] = useState<Record<string, string>>({});
  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<Array<{ id: string; slug: string; title?: string }>>('/video/courses')
      .then(async (courses) => {
        const allVids: Video[] = [];
        const names: Record<string, string> = {};
        const vidCourse: Record<string, string> = {};
        for (const course of courses) {
          names[course.id] = course.title || course.slug;
          try {
            const data = await api.get<{ videos: ApiVideo[] }>(`/video/courses/${course.slug}`);
            for (const v of data.videos) {
              vidCourse[v.id] = course.id;
            }
            allVids.push(
              ...data.videos.map((v) => ({
                id: v.id,
                slug: v.slug,
                title: v.title,
                category: v.category,
                duration: formatDuration(v.duration_s),
                duration_s: v.duration_s,
                description: v.description,
                hls_path: v.hls_path,
                thumbnail: v.thumbnail,
                course_id: course.id,
                sort_order: v.sort_order,
              }))
            );
          } catch { /* ignore */ }
        }
        setCourseNames(names);
        setVideoCourseMap(vidCourse);
        ALL_VIDEOS = allVids;
        setVideos(allVids);
        if (allVids.length > 0 && !allVids.find((v) => v.id === activeVideoId)) {
          onSelectVideo(allVids[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleCategoryFilter = (category: string) => {
    setActiveCategory(category);
  };

  const toggleCourseCollapse = (courseId: string) => {
    setCollapsedCourses(prev => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const filteredVideos = videos.filter((v) => {
    const matchesCategory = activeCategory === 'All' || v.category === activeCategory;
    const matchesSearch = v.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Group filtered videos by course
  const groupedVideos = (() => {
    const groups: { courseId: string; courseName: string; videos: Video[] }[] = [];
    const courseMap = new Map<string, Video[]>();
    const uncategorized: Video[] = [];
    for (const v of filteredVideos) {
      const cId = videoCourseMap[v.id];
      if (cId) {
        if (!courseMap.has(cId)) courseMap.set(cId, []);
        courseMap.get(cId)!.push(v);
      } else {
        uncategorized.push(v);
      }
    }
    for (const [cId, vids] of courseMap.entries()) {
      groups.push({ courseId: cId, courseName: courseNames[cId] || 'Course', videos: vids });
    }
    if (uncategorized.length > 0) {
      groups.push({ courseId: '__uncategorized__', courseName: 'Videos', videos: uncategorized });
    }
    return groups;
  })();

  let globalIdx = 0;

  return (
    <aside className="w-80 bg-sidebar-light dark:bg-sidebar-dark border-r border-slate-200 dark:border-white/5 flex flex-col shrink-0 z-40 font-sans">
      <div className="p-4 border-b border-slate-200 dark:border-white/5">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-500 text-lg">search</span>
          <input
            className="w-full bg-slate-100 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:ring-1 focus:ring-primary focus:border-primary transition-all"
            placeholder="Search videos..."
            type="text"
            value={searchQuery}
            onChange={handleSearch}
          />
        </div>
      </div>

      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-slate-200 dark:border-white/5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategoryFilter(cat)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-white neon-glow'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {groupedVideos.map((group) => {
          const isCollapsed = collapsedCourses.has(group.courseId);
          return (
            <div key={group.courseId}>
              {/* Course header with expand/collapse */}
              <button
                onClick={() => toggleCourseCollapse(group.courseId)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors sticky top-0 z-10"
              >
                <span className={`material-symbols-outlined text-sm text-primary transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
                  chevron_right
                </span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1 text-left truncate">
                  {group.courseName}
                </span>
                <span className="text-[10px] text-slate-400 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
                  {group.videos.length}
                </span>
              </button>
              {/* Videos in this course */}
              {!isCollapsed && (
                <div className="p-2 space-y-1.5">
                  {group.videos.map((video) => {
                    globalIdx++;
                    const isActive = video.id === activeVideoId;
                    return (
                      <div
                        key={video.id}
                        onClick={() => onSelectVideo(video)}
                        className={`p-3 rounded-xl cursor-pointer group transition-all ${
                          isActive
                            ? 'active-lesson bg-primary/5 border border-primary/20'
                            : 'border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:border-slate-200 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                              isActive
                                ? 'bg-primary text-white shadow-[0_0_10px_rgba(37,140,244,0.5)]'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                            }`}
                          >
                            {globalIdx}
                          </div>
                          <div className="flex-1">
                            <h3
                              className={`text-sm mb-1 group-hover:text-primary transition-colors ${
                                isActive ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {video.title}
                            </h3>
                            <div className={`flex items-center gap-2 text-[10px] ${isActive ? 'text-slate-400' : 'text-slate-500 group-hover:text-slate-400'}`}>
                              <span className={`px-1.5 rounded border ${isActive ? 'bg-primary/10 text-primary border-primary/20' : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700'}`}>
                                {video.category}
                              </span>
                              <span>&bull;</span>
                              <span>{video.duration}</span>
                            </div>
                          </div>
                          {isActive && (
                            <span className="material-symbols-outlined text-primary text-lg animate-pulse">play_circle</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {filteredVideos.length === 0 && loaded && (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 block mb-3">video_library</span>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
              {searchQuery ? 'No videos match your search.' : 'No content available yet.'}
            </p>
            {!searchQuery && (
              <p className="text-xs text-slate-400 dark:text-slate-500">Videos will appear here once published by an admin.</p>
            )}
          </div>
        )}
        {!loaded && (
          <div className="flex items-center justify-center py-12">
            <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
          </div>
        )}
      </div>
    </aside>
  );
};

export { ALL_VIDEOS };
