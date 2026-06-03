import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
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
  transcript_status?: string | null;
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
  transcript_status?: string | null;
  course_id?: string | null;
}

export interface Course {
  id: string;
  slug: string;
  title?: string;
  description?: string | null;
  video_count?: number;
  thumbnail?: string | null;
}

export interface CourseProgress {
  course_id: string;
  course_slug: string;
  total_videos: number;
  completed_videos: number;
  progress_pct: number;
  is_enrolled: boolean;
}

const formatDuration = (s: number | null): string => {
  if (!s) return '10:00';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

let ALL_VIDEOS: Video[] = [];

const CATEGORIES = ['All', 'Code-mate', 'RAG', 'Agents', 'Deep Dive'];

// Heights for virtual list items
const HEADER_H = 41;
const VIDEO_H = 88;

type FlatItem =
  | { type: 'header'; courseId: string; courseName: string; videoCount: number }
  | { type: 'video'; video: Video; idx: number };

interface RowData {
  items: FlatItem[];
  activeVideoId: string;
  collapsedCourses: Set<string>;
  onSelectVideo: (v: Video) => void;
  onToggleCourse: (courseId: string) => void;
}

const Row = React.memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { items, activeVideoId, collapsedCourses, onSelectVideo, onToggleCourse } = data;
  const item = items[index];

  if (item.type === 'header') {
    const isCollapsed = collapsedCourses.has(item.courseId);
    return (
      <div style={style} className="bg-slate-50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-white/5">
        <button
          onClick={() => onToggleCourse(item.courseId)}
          className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
        >
          <span className={`material-symbols-outlined text-sm text-primary transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
            chevron_right
          </span>
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1 text-left truncate">
            {item.courseName}
          </span>
          <span className="text-[10px] text-slate-400 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
            {item.videoCount}
          </span>
        </button>
      </div>
    );
  }

  const { video, idx } = item;
  const isActive = video.id === activeVideoId;

  return (
    <div style={{ ...style, paddingLeft: 8, paddingRight: 8, paddingTop: 4 }}>
      <div
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
            {isActive
              ? <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
              : idx}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`text-sm mb-1 line-clamp-2 group-hover:text-primary transition-colors ${
              isActive ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-600 dark:text-slate-300'
            }`}>
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
          <button
            onClick={(e) => { e.stopPropagation(); onSelectVideo(video); }}
            className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              isActive
                ? 'bg-primary text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-primary hover:text-white'
            }`}
            title={`Play ${video.title}`}
          >
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
          </button>
        </div>
      </div>
    </div>
  );
});

interface IgniteSidebarProps {
  activeVideoId: string;
  onSelectVideo: (video: Video) => void;
  onBrowseCourses?: () => void;
  onCoursesLoaded?: (courses: Course[], progress: Record<string, CourseProgress>) => void;
}

export const IgniteSidebar: React.FC<IgniteSidebarProps> = ({
  activeVideoId,
  onSelectVideo,
  onBrowseCourses,
  onCoursesLoaded,
}) => {
  const { videoSlug: urlSlug } = useParams<{ videoSlug?: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [videos, setVideos] = useState<Video[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseNames, setCourseNames] = useState<Record<string, string>>({});
  const [videoCourseMap, setVideoCourseMap] = useState<Record<string, string>>({});
  // Default: all courses collapsed — user expands what they need
  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());
  const listRef = useRef<VariableSizeList<RowData>>(null);

  // Single load: 2 parallel cached requests
  useEffect(() => {
    Promise.all([
      api.get<Course[]>('/video/courses'),
      api.get<ApiVideo[]>('/video/videos'),
    ]).then(([courseList, apiVideos]) => {
      const names: Record<string, string> = {};
      courseList.forEach((c) => { names[c.id] = c.title || c.slug; });
      setCourses(courseList);
      setCourseNames(names);

      const vids: Video[] = apiVideos.map((v) => ({
        id: v.id, slug: v.slug, title: v.title, category: v.category,
        duration: formatDuration(v.duration_s), duration_s: v.duration_s,
        description: v.description, hls_path: v.hls_path, thumbnail: v.thumbnail,
        course_id: v.course_id || null, sort_order: v.sort_order,
        transcript_status: v.transcript_status,
      }));

      const vidCourse: Record<string, string> = {};
      vids.forEach((v) => { if (v.course_id) vidCourse[v.id] = v.course_id; });

      ALL_VIDEOS = vids;
      setVideos(vids);
      setVideoCourseMap(vidCourse);
      setLoaded(true);

      if (onCoursesLoaded) onCoursesLoaded(courseList, {});

      // Default: all courses collapsed; expand only the active one
      const allCollapsed = new Set(courseList.map((c) => c.id));

      if (urlSlug) {
        const match = vids.find((v) => v.slug === urlSlug);
        if (match) {
          onSelectVideo(match);
          if (match.course_id) allCollapsed.delete(match.course_id);
        }
      } else if (vids.length > 0) {
        onSelectVideo(vids[0]);
        if (vids[0].course_id) allCollapsed.delete(vids[0].course_id);
      }
      setCollapsedCourses(allCollapsed);
    }).catch(() => setLoaded(true));
  }, []);

  const toggleCourse = useCallback((courseId: string) => {
    setCollapsedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }, []);

  const allCourseIds = useMemo(() => courses.map((c) => c.id), [courses]);
  const allCollapsed = allCourseIds.length > 0 && allCourseIds.every((id) => collapsedCourses.has(id));
  const toggleCollapseAll = useCallback(() => {
    setCollapsedCourses(allCollapsed ? new Set() : new Set(allCourseIds));
  }, [allCollapsed, allCourseIds]);

  const filteredVideos = useMemo(() => videos.filter((v) => {
    const matchesCategory = activeCategory === 'All' || v.category === activeCategory;
    const matchesSearch = v.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }), [videos, activeCategory, searchQuery]);

  // Build grouped structure
  const groupedVideos = useMemo(() => {
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
    for (const course of courses) {
      const vids = courseMap.get(course.id);
      if (vids && vids.length > 0)
        groups.push({ courseId: course.id, courseName: courseNames[course.id] || 'Course', videos: vids });
    }
    if (uncategorized.length > 0)
      groups.push({ courseId: '__uncategorized__', courseName: 'Videos', videos: uncategorized });
    return groups;
  }, [filteredVideos, courses, courseNames, videoCourseMap]);

  // Flat item list for react-window
  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    let idx = 0;
    for (const group of groupedVideos) {
      items.push({ type: 'header', courseId: group.courseId, courseName: group.courseName, videoCount: group.videos.length });
      if (!collapsedCourses.has(group.courseId)) {
        for (const video of group.videos) {
          idx++;
          items.push({ type: 'video', video, idx });
        }
      }
    }
    return items;
  }, [groupedVideos, collapsedCourses]);

  // Reset list sizing cache when flat items change
  useEffect(() => {
    listRef.current?.resetAfterIndex(0, true);
  }, [flatItems]);

  const itemSize = useCallback((index: number) => {
    return flatItems[index]?.type === 'header' ? HEADER_H : VIDEO_H;
  }, [flatItems]);

  const listData = useMemo<RowData>(() => ({
    items: flatItems,
    activeVideoId,
    collapsedCourses,
    onSelectVideo,
    onToggleCourse: toggleCourse,
  }), [flatItems, activeVideoId, collapsedCourses, onSelectVideo, toggleCourse]);

  return (
    <aside className="w-80 bg-sidebar-light dark:bg-sidebar-dark border-r border-slate-200 dark:border-white/5 flex flex-col shrink-0 z-40 font-sans">
      {/* Top controls */}
      <div className="p-4 border-b border-slate-200 dark:border-white/5">
        {onBrowseCourses && (
          <button
            onClick={onBrowseCourses}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 mb-3 text-xs font-bold text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">grid_view</span>
            Browse Courses
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-500 text-lg">search</span>
            <input
              className="w-full bg-slate-100 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:ring-1 focus:ring-primary focus:border-primary transition-all"
              placeholder="Search videos..."
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            onClick={toggleCollapseAll}
            title={allCollapsed ? 'Expand all' : 'Collapse all'}
            className="shrink-0 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <span className="material-symbols-outlined text-xl">{allCollapsed ? 'unfold_more' : 'unfold_less'}</span>
          </button>
        </div>
      </div>

      {/* Category filters */}
      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-slate-200 dark:border-white/5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
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

      {/* Virtualized video list */}
      <div className="flex-1 min-h-0">
        {!loaded ? (
          <div className="flex items-center justify-center h-full">
            <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
          </div>
        ) : flatItems.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 block mb-3">video_library</span>
            <p className="text-sm font-medium text-text-muted">
              {searchQuery ? 'No videos match your search.' : 'No content available yet.'}
            </p>
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }) => (
              <VariableSizeList<RowData>
                ref={listRef}
                height={height}
                width={width}
                itemCount={flatItems.length}
                itemSize={itemSize}
                itemData={listData}
                overscanCount={8}
              >
                {Row}
              </VariableSizeList>
            )}
          </AutoSizer>
        )}
      </div>
    </aside>
  );
};

export { ALL_VIDEOS };
