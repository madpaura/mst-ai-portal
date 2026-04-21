import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

interface SolutionCard {
  id: string;
  title: string;
  subtitle: string | null;
  description: string;
  long_description: string | null;
  icon: string;
  icon_color: string;
  badge: string | null;
  link_url: string | null;
  launch_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  source: string;
  source_url: string | null;
  badge: string | null;
  is_active: boolean;
  published_at: string;
  created_at: string;
}

interface CardForm {
  title: string;
  subtitle: string;
  description: string;
  long_description: string;
  icon: string;
  icon_color: string;
  badge: string;
  link_url: string;
  launch_url: string;
  sort_order: number;
}

interface NewsForm {
  title: string;
  summary: string;
  content: string;
  source: string;
  source_url: string;
  badge: string;
}

interface LandingFeature {
  title: string;
  description: string;
}

interface LandingConfig {
  video_id: string | null;
  highlights: LandingFeature[];
}

interface Video {
  id: string;
  title: string;
}


const EMPTY_CARD: CardForm = {
  title: '', subtitle: '', description: '', long_description: '',
  icon: 'smart_toy', icon_color: 'text-primary', badge: '', link_url: '', launch_url: '', sort_order: 0,
};

const EMPTY_NEWS: NewsForm = {
  title: '', summary: '', content: '', source: 'manual', source_url: '', badge: '',
};

const ICON_OPTIONS = [
  'smart_toy', 'terminal', 'fact_check', 'developer_board', 'monitoring',
  'architecture', 'psychology', 'code', 'memory', 'hub', 'bolt',
  'integration_instructions', 'bug_report', 'auto_timer', 'energy_savings_leaf',
];

const COLOR_OPTIONS = [
  { label: 'Blue', value: 'text-primary' },
  { label: 'Green', value: 'text-green-500' },
  { label: 'Amber', value: 'text-amber-500' },
  { label: 'Purple', value: 'text-purple-500' },
  { label: 'Rose', value: 'text-rose-500' },
  { label: 'Cyan', value: 'text-cyan-500' },
  { label: 'Indigo', value: 'text-indigo-500' },
];

export const AdminSolutions: React.FC = () => {
  const [tab, setTab] = useState<'cards' | 'news' | 'landing'>('cards');
  const [cards, setCards] = useState<SolutionCard[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  
  const [landingConfig, setLandingConfig] = useState<LandingConfig>({ video_id: null, highlights: [] });
  const [savingLanding, setSavingLanding] = useState(false);
  
  const [loading, setLoading] = useState(true);

  // Card form state
  const [editingCard, setEditingCard] = useState<SolutionCard | null>(null);
  const [creatingCard, setCreatingCard] = useState(false);
  const [cardForm, setCardForm] = useState<CardForm>(EMPTY_CARD);

  // News form state
  const [editingNews, setEditingNews] = useState<NewsItem | null>(null);
  const [creatingNews, setCreatingNews] = useState(false);
  const [newsForm, setNewsForm] = useState<NewsForm>(EMPTY_NEWS);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [beautifying, setBeautifying] = useState<string | null>(null);

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

  const fetchCards = useCallback(async () => {
    try {
      const data = await api.get<SolutionCard[]>('/admin/solutions/solution-cards');
      setCards(data);
    } catch (err: any) {
      showMsg('error', err.message);
    }
  }, []);

  const fetchNews = useCallback(async () => {
    try {
      const data = await api.get<NewsItem[]>('/admin/solutions/news');
      setNews(data);
    } catch (err: any) {
      showMsg('error', err.message);
    }
  }, []);

  const fetchLandingConfig = useCallback(async () => {
    try {
      const vids = await api.get<Video[]>('/admin/videos');
      setVideos(vids);
      const conf = await api.get<LandingConfig | null>('/settings/landing_page');
      if (conf) setLandingConfig(conf);
      else setLandingConfig({
        video_id: null,
        highlights: [
          { title: 'Describe the spec', description: 'Provide natural language or architectural block diagrams to initialize the agent.' },
          { title: 'Agent generates RTL', description: 'The AI constructs syntactically correct and vendor-compliant Verilog/SystemVerilog.' },
          { title: 'Real-time validation', description: 'Instant syntax checks and logical verification against existing design constraints.' },
        ],
      });
    } catch (err: any) {
      console.warn('Failed to load setting', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchCards(), fetchNews(), fetchLandingConfig()]).finally(() => setLoading(false));
  }, [fetchCards, fetchNews, fetchLandingConfig]);

  // ── Card handlers ──────────────────────────────────────
  const openCreateCard = () => {
    setEditingCard(null);
    setCardForm(EMPTY_CARD);
    setCreatingCard(true);
  };

  const openEditCard = (card: SolutionCard) => {
    setCreatingCard(false);
    setEditingCard(card);
    setCardForm({
      title: card.title,
      subtitle: card.subtitle || '',
      description: card.description,
      long_description: card.long_description || '',
      icon: card.icon,
      icon_color: card.icon_color,
      badge: card.badge || '',
      link_url: card.link_url || '',
      launch_url: card.launch_url || '',
      sort_order: card.sort_order,
    });
  };

  const closeCardForm = () => {
    setCreatingCard(false);
    setEditingCard(null);
    setCardForm(EMPTY_CARD);
  };

  const handleSaveCard = async () => {
    const payload = {
      ...cardForm,
      subtitle: cardForm.subtitle || null,
      long_description: cardForm.long_description || null,
      badge: cardForm.badge || null,
      link_url: cardForm.link_url || null,
      launch_url: cardForm.launch_url || null,
    };
    try {
      if (creatingCard) {
        await api.post('/admin/solutions/solution-cards', payload);
        showMsg('success', 'Solution card created');
      } else if (editingCard) {
        await api.put(`/admin/solutions/solution-cards/${editingCard.id}`, payload);
        showMsg('success', 'Solution card updated');
      }
      closeCardForm();
      await fetchCards();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteCard = async (card: SolutionCard) => {
    if (!confirm(`Delete "${card.title}"?`)) return;
    try {
      await api.delete(`/admin/solutions/solution-cards/${card.id}`);
      await fetchCards();
      showMsg('success', 'Solution card deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  // ── News handlers ──────────────────────────────────────
  const openCreateNews = () => {
    setEditingNews(null);
    setNewsForm(EMPTY_NEWS);
    setCreatingNews(true);
  };

  const openEditNews = (item: NewsItem) => {
    setCreatingNews(false);
    setEditingNews(item);
    setNewsForm({
      title: item.title,
      summary: item.summary,
      content: item.content || '',
      source: item.source,
      source_url: item.source_url || '',
      badge: item.badge || '',
    });
  };

  const closeNewsForm = () => {
    setCreatingNews(false);
    setEditingNews(null);
    setNewsForm(EMPTY_NEWS);
  };

  const handleSaveNews = async () => {
    const payload = {
      ...newsForm,
      content: newsForm.content || null,
      source_url: newsForm.source_url || null,
      badge: newsForm.badge || null,
    };
    try {
      if (creatingNews) {
        await api.post('/admin/solutions/news', payload);
        showMsg('success', 'News item created');
      } else if (editingNews) {
        await api.put(`/admin/solutions/news/${editingNews.id}`, payload);
        showMsg('success', 'News item updated');
      }
      closeNewsForm();
      await fetchNews();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteNews = async (item: NewsItem) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    try {
      await api.delete(`/admin/solutions/news/${item.id}`);
      await fetchNews();
      showMsg('success', 'News item deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSaveLanding = async () => {
    setSavingLanding(true);
    try {
      await api.put('/settings/admin/landing_page', { value: landingConfig });
      showMsg('success', 'Landing page settings saved');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSavingLanding(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading...</div>;
  }

  const showCardForm = creatingCard || editingCard;
  const showNewsForm = creatingNews || editingNews;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Toast */}
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-6 mb-6 border-b border-white/10 pb-4">
        <button
          onClick={() => setTab('cards')}
          className={`text-sm font-bold pb-2 border-b-2 transition-all ${
            tab === 'cards' ? 'text-white border-primary' : 'text-slate-400 border-transparent hover:text-white'
          }`}
        >
          Solution Cards ({cards.length})
        </button>
        <button
          onClick={() => setTab('news')}
          className={`text-sm font-bold pb-2 border-b-2 transition-all ${
            tab === 'news' ? 'text-white border-primary' : 'text-slate-400 border-transparent hover:text-white'
          }`}
        >
          News Feed ({news.length})
        </button>
        <button
          onClick={() => setTab('landing')}
          className={`text-sm font-bold pb-2 border-b-2 transition-all ${
            tab === 'landing' ? 'text-white border-primary' : 'text-slate-400 border-transparent hover:text-white'
          }`}
        >
          Landing Page Settings
        </button>
      </div>

      {/* ── SOLUTION CARDS TAB ────────────────────────── */}
      {tab === 'cards' && (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">Solution Cards</h1>
              <p className="text-sm text-slate-400 mt-1">Manage homepage solution cards (max 8 active, scrollable)</p>
            </div>
            <button onClick={openCreateCard} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
              <span className="material-symbols-outlined text-sm">add</span>
              Add Card
            </button>
          </div>

          <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Card</th>
                  <th className="text-left px-4 py-3">Subtitle</th>
                  <th className="text-left px-4 py-3">Order</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card.id} className="border-b border-white/5 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center ${card.icon_color}`}>
                          <span className="material-symbols-outlined text-base">{card.icon}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{card.title}</p>
                          <p className="text-[10px] text-slate-500 max-w-xs truncate">{card.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{card.subtitle || '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{card.sort_order}</td>
                    <td className="px-4 py-3">
                      {card.is_active ? (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400">Active</span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEditCard(card)} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                        <button onClick={() => handleDeleteCard(card)} className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors">
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {cards.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">No solution cards yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── NEWS FEED TAB ─────────────────────────────── */}
      {tab === 'news' && (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">News Feed</h1>
              <p className="text-sm text-slate-400 mt-1">Manage news items displayed on the homepage</p>
            </div>
            <button onClick={openCreateNews} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
              <span className="material-symbols-outlined text-sm">add</span>
              Add News
            </button>
          </div>

          <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Title</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Badge</th>
                  <th className="text-left px-4 py-3">Published</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {news.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-white">{item.title}</p>
                        <p className="text-[10px] text-slate-500 max-w-xs truncate">{item.summary}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-700 text-slate-300 capitalize">{item.source}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{item.badge || '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(item.published_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {item.is_active ? (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400">Active</span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEditNews(item)} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                        <button onClick={() => handleDeleteNews(item)} className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors">
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {news.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">No news items yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── LANDING PAGE TAB ──────────────────────────── */}
      {tab === 'landing' && (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">Landing Page Setup</h1>
              <p className="text-sm text-slate-400 mt-1">Configure the "See it in Action" section to showcase dynamic videos and workflows.</p>
            </div>
            <button onClick={handleSaveLanding} disabled={savingLanding} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors">
              <span className="material-symbols-outlined text-sm">save</span>
              {savingLanding ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 p-6 mb-8 max-w-3xl">
            <h2 className="text-lg font-bold text-white mb-4">Featured Video</h2>
            <div className="mb-6">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Select Video</label>
              <select
                value={landingConfig.video_id || ''}
                onChange={(e) => setLandingConfig(c => ({ ...c, video_id: e.target.value || null }))}
                className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-white/10 text-white focus:border-primary outline-none"
              >
                <option value="">— Placeholder IDE Animation —</option>
                {videos.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-2">If no video is selected, the page will fall back to the placeholder CLI animation.</p>
            </div>

            <h2 className="text-lg font-bold text-white mb-4 mt-8">Workflow Highlights</h2>
            <div className="space-y-4">
              {landingConfig.highlights.map((h, i) => (
                <div key={i} className="flex flex-col gap-3 p-4 bg-slate-900 rounded-lg border border-white/5 relative group">
                  <button onClick={() => setLandingConfig(c => ({ ...c, highlights: c.highlights.filter((_, idx) => idx !== i) }))} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                  <label className="text-xs font-bold text-slate-400 uppercase">Highlight {i + 1}</label>
                  <input
                    value={h.title}
                    placeholder="e.g. Describe the spec"
                    onChange={(e) => setLandingConfig(c => {
                      const nh = [...c.highlights];
                      nh[i].title = e.target.value;
                      return { ...c, highlights: nh };
                    })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-primary outline-none"
                  />
                  <textarea
                    value={h.description}
                    placeholder="Brief description of this workflow step..."
                    onChange={(e) => setLandingConfig(c => {
                      const nh = [...c.highlights];
                      nh[i].description = e.target.value;
                      return { ...c, highlights: nh };
                    })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none"
                    rows={2}
                  />
                </div>
              ))}
              <button
                onClick={() => setLandingConfig(c => ({ ...c, highlights: [...c.highlights, { title: '', description: '' }] }))}
                className="w-full py-3 rounded-lg border-2 border-dashed border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all text-sm font-bold flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">add</span> Add New Highlight
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Card Slide-out Form ───────────────────────── */}
      {showCardForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeCardForm} />
          <div className="relative w-full max-w-lg bg-background-dark border-l border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">
                {creatingCard ? 'New Solution Card' : `Edit: ${editingCard?.title}`}
              </h2>
              <button onClick={closeCardForm} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Title</label>
                <input value={cardForm.title} onChange={(e) => setCardForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Subtitle</label>
                  <input value={cardForm.subtitle} onChange={(e) => setCardForm((f) => ({ ...f, subtitle: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Sort Order</label>
                  <input type="number" value={cardForm.sort_order} onChange={(e) => setCardForm((f) => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
                <textarea value={cardForm.description} onChange={(e) => setCardForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Long Description (Markdown)</label>
                  <button
                    onClick={() => handleBeautify('card-long', cardForm.long_description, (v) => setCardForm((f) => ({ ...f, long_description: v })))}
                    disabled={beautifying === 'card-long' || !cardForm.long_description.trim()}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded transition-colors disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>{beautifying === 'card-long' ? 'autorenew' : 'auto_fix_high'}</span>
                    {beautifying === 'card-long' ? 'Beautifying…' : 'Beautify'}
                  </button>
                </div>
                <textarea value={cardForm.long_description} onChange={(e) => setCardForm((f) => ({ ...f, long_description: e.target.value }))}
                  rows={8} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none font-mono" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Icon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICON_OPTIONS.map((icon) => (
                      <button
                        key={icon}
                        onClick={() => setCardForm((f) => ({ ...f, icon }))}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-all ${
                          cardForm.icon === icon ? 'bg-primary/20 border border-primary/50 ring-1 ring-primary/30' : 'bg-slate-800 border border-white/5 hover:border-white/20'
                        }`}
                      >
                        <span className={`material-symbols-outlined text-sm ${cardForm.icon === icon ? 'text-primary' : 'text-slate-400'}`}>{icon}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Icon Color</label>
                  <select value={cardForm.icon_color} onChange={(e) => setCardForm((f) => ({ ...f, icon_color: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none">
                    {COLOR_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Badge</label>
                  <input value={cardForm.badge} onChange={(e) => setCardForm((f) => ({ ...f, badge: e.target.value }))}
                    placeholder="e.g. New, Beta"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Link URL <span className="text-slate-600 normal-case font-normal">(detail page)</span></label>
                  <input value={cardForm.link_url} onChange={(e) => setCardForm((f) => ({ ...f, link_url: e.target.value }))}
                    placeholder="/marketplace"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Launch URL <span className="text-slate-600 normal-case font-normal">(direct link — shows Launch button on card)</span>
                </label>
                <input value={cardForm.launch_url} onChange={(e) => setCardForm((f) => ({ ...f, launch_url: e.target.value }))}
                  placeholder="https://tool.company.internal"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button onClick={handleSaveCard} className="flex-1 px-6 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  {creatingCard ? 'Create Card' : 'Save Changes'}
                </button>
                <button onClick={closeCardForm} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── News Slide-out Form ───────────────────────── */}
      {showNewsForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeNewsForm} />
          <div className="relative w-full max-w-lg bg-background-dark border-l border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">
                {creatingNews ? 'New News Item' : `Edit: ${editingNews?.title}`}
              </h2>
              <button onClick={closeNewsForm} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Title</label>
                <input value={newsForm.title} onChange={(e) => setNewsForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Summary</label>
                <textarea value={newsForm.summary} onChange={(e) => setNewsForm((f) => ({ ...f, summary: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Content (Markdown)</label>
                <textarea value={newsForm.content} onChange={(e) => setNewsForm((f) => ({ ...f, content: e.target.value }))}
                  rows={8} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none font-mono" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Source</label>
                  <select value={newsForm.source} onChange={(e) => setNewsForm((f) => ({ ...f, source: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none">
                    <option value="manual">Manual</option>
                    <option value="rss">RSS</option>
                    <option value="release">Release</option>
                    <option value="llm">LLM Generated</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Badge</label>
                  <input value={newsForm.badge} onChange={(e) => setNewsForm((f) => ({ ...f, badge: e.target.value }))}
                    placeholder="e.g. New Release"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Source URL</label>
                <input value={newsForm.source_url} onChange={(e) => setNewsForm((f) => ({ ...f, source_url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button onClick={handleSaveNews} className="flex-1 px-6 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  {creatingNews ? 'Create News' : 'Save Changes'}
                </button>
                <button onClick={closeNewsForm} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
