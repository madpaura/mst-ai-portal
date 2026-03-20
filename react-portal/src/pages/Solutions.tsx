import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';

interface Announcement {
  id: string;
  title: string;
  content: string | null;
  badge: string | null;
  created_at: string;
}

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
  sort_order: number;
}

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  badge: string | null;
  published_at: string;
}

const WORKFLOW_STEPS = [
  {
    step: 1,
    title: 'Describe the spec',
    description: 'Provide natural language or architectural block diagrams to initialize the agent.',
  },
  {
    step: 2,
    title: 'Agent generates RTL',
    description: 'The AI constructs syntactically correct and vendor-compliant Verilog/SystemVerilog.',
  },
  {
    step: 3,
    title: 'Real-time validation',
    description: 'Instant syntax checks and logical verification against existing design constraints.',
  },
];

export const Solutions: React.FC = () => {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [solutionCards, setSolutionCards] = useState<SolutionCard[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    api.get<Announcement[]>('/api/solutions/announcements')
      .then((data) => { if (data.length > 0) setAnnouncement(data[0]); })
      .catch(() => {});
    api.get<SolutionCard[]>('/api/solutions/cards')
      .then(setSolutionCards)
      .catch(() => {});
    api.get<NewsItem[]>('/api/solutions/news')
      .then(setNewsItems)
      .catch(() => {});
  }, []);

  const updateScrollButtons = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    updateScrollButtons();
  }, [solutionCards]);

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 340, behavior: 'smooth' });
    setTimeout(updateScrollButtons, 400);
  };

  const handleGetStarted = () => navigate('/ignite');
  const handleViewDocs = () => navigate('/howto');
  const handleWatchDemos = () => navigate('/ignite');
  const handleEnterDashboard = () => navigate('/ignite');
  const handleSpeakWithTeam = () => alert('Contact the tools team at ai-tools@mst.internal');
  const handlePlayVideo = () => navigate('/ignite');
  const handleCardClick = (card: SolutionCard) => {
    if (card.link_url) {
      navigate(card.link_url);
    } else {
      navigate(`/solutions/${card.id}`);
    }
  };

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        {/* Hero Section */}
        <section className="relative min-h-[85vh] flex flex-col items-center justify-center px-6 overflow-hidden circuit-bg">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[100px]" />

          <div className="relative z-10 text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 mb-8">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest font-bold text-primary">{announcement?.badge ? `${announcement.badge} ${announcement.title}` : 'v2.4 Internal Release'}</span>
            </div>

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight text-slate-900 dark:text-white mb-6 leading-[1.1]">
              The Next Era of <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400 dark:glow-text">
                Semiconductor
              </span>{' '}
              Development
            </h1>

            <p className="text-lg md:text-xl text-slate-500 dark:text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed font-light">
              Accelerate RTL design, automate verification, and optimize performance with our integrated AI suite
              tailored for hardware engineers.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={handleGetStarted}
                className="w-full sm:w-auto px-10 py-4 bg-primary text-white font-bold rounded-xl text-lg hover:scale-105 active:scale-95 transition-all shadow-xl shadow-primary/20"
              >
                Get Started
              </button>
              <button
                onClick={handleViewDocs}
                className="w-full sm:w-auto px-10 py-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold rounded-xl text-lg border border-slate-300 dark:border-slate-700 transition-all"
              >
                View Docs
              </button>
            </div>
          </div>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-slate-500">
            <span className="text-[10px] uppercase tracking-widest font-semibold">Features</span>
            <span className="material-symbols-outlined animate-bounce">keyboard_double_arrow_down</span>
          </div>
        </section>

        {/* Solution Cards — scrollable up to 8 */}
        {solutionCards.length > 0 && (
          <section className="max-w-7xl mx-auto px-6 py-24 border-t border-slate-200 dark:border-primary/10">
            <div className="flex items-end justify-between mb-10">
              <div>
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Our Solutions</h2>
                <div className="h-1 w-20 bg-primary rounded-full" />
              </div>
              {solutionCards.length > 4 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => scrollBy(-1)}
                    disabled={!canScrollLeft}
                    className="w-10 h-10 rounded-full border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary hover:border-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    onClick={() => scrollBy(1)}
                    disabled={!canScrollRight}
                    className="w-10 h-10 rounded-full border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary hover:border-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              )}
            </div>

            <div
              ref={scrollRef}
              onScroll={updateScrollButtons}
              className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {solutionCards.map((card) => (
                <div
                  key={card.id}
                  onClick={() => handleCardClick(card)}
                  className="min-w-[300px] max-w-[300px] snap-start glass-card p-8 rounded-2xl flex flex-col gap-5 group cursor-pointer hover:border-primary/30 transition-all shrink-0"
                >
                  <div className="flex items-center justify-between">
                    <div className={`w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center ${card.icon_color} group-hover:bg-primary group-hover:text-white transition-all duration-300`}>
                      <span className="material-symbols-outlined text-3xl">{card.icon}</span>
                    </div>
                    {card.badge && (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{card.title}</h3>
                    {card.subtitle && (
                      <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-2">{card.subtitle}</p>
                    )}
                    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{card.description}</p>
                  </div>
                  <div className="mt-auto flex items-center gap-1 text-primary text-sm font-medium group-hover:gap-2 transition-all">
                    Learn more
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* News Feed */}
        {newsItems.length > 0 && (
          <section className="max-w-7xl mx-auto px-6 py-24 border-t border-slate-200 dark:border-primary/10">
            <div className="mb-10">
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Latest News</h2>
              <div className="h-1 w-20 bg-primary rounded-full" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {newsItems.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="glass-card p-6 rounded-2xl flex flex-col gap-3 hover:border-primary/30 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                      {new Date(item.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <div className="flex items-center gap-2">
                      {item.badge && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
                          {item.badge}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded capitalize ${
                        item.source === 'release' ? 'bg-green-500/10 text-green-400' :
                        item.source === 'rss' ? 'bg-amber-500/10 text-amber-400' :
                        item.source === 'llm' ? 'bg-purple-500/10 text-purple-400' :
                        'bg-slate-500/10 text-slate-400'
                      }`}>
                        {item.source}
                      </span>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{item.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{item.summary}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Demo Section */}
        <section className="max-w-7xl mx-auto px-6 py-24 border-t border-slate-200 dark:border-primary/10">
          <div className="flex flex-col lg:flex-row gap-16 items-center">
            <div className="w-full lg:w-2/3">
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">See it in Action</h2>
                <div className="h-1 w-20 bg-primary rounded-full" />
              </div>

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-blue-500/50 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                <div className="relative bg-black rounded-2xl overflow-hidden neon-border-glow aspect-video flex items-center justify-center">
                  <div className="absolute inset-0 bg-slate-900 flex flex-col">
                    {/* IDE Header */}
                    <div className="h-8 bg-slate-800 border-b border-white/5 flex items-center px-4 gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <div className="w-2 h-2 rounded-full bg-yellow-500" />
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-[10px] text-slate-400 ml-4 font-mono">top_module.v — CodeAgent IDE</span>
                    </div>

                    {/* Code Content */}
                    <div className="flex-1 p-6 font-mono text-sm overflow-hidden">
                      <div className="flex gap-4">
                        <span className="text-slate-600 select-none">1</span>
                        <span className="text-blue-400">module</span>
                        <span className="text-white">top_module(</span>
                      </div>
                      <div className="flex gap-4">
                        <span className="text-slate-600 select-none">2</span>
                        <span className="text-slate-400 ml-4">input wire clk,</span>
                      </div>
                      <div className="flex gap-4">
                        <span className="text-slate-600 select-none">3</span>
                        <span className="text-slate-400 ml-4">input wire rst_n,</span>
                      </div>
                      <div className="flex gap-4 items-center animate-pulse">
                        <span className="text-slate-600 select-none">4</span>
                        <span className="text-primary bg-primary/10 px-1 rounded border border-primary/20">
                          Agent: Generating RTL logic for AXI Bridge...
                        </span>
                      </div>
                      <div className="flex gap-4 mt-2">
                        <span className="text-slate-600 select-none">5</span>
                        <span className="text-slate-400 ml-4">reg [31:0] data_reg;</span>
                      </div>
                      <div className="flex gap-4">
                        <span className="text-slate-600 select-none">6</span>
                        <span className="text-slate-400 ml-4">always @(posedge clk or negedge rst_n) begin</span>
                      </div>
                      <div className="flex gap-4">
                        <span className="text-slate-600 select-none">7</span>
                        <span className="text-slate-400 ml-8">if (!rst_n) data_reg &lt;= 32&apos;h0;</span>
                      </div>
                    </div>

                    {/* Video Controls */}
                    <div className="h-12 bg-slate-900/80 backdrop-blur-sm border-t border-white/5 flex items-center px-6 gap-6">
                      <button onClick={handlePlayVideo} className="text-white/80 cursor-pointer hover:text-primary transition-colors">
                        <span className="material-symbols-outlined">play_arrow</span>
                      </button>
                      <div className="flex-1 h-1 bg-slate-700 rounded-full relative">
                        <div className="absolute top-0 left-0 w-1/3 h-full bg-primary rounded-full shadow-[0_0_8px_rgba(37,140,244,0.6)]" />
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">01:24 / 04:15</span>
                      <button onClick={() => console.log('[Solutions] Settings clicked')} className="text-white/80 cursor-pointer hover:text-primary transition-colors">
                        <span className="material-symbols-outlined">settings</span>
                      </button>
                      <button onClick={() => console.log('[Solutions] Fullscreen clicked')} className="text-white/80 cursor-pointer hover:text-primary transition-colors">
                        <span className="material-symbols-outlined">fullscreen</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Workflow Highlights */}
            <div className="w-full lg:w-1/3 flex flex-col gap-8">
              <div className="glass-card p-8 rounded-2xl border-l-4 border-l-primary">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Workflow Highlights</h3>
                <ul className="space-y-6">
                  {WORKFLOW_STEPS.map((ws) => (
                    <li key={ws.step} className="flex items-start gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary font-bold text-sm">
                        {ws.step}
                      </span>
                      <div>
                        <h4 className="text-slate-900 dark:text-white font-semibold">{ws.title}</h4>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 leading-relaxed">{ws.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={handleWatchDemos}
                className="w-full py-4 px-6 rounded-xl border border-primary/30 bg-primary/5 text-primary font-bold hover:bg-primary/10 transition-all flex items-center justify-center gap-3 group"
              >
                Watch All Demos
                <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </button>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-7xl mx-auto px-6 py-24">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-900 dark:to-background-dark border border-slate-200 dark:border-primary/20 p-12 text-center">
            <div className="absolute top-0 right-0 p-8 opacity-20">
              <span className="material-symbols-outlined text-[120px] text-primary rotate-12">settings_input_component</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-6">Ready to transform your workflow?</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-10 max-w-xl mx-auto">
              Join hundreds of internal engineers already using MST AI to deliver faster silicon.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <button
                onClick={handleEnterDashboard}
                className="bg-primary text-white font-bold py-3 px-8 rounded-lg hover:scale-105 transition-transform flex items-center gap-2 shadow-lg shadow-primary/20"
              >
                Enter Dashboard
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
              <button
                onClick={handleSpeakWithTeam}
                className="text-primary font-bold hover:underline"
              >
                Speak with the tools team
              </button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};
