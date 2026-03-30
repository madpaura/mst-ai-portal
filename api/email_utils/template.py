"""Editorial email template generator"""
from datetime import datetime
from typing import Optional


def generate_editorial_email(
    issue_title: str,
    issue_number: int,
    featured_item: dict,
    featured_items: list,
    stats: dict,
    featured_series: Optional[dict] = None,
    cta_text: str = "Explore the full library",
    cta_link: str = "http://localhost:9810",
) -> str:
    """
    Generate email HTML using editorial template.

    Args:
        issue_title: Main heading for issue (e.g., "Your AI Learning Digest")
        issue_number: Issue number for header label
        featured_item: Featured item {title, description, category, duration, author, link, tag}
        featured_items: List of 3 items for grid
        stats: {total, new, active, hours} or similar
        featured_series: Optional series info {name, description, episodes, duration, tags}
        cta_text: CTA button text
        cta_link: CTA button URL
    """

    today = datetime.utcnow().strftime("%b %d, %Y")

    # Build featured item card
    featured_card = f"""
      <div class="hero-card">
        <div class="hero-thumb">
          <svg style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 568 240" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="568" height="240" fill="#1a1614"/>
            <rect width="568" height="240" fill="url(#hg1)"/>
            <defs>
              <radialGradient id="hg1" cx="20%" cy="50%" r="60%"><stop offset="0%" stop-color="#e84830" stop-opacity="0.3"/><stop offset="100%" stop-opacity="0"/></radialGradient>
            </defs>
            <g stroke="rgba(255,255,255,0.04)" stroke-width="1">
              <line x1="0" y1="60" x2="568" y2="60"/>
              <line x1="0" y1="120" x2="568" y2="120"/>
              <line x1="0" y1="180" x2="568" y2="180"/>
              <line x1="142" y1="0" x2="142" y2="240"/>
              <line x1="284" y1="0" x2="284" y2="240"/>
              <line x1="426" y1="0" x2="426" y2="240"/>
            </g>
            <text x="32" y="150" font-family="Georgia, serif" font-size="26" fill="rgba(250,248,245,0.92)" letter-spacing="-0.5">{featured_item.get('title', '')}</text>
            <rect x="32" y="196" width="68" height="1.5" fill="rgba(232,72,48,0.5)"/>
          </svg>
          <div class="play-overlay"><div class="play-tri"></div></div>
          <div class="dur-tag">{featured_item.get('duration', '')}</div>
          <div class="hero-thumb-content">
            <div class="thumb-tag">{featured_item.get('tag', 'Featured')}</div>
          </div>
        </div>
        <div class="hero-body">
          <div class="hero-category">{featured_item.get('category', '')}</div>
          <h2 class="hero-title">{featured_item.get('title', '')}</h2>
          <p class="hero-desc">{featured_item.get('description', '')}</p>
          <div class="hero-meta">
            <div class="author-info">
              <div class="author-dot">{featured_item.get('author_initials', 'AI')}</div>
              <div class="author-text">{featured_item.get('author', 'AI Ignite')} &nbsp;·&nbsp; Featured</div>
            </div>
            <a href="{featured_item.get('link', '')}" class="watch-link">Watch Now ↗</a>
          </div>
        </div>
      </div>
    """

    # Build 3-column grid
    grid_items = ""
    for idx, item in enumerate(featured_items[:3]):
        color_map = [
            ("0d1a26", "0a1432", "4080ff"),  # Blue
            ("1a0d26", "1a0832", "a040ff"),  # Purple
            ("0d2614", "0a320a", "40c060"),  # Green
        ]
        bg_dark, bg_darker, accent = color_map[idx]

        grid_items += f"""
      <div class="gc">
        <div class="gc-thumb" style="background:linear-gradient(135deg,#{bg_dark},#{bg_darker})">
          <svg width="100%" height="108" viewBox="0 0 200 108" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id="gc{idx+1}" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="#{accent}" stop-opacity="0.4"/><stop offset="100%" stop-opacity="0"/></radialGradient></defs>
            <rect width="200" height="108" fill="url(#gc{idx+1})"/>
            <text x="12" y="46" font-family="monospace" font-size="9" fill="rgba(255,255,255,0.6)" letter-spacing="1">{item.get('tag', 'NEW').upper()[:12]}</text>
            <text x="12" y="66" font-family="Georgia" font-size="13" fill="rgba(220,216,228,0.9)">{item.get('title', '')[:25]}</text>
            <text x="12" y="84" font-family="Georgia" font-size="13" fill="rgba(220,216,228,0.5)" font-style="italic">{item.get('category', '')}</text>
          </svg>
          <div class="mini-play-sq"><div class="mini-tri-sq"></div></div>
        </div>
        <div class="gc-body">
          <div class="gc-cat">{item.get('category', 'General')}</div>
          <div class="gc-title">{item.get('title', '')}</div>
          <div class="gc-dur">{item.get('duration', '')} · {item.get('level', 'Beginner')}</div>
        </div>
      </div>
        """

    # Build stats
    stats_html = ""
    stat_keys = list(stats.items())
    for label, value in stat_keys[:4]:
        stats_html += f"""
    <div class="stat-cell">
      <div class="stat-num">{value}</div>
      <div class="stat-label">{label.upper()}</div>
    </div>
        """

    # Build featured series section
    series_html = ""
    if featured_series:
        series_html = f"""
  <!-- ══════ SERIES ══════ -->
  <div class="series-row">
    <div class="section-header" style="margin-bottom:16px">
      <span class="section-title">Featured Series</span>
    </div>
    <div class="series-wrap">
      <div class="series-accent"></div>
      <div class="series-body">
        <div class="series-eyebrow">{featured_series.get('meta', 'Multi-Part Series')}</div>
        <div class="series-name">{featured_series.get('name', '')}</div>
        <p class="series-text">{featured_series.get('description', '')}</p>
        <div class="series-chips">
          {_build_chips(featured_series.get('tags', []))}
        </div>
      </div>
    </div>
  </div>
        """

    # Build complete HTML
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Ignite — Weekly Digest</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,500&family=Lato:wght@300;400;700&family=IBM+Plex+Mono:wght@400;600&display=swap');

  * {{ margin: 0; padding: 0; box-sizing: border-box; }}

  body {{
    background: #f0ede8;
    font-family: 'Lato', sans-serif;
    color: #1a1614;
    padding: 40px 20px;
  }}

  .email-wrapper {{
    max-width: 680px;
    margin: 0 auto;
    background: #faf8f5;
    border-radius: 1px;
    overflow: hidden;
    box-shadow: 0 4px 40px rgba(0,0,0,0.10);
  }}

  .top-stripe {{
    height: 4px;
    background: linear-gradient(90deg, #e84830 0%, #e84830 33%, #1a1614 33%, #1a1614 66%, #f5a800 66%, #f5a800 100%);
  }}

  .header {{
    padding: 48px 56px 40px;
    background: #faf8f5;
    border-bottom: 2px solid #1a1614;
    position: relative;
  }}
  .header-inner {{
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }}
  .issue-label {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #e84830;
    margin-bottom: 10px;
  }}
  .header-title {{
    font-family: 'Playfair Display', serif;
    font-size: 44px;
    line-height: 1.0;
    color: #1a1614;
    letter-spacing: -0.02em;
  }}
  .header-title em {{
    font-style: italic;
    color: #e84830;
  }}
  .header-right {{
    text-align: right;
    flex-shrink: 0;
  }}
  .header-date {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #999;
    letter-spacing: 0.12em;
    margin-bottom: 6px;
  }}
  .new-badge {{
    display: inline-block;
    background: #1a1614;
    color: #faf8f5;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    padding: 5px 10px;
    border-radius: 1px;
  }}
  .header-tagline {{
    margin-top: 20px;
    font-size: 14px;
    color: #666;
    font-weight: 300;
    line-height: 1.6;
    max-width: 420px;
    padding-top: 20px;
    border-top: 1px solid #e0ddd8;
  }}

  .hero-section {{
    padding: 40px 56px 0;
  }}
  .section-header {{
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid #e0ddd8;
  }}
  .section-title {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #999;
  }}
  .section-count {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #ccc;
  }}

  .hero-card {{
    display: grid;
    grid-template-columns: 1fr;
    border: 1.5px solid #1a1614;
    border-radius: 1px;
    overflow: hidden;
  }}
  .hero-thumb {{
    width: 100%;
    height: 240px;
    background: #1a1614;
    position: relative;
    overflow: hidden;
  }}
  .hero-thumb-content {{
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 28px;
  }}
  .thumb-tag {{
    display: inline-block;
    background: #e84830;
    color: #fff;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 1px;
    margin-bottom: 10px;
  }}
  .thumb-title {{
    font-family: 'Playfair Display', serif;
    font-size: 24px;
    color: #fff;
    line-height: 1.2;
    max-width: 420px;
  }}
  .play-overlay {{
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 60px; height: 60px;
    border-radius: 50%;
    background: rgba(232,72,48,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 14px rgba(232,72,48,0.12);
  }}
  .play-tri {{
    width: 0; height: 0;
    border-top: 10px solid transparent;
    border-bottom: 10px solid transparent;
    border-left: 16px solid #fff;
    margin-left: 3px;
  }}
  .dur-tag {{
    position: absolute;
    bottom: 14px; right: 14px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #fff;
    background: rgba(0,0,0,0.6);
    padding: 3px 8px;
    border-radius: 1px;
  }}

  .hero-body {{
    padding: 24px 28px 28px;
    background: #fff;
  }}
  .hero-category {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #e84830;
    margin-bottom: 8px;
  }}
  .hero-title {{
    font-family: 'Playfair Display', serif;
    font-size: 20px;
    color: #1a1614;
    line-height: 1.3;
    margin-bottom: 10px;
  }}
  .hero-desc {{
    font-size: 13.5px;
    color: #666;
    line-height: 1.68;
    margin-bottom: 20px;
  }}
  .hero-meta {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 16px;
    border-top: 1px solid #f0ede8;
  }}
  .author-info {{
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  .author-dot {{
    width: 30px; height: 30px;
    border-radius: 50%;
    background: #1a1614;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #faf8f5;
    letter-spacing: 0.05em;
  }}
  .author-text {{
    font-size: 12px;
    color: #999;
  }}
  .watch-link {{
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #1a1614;
    color: #faf8f5;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-decoration: none;
    padding: 10px 18px;
    border-radius: 1px;
  }}

  .grid-section {{
    padding: 36px 56px 0;
  }}
  .three-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5px;
    border: 1.5px solid #1a1614;
    background: #1a1614;
    border-radius: 1px;
    overflow: hidden;
  }}
  .gc {{
    background: #fff;
    padding: 0;
    overflow: hidden;
  }}
  .gc-thumb {{
    height: 108px;
    width: 100%;
    position: relative;
    overflow: hidden;
  }}
  .gc-body {{
    padding: 14px;
  }}
  .gc-cat {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #ccc;
    margin-bottom: 5px;
  }}
  .gc-title {{
    font-size: 12.5px;
    font-weight: 700;
    color: #1a1614;
    line-height: 1.4;
    margin-bottom: 6px;
  }}
  .gc-dur {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: #bbb;
  }}

  .mini-play-sq {{
    position: absolute;
    bottom: 10px; right: 10px;
    width: 28px; height: 28px;
    border-radius: 50%;
    background: rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .mini-tri-sq {{
    width: 0; height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 8px solid rgba(255,255,255,0.8);
    margin-left: 2px;
  }}

  .stats-row {{
    margin: 28px 56px 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.5px;
    border: 1.5px solid #e0ddd8;
    background: #e0ddd8;
    border-radius: 1px;
    overflow: hidden;
  }}
  .stat-cell {{
    background: #fff;
    padding: 18px 16px;
    text-align: center;
  }}
  .stat-num {{
    font-family: 'Playfair Display', serif;
    font-size: 28px;
    color: #1a1614;
    line-height: 1;
    margin-bottom: 4px;
  }}
  .stat-label {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #bbb;
  }}

  .series-row {{
    margin: 36px 56px 0;
  }}
  .series-wrap {{
    display: flex;
    gap: 0;
    border: 1.5px solid #1a1614;
    border-radius: 1px;
    overflow: hidden;
  }}
  .series-accent {{
    width: 8px;
    background: repeating-linear-gradient(
      45deg,
      #e84830,
      #e84830 4px,
      #1a1614 4px,
      #1a1614 8px
    );
    flex-shrink: 0;
  }}
  .series-body {{
    padding: 24px 24px 24px 20px;
    background: #fff;
    flex: 1;
  }}
  .series-eyebrow {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #e84830;
    margin-bottom: 6px;
  }}
  .series-name {{
    font-family: 'Playfair Display', serif;
    font-size: 20px;
    color: #1a1614;
    margin-bottom: 8px;
  }}
  .series-text {{
    font-size: 13px;
    color: #777;
    line-height: 1.65;
    margin-bottom: 16px;
  }}
  .series-chips {{
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }}
  .chip {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    color: #888;
    background: #f5f2ef;
    border: 1px solid #e0ddd8;
    padding: 4px 10px;
    border-radius: 1px;
  }}
  .chip.hot {{
    background: rgba(232,72,48,0.06);
    border-color: rgba(232,72,48,0.3);
    color: #e84830;
  }}

  .cta-band {{
    margin: 36px 56px 0;
    background: #1a1614;
    padding: 32px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    border-radius: 1px;
  }}
  .cta-heading {{
    font-family: 'Playfair Display', serif;
    font-size: 22px;
    color: #faf8f5;
    margin-bottom: 4px;
  }}
  .cta-sub {{
    font-size: 13px;
    color: #777;
    font-weight: 300;
  }}
  .cta-btn {{
    flex-shrink: 0;
    display: inline-block;
    background: #e84830;
    color: #fff;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    text-decoration: none;
    padding: 13px 22px;
    border-radius: 1px;
    white-space: nowrap;
  }}

  .footer {{
    margin-top: 36px;
    padding: 24px 56px 32px;
    border-top: 1.5px solid #1a1614;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }}
  .footer-left {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #bbb;
    line-height: 1.8;
  }}
  .footer-left strong {{ color: #777; display: block; }}
  .footer-links {{ display: flex; gap: 16px; }}
  .footer-link {{
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #bbb;
    text-decoration: underline;
    text-underline-offset: 3px;
  }}

  @media (max-width: 580px) {{
    .header, .hero-section, .grid-section, .series-row, .stats-row, .cta-band {{ padding-left: 24px; padding-right: 24px; }}
    .header {{ padding: 28px 24px; }}
    .header-inner {{ flex-direction: column; }}
    .header-right {{ text-align: left; }}
    .three-grid {{ grid-template-columns: 1fr; }}
    .cta-band {{ flex-direction: column; text-align: center; }}
    .stats-row {{ grid-template-columns: repeat(2, 1fr); margin-left: 24px; margin-right: 24px; }}
    .footer {{ padding: 20px 24px; flex-direction: column; gap: 14px; }}
    .footer-links {{ flex-wrap: wrap; }}
  }}
</style>
</head>
<body>

<div class="email-wrapper">
  <div class="top-stripe"></div>

  <!-- ══════ HEADER ══════ -->
  <div class="header">
    <div class="header-inner">
      <div class="header-left">
        <div class="issue-label">AI Ignite Weekly · Issue No. {issue_number}</div>
        <h1 class="header-title">{issue_title}</h1>
      </div>
      <div class="header-right">
        <div class="header-date">{today}</div>
        <div class="new-badge">{list(stats.values())[1] if len(stats) > 1 else '0'} New</div>
      </div>
    </div>
    <p class="header-tagline">Hand-picked sessions, demos, and deep dives from your team's embedded AI video library — delivered weekly.</p>
  </div>

  <!-- ══════ HERO ══════ -->
  <div class="hero-section">
    <div class="section-header">
      <span class="section-title">Featured Session</span>
      <span class="section-count">Editor's Pick</span>
    </div>
    {featured_card}
  </div>

  <!-- ══════ 3-COLUMN GRID ══════ -->
  <div class="grid-section">
    <div class="section-header">
      <span class="section-title">New This Week</span>
      <span class="section-count">{len(featured_items) - 1} more</span>
    </div>
    <div class="three-grid">
      {grid_items}
    </div>
  </div>

  <!-- ══════ STATS ══════ -->
  <div class="stats-row">
    {stats_html}
  </div>

  {series_html}

  <!-- ══════ CTA ══════ -->
  <div class="cta-band">
    <div class="cta-text">
      <div class="cta-heading">{cta_text}</div>
      <div class="cta-sub">Stream, download & share with your team</div>
    </div>
    <a href="{cta_link}" class="cta-btn">Open Portal ↗</a>
  </div>

  <!-- ══════ FOOTER ══════ -->
  <div class="footer">
    <div class="footer-left">
      <strong>AI Ignite · Internal Portal</strong>
      Weekly digest · Unsubscribe anytime
    </div>
    <div class="footer-links">
      <a href="{cta_link}" class="footer-link">Portal</a>
      <a href="{cta_link}" class="footer-link">Unsubscribe</a>
    </div>
  </div>

</div>
</body>
</html>
    """

    return html


def _build_chips(tags: list) -> str:
    """Build chip HTML for series tags"""
    chips = ""
    for i, tag in enumerate(tags[:4]):
        is_hot = "hot" if i == 0 else ""
        chips += f'<div class="chip {is_hot}">{tag}</div>\n          '
    return chips


def generate_digest_email(
    days: int,
    stats: dict,
    learning_items: list,
    learning_summary: str,
    marketplace_items: list,
    marketplace_summary: str,
    article_items: list,
    articles_summary: str,
    announcements: list = None,
    custom_content: str = None,
    portal_url: str = "http://localhost:9810",
) -> str:
    """
    Generate a multi-page digest email HTML.
    Page 1: Learning (Videos)
    Page 2: Marketplace (Forge Components + Solutions)
    Page 3: Articles
    """
    today = datetime.utcnow().strftime("%b %d, %Y")

    def _item_cards(items: list, accent: str, icon: str) -> str:
        if not items:
            return '<p style="color:#999;font-size:13px;padding:16px 0;">No new items this period.</p>'
        cards = ""
        for item in items:
            tag_bg = accent
            cards += f"""
        <div style="background:#fff;border:1px solid #e0ddd8;border-radius:2px;padding:18px 20px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#fff;background:{tag_bg};padding:3px 8px;border-radius:1px;">{item.get('tag', 'New')}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#bbb;letter-spacing:0.1em;">{item.get('category', '')}</span>
          </div>
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:#1a1614;margin-bottom:6px;line-height:1.3;">{item.get('title', '')}</div>
          <p style="font-size:12.5px;color:#777;line-height:1.55;margin:0 0 10px 0;">{item.get('description', '')}</p>
          <a href="{item.get('link', '#')}" style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:{accent};text-decoration:none;">View {icon} &#8599;</a>
        </div>"""
        return cards

    # Stats bar
    stats_html = ""
    for label, value in list(stats.items())[:4]:
        stats_html += f"""
      <div style="flex:1;text-align:center;padding:14px 8px;background:#fff;">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:#1a1614;line-height:1;">{value}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:0.15em;text-transform:uppercase;color:#bbb;margin-top:4px;">{label}</div>
      </div>"""

    # Announcements
    ann_html = ""
    if announcements:
        ann_items = ""
        for ann in announcements[:3]:
            badge = ann.get('badge', '')
            badge_html = f'<span style="font-family:\'IBM Plex Mono\',monospace;font-size:8px;background:#1a1614;color:#faf8f5;padding:2px 6px;border-radius:1px;margin-right:8px;">{badge}</span>' if badge else ''
            ann_items += f'<div style="padding:10px 0;border-bottom:1px solid #f0ede8;font-size:13px;color:#555;">{badge_html}<strong style="color:#1a1614;">{ann.get("title", "")}</strong> — {ann.get("content", "")}</div>'
        ann_html = f"""
    <div style="margin:24px 0 0 0;">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#e84830;margin-bottom:10px;">Announcements</div>
      {ann_items}
    </div>"""

    # Custom content block
    custom_html = ""
    if custom_content:
        custom_html = f"""
    <div style="margin:20px 0;padding:16px 20px;background:rgba(232,72,48,0.04);border-left:3px solid #e84830;border-radius:2px;">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#e84830;margin-bottom:6px;">Message from the team</div>
      <p style="font-size:13px;color:#555;line-height:1.6;margin:0;">{custom_content}</p>
    </div>"""

    # Page navigation helper
    def _page_nav(current: int) -> str:
        pages = [("1", "Learning"), ("2", "Marketplace"), ("3", "Articles")]
        dots = ""
        for num, label in pages:
            is_active = int(num) == current
            bg = "#e84830" if is_active else "#e0ddd8"
            color = "#fff" if is_active else "#999"
            dots += f'<span style="display:inline-block;padding:4px 12px;background:{bg};color:{color};font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:0.1em;border-radius:1px;margin-right:4px;">{label}</span>'
        return f'<div style="text-align:center;padding:12px 0;margin-bottom:8px;">{dots}</div>'

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Ignite — Learning Digest</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,500&family=Lato:wght@300;400;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ background:#f0ede8; font-family:'Lato',sans-serif; color:#1a1614; padding:40px 20px; }}
  .digest-wrapper {{ max-width:680px; margin:0 auto; }}
  .digest-card {{ background:#faf8f5; border-radius:2px; overflow:hidden; box-shadow:0 4px 40px rgba(0,0,0,0.10); margin-bottom:28px; }}
  .page-divider {{ height:3px; background:linear-gradient(90deg, #e84830 0%, #e84830 33%, #1a1614 33%, #1a1614 66%, #f5a800 66%); }}
  @media (max-width:580px) {{
    .digest-card {{ margin-bottom:16px; }}
    body {{ padding:16px 8px; }}
  }}
</style>
</head>
<body>

<div class="digest-wrapper">

  <!-- ══════ HEADER CARD ══════ -->
  <div class="digest-card">
    <div class="page-divider"></div>
    <div style="padding:40px 48px 32px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#e84830;margin-bottom:10px;">AI Ignite Digest · {days}-Day Update</div>
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:36px;line-height:1.05;color:#1a1614;letter-spacing:-0.02em;">Learning<br><em style="color:#e84830;">Digest</em></h1>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#999;letter-spacing:0.12em;">{today}</div>
        </div>
      </div>
      <p style="margin-top:16px;font-size:13.5px;color:#777;font-weight:300;line-height:1.6;max-width:460px;padding-top:16px;border-top:1px solid #e0ddd8;">
        Your curated update covering new learning sessions, marketplace additions, and articles from the AI Ignite Portal.
      </p>
      {custom_html}
    </div>
    <!-- Stats -->
    <div style="margin:0 48px 32px;display:flex;gap:1.5px;border:1.5px solid #e0ddd8;background:#e0ddd8;border-radius:1px;overflow:hidden;">
      {stats_html}
    </div>
    {f'<div style="padding:0 48px 32px;">{ann_html}</div>' if ann_html else ''}
  </div>

  <!-- ══════ PAGE 1: LEARNING ══════ -->
  <div class="digest-card">
    <div class="page-divider"></div>
    <div style="padding:32px 48px;">
      {_page_nav(1)}
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #e0ddd8;">
        <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#999;">Learning — Videos</span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ccc;">{stats.get('videos', '0')} new</span>
      </div>
      {f'<p style="font-size:13px;color:#666;line-height:1.6;margin-bottom:16px;font-style:italic;">{learning_summary}</p>' if learning_summary else ''}
      {_item_cards(learning_items, '#e84830', 'Video')}
    </div>
  </div>

  <!-- ══════ PAGE 2: MARKETPLACE ══════ -->
  <div class="digest-card">
    <div style="height:3px;background:linear-gradient(90deg, #4080ff 0%, #4080ff 33%, #1a1614 33%, #1a1614 66%, #a040ff 66%);"></div>
    <div style="padding:32px 48px;">
      {_page_nav(2)}
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #e0ddd8;">
        <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#999;">Marketplace — Components &amp; Solutions</span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ccc;">{int(stats.get('marketplace', '0')) + int(stats.get('solutions', '0'))} items</span>
      </div>
      {f'<p style="font-size:13px;color:#666;line-height:1.6;margin-bottom:16px;font-style:italic;">{marketplace_summary}</p>' if marketplace_summary else ''}
      {_item_cards(marketplace_items, '#4080ff', 'Component')}
    </div>
  </div>

  <!-- ══════ PAGE 3: ARTICLES ══════ -->
  <div class="digest-card">
    <div style="height:3px;background:linear-gradient(90deg, #40c060 0%, #40c060 33%, #1a1614 33%, #1a1614 66%, #f5a800 66%);"></div>
    <div style="padding:32px 48px;">
      {_page_nav(3)}
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #e0ddd8;">
        <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#999;">Articles &amp; Insights</span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ccc;">{stats.get('articles', '0')} new</span>
      </div>
      {f'<p style="font-size:13px;color:#666;line-height:1.6;margin-bottom:16px;font-style:italic;">{articles_summary}</p>' if articles_summary else ''}
      {_item_cards(article_items, '#40c060', 'Article')}
    </div>
  </div>

  <!-- ══════ CTA + FOOTER ══════ -->
  <div class="digest-card">
    <div style="background:#1a1614;padding:28px 48px;display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div>
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:20px;color:#faf8f5;margin-bottom:4px;">Explore the full portal</div>
        <div style="font-size:12px;color:#777;">Stream, download &amp; share with your team</div>
      </div>
      <a href="{portal_url}" style="flex-shrink:0;display:inline-block;background:#e84830;color:#fff;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;text-decoration:none;padding:12px 20px;border-radius:1px;white-space:nowrap;">Open Portal &#8599;</a>
    </div>
    <div style="padding:20px 48px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e0ddd8;">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#bbb;line-height:1.8;">
        <strong style="color:#777;display:block;">AI Ignite · Internal Portal</strong>
        {days}-day digest · {today}
      </div>
      <div style="display:flex;gap:16px;">
        <a href="{portal_url}" style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#bbb;text-decoration:underline;text-underline-offset:3px;">Portal</a>
        <a href="{portal_url}" style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#bbb;text-decoration:underline;text-underline-offset:3px;">Unsubscribe</a>
      </div>
    </div>
  </div>

</div>
</body>
</html>"""

    return html
