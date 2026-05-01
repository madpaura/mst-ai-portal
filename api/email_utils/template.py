"""Editorial email template generator — fully inline styles, email-client compatible."""
from datetime import datetime
from typing import Optional

# Reusable font stacks (inline, no @import needed)
_MONO = "font-family:'IBM Plex Mono',Courier New,Courier,monospace;"
_SERIF = "font-family:'Playfair Display',Georgia,'Times New Roman',serif;"
_SANS = "font-family:Arial,Helvetica,sans-serif;"

# Email-safe inline logo block (HTML table, no SVG required)
_LOGO_HTML = """
<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
  <tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:36px;height:36px;background:#0D1F35;border-radius:8px;text-align:center;vertical-align:middle;border:1.5px solid #258CF4;">
            <span style="font-family:Arial,sans-serif;font-size:16px;font-weight:900;color:#258CF4;letter-spacing:-1px;">M</span>
          </td>
        </tr>
      </table>
    </td>
    <td style="vertical-align:middle;">
      <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1614;letter-spacing:-0.3px;line-height:1;">MST AI</div>
      <div style="font-family:'IBM Plex Mono',Courier New,monospace;font-size:9px;color:#999;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px;">Internal Portal</div>
    </td>
  </tr>
</table>"""


def generate_editorial_email(
    issue_title: str,
    issue_number: int,
    featured_item: dict,
    featured_items: list,
    stats: dict,
    featured_series: Optional[dict] = None,
    cta_text: str = "Explore the full library",
    cta_link: str = "http://localhost:9810",
    issue_label: str = None,
) -> str:
    today = datetime.utcnow().strftime("%b %d, %Y")

    WRAPPER = (
        "max-width:680px;margin:0 auto;background:#faf8f5;"
        "border:1px solid #d0cdc8;"
    )

    # ── Hero card (fully inline, table for meta row) ─────
    title_svg = (featured_item.get("title", "") or "")[:60].replace('"', "&quot;")
    featured_card = f"""
    <div style="border:1.5px solid #1a1614;border-radius:2px;overflow:hidden;">
      <a href="{featured_item.get('link', '')}" style="text-decoration:none;color:inherit;display:block;">
        <!-- thumb -->
        <div style="width:100%;height:240px;background:#1a1614;position:relative;overflow:hidden;display:block;line-height:0;">
          <svg style="display:block;width:100%;height:100%;" viewBox="0 0 568 240"
               preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="568" height="240" fill="#1a1614"/>
            <rect width="568" height="240" fill="url(#hg1)"/>
            <defs>
              <radialGradient id="hg1" cx="20%" cy="50%" r="60%">
                <stop offset="0%" stop-color="#e84830" stop-opacity="0.3"/>
                <stop offset="100%" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <g stroke="rgba(255,255,255,0.04)" stroke-width="1">
              <line x1="0" y1="60" x2="568" y2="60"/>
              <line x1="0" y1="120" x2="568" y2="120"/>
              <line x1="0" y1="180" x2="568" y2="180"/>
              <line x1="142" y1="0" x2="142" y2="240"/>
              <line x1="284" y1="0" x2="284" y2="240"/>
              <line x1="426" y1="0" x2="426" y2="240"/>
            </g>
            <text x="32" y="150" font-family="Georgia,serif" font-size="28"
                  fill="rgba(250,248,245,0.92)" letter-spacing="-0.5">{title_svg}</text>
            <rect x="32" y="196" width="68" height="1.5" fill="rgba(232,72,48,0.5)"/>
          </svg>
          <!-- play button -->
          <table cellpadding="0" cellspacing="0" border="0"
                 style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);">
            <tr><td style="width:64px;height:64px;border-radius:50%;background:rgba(232,72,48,0.9);text-align:center;vertical-align:middle;">
              <div style="display:inline-block;width:0;height:0;border-top:12px solid transparent;border-bottom:12px solid transparent;border-left:20px solid #fff;margin-left:4px;vertical-align:middle;"></div>
            </td></tr>
          </table>
          <!-- duration -->
          <div style="position:absolute;bottom:14px;right:14px;{_MONO}font-size:13px;color:#fff;background:rgba(0,0,0,0.65);padding:4px 10px;border-radius:2px;">{featured_item.get('duration', '')}</div>
          <!-- tag badge -->
          <div style="position:absolute;bottom:14px;left:14px;background:#e84830;color:#fff;{_MONO}font-size:10px;letter-spacing:0.15em;text-transform:uppercase;padding:5px 11px;border-radius:2px;">{featured_item.get('tag', 'Featured')}</div>
        </div>
        <!-- body -->
        <div style="padding:28px 32px 32px;background:#fff;">
          <div style="{_MONO}font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#e84830;margin-bottom:10px;">{featured_item.get('category', '')}</div>
          <h2 style="{_SERIF}font-size:26px;color:#1a1614;line-height:1.3;margin:0 0 12px 0;font-weight:700;">{featured_item.get('title', '')}</h2>
          <p style="{_SANS}font-size:16px;color:#666;line-height:1.7;margin:0 0 22px 0;">{featured_item.get('description', '')}</p>
          <!-- meta -->
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;padding-top:16px;border-top:1px solid #f0ede8;">
            <tr>
              <td style="vertical-align:middle;">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="width:36px;height:36px;vertical-align:middle;">
                      <div style="width:36px;height:36px;border-radius:50%;background:#1a1614;text-align:center;line-height:36px;{_MONO}font-size:13px;font-weight:700;color:#faf8f5;">{featured_item.get('author_initials', 'AI')}</div>
                    </td>
                    <td style="padding-left:10px;vertical-align:middle;">
                      <span style="{_SANS}font-size:14px;color:#999;">{featured_item.get('author', 'AI Ignite')} &nbsp;&middot;&nbsp; Featured</span>
                    </td>
                  </tr>
                </table>
              </td>
              <td style="text-align:right;vertical-align:middle;">
                <a href="{featured_item.get('link', '')}"
                   style="display:inline-block;background:#1a1614;color:#faf8f5;{_MONO}font-size:11px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:11px 20px;border-radius:2px;">Watch Now &#8599;</a>
              </td>
            </tr>
          </table>
        </div>
      </a>
    </div>"""

    # ── 3-column grid (table, email-safe) ────────────────
    color_map = [
        ("0d1a26", "0a1432", "4080ff"),
        ("1a0d26", "1a0832", "a040ff"),
        ("0d2614", "0a320a", "40c060"),
    ]
    grid_cells = ""
    for idx, item in enumerate(featured_items[:3]):
        bg_dark, bg_darker, accent = color_map[idx]
        sep = "border-left:1px solid #1a1614;" if idx > 0 else ""
        grid_cells += f"""
        <td style="width:33%;padding:0;vertical-align:top;{sep}">
          <a href="{item.get('link', '')}" style="text-decoration:none;color:inherit;display:block;">
            <div style="height:112px;background:linear-gradient(135deg,#{bg_dark},#{bg_darker});position:relative;overflow:hidden;line-height:0;">
              <svg width="100%" height="112" viewBox="0 0 200 112" xmlns="http://www.w3.org/2000/svg">
                <defs><radialGradient id="gc{idx+1}" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stop-color="#{accent}" stop-opacity="0.4"/>
                  <stop offset="100%" stop-opacity="0"/>
                </radialGradient></defs>
                <rect width="200" height="112" fill="url(#gc{idx+1})"/>
                <text x="12" y="48" font-family="monospace" font-size="9" fill="rgba(255,255,255,0.6)" letter-spacing="1">{item.get('tag','NEW').upper()[:12]}</text>
                <text x="12" y="70" font-family="Georgia" font-size="13" fill="rgba(220,216,228,0.9)">{item.get('title','')[:25]}</text>
              </svg>
              <div style="position:absolute;bottom:10px;right:10px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.2);text-align:center;line-height:28px;">
                <div style="display:inline-block;width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:8px solid rgba(255,255,255,0.8);margin-left:2px;vertical-align:middle;"></div>
              </div>
            </div>
            <div style="padding:16px;background:#fff;">
              <div style="{_MONO}font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#ccc;margin-bottom:6px;">{item.get('category','General')}</div>
              <div style="{_SANS}font-size:15px;font-weight:700;color:#1a1614;line-height:1.4;margin-bottom:7px;">{item.get('title','')}</div>
              <div style="{_MONO}font-size:10px;color:#bbb;">{item.get('duration','')} &middot; {item.get('level','Beginner')}</div>
            </div>
          </a>
        </td>"""

    grid_html = f"""
    <table cellpadding="0" cellspacing="0" border="0"
           style="width:100%;border:1.5px solid #1a1614;border-radius:2px;overflow:hidden;">
      <tr>{grid_cells}</tr>
    </table>"""

    # ── Stats (table) ─────────────────────────────────────
    stat_cells = ""
    for i, (label, value) in enumerate(list(stats.items())[:4]):
        sep = "border-left:1px solid #e0ddd8;" if i > 0 else ""
        stat_cells += f"""
        <td style="width:25%;padding:22px 16px;text-align:center;background:#fff;vertical-align:top;{sep}">
          <div style="{_SERIF}font-size:34px;color:#1a1614;line-height:1;margin-bottom:6px;">{value}</div>
          <div style="{_MONO}font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#bbb;">{label.upper()}</div>
        </td>"""
    stats_html = f"""
    <table cellpadding="0" cellspacing="0" border="0"
           style="width:100%;border:1.5px solid #e0ddd8;border-radius:2px;overflow:hidden;">
      <tr>{stat_cells}</tr>
    </table>"""

    # ── Series ────────────────────────────────────────────
    series_html = ""
    if featured_series:
        chips = ""
        for i, tag in enumerate(featured_series.get("tags", [])[:4]):
            is_hot = i == 0
            chip_bg = "rgba(232,72,48,0.06)" if is_hot else "#f5f2ef"
            chip_border = "rgba(232,72,48,0.3)" if is_hot else "#e0ddd8"
            chip_color = "#e84830" if is_hot else "#888"
            chips += f'<span style="{_MONO}font-size:10px;letter-spacing:0.1em;padding:5px 11px;border-radius:2px;display:inline-block;margin:0 6px 6px 0;background:{chip_bg};border:1px solid {chip_border};color:{chip_color};">{tag}</span>'
        series_html = f"""
    <table cellpadding="0" cellspacing="0" border="0"
           style="width:100%;border:1.5px solid #1a1614;border-radius:2px;overflow:hidden;">
      <tr>
        <td style="width:10px;padding:0;background:repeating-linear-gradient(45deg,#e84830,#e84830 4px,#1a1614 4px,#1a1614 8px);"></td>
        <td style="padding:26px 26px 26px 22px;background:#fff;vertical-align:top;">
          <div style="{_MONO}font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#e84830;margin-bottom:8px;">{featured_series.get('meta','Multi-Part Series')}</div>
          <div style="{_SERIF}font-size:22px;color:#1a1614;margin-bottom:10px;">{featured_series.get('name','')}</div>
          <p style="{_SANS}font-size:14px;color:#777;line-height:1.65;margin:0 0 16px 0;">{featured_series.get('description','')}</p>
          <div>{chips}</div>
        </td>
      </tr>
    </table>"""

    # ── Full HTML ─────────────────────────────────────────
    new_count = list(stats.values())[1] if len(stats) > 1 else "0"
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AI Ignite — Update</title>
</head>
<body style="margin:0;padding:40px 20px;background:#f0ede8;{_SANS}color:#1a1614;">

<div style="{WRAPPER}">

  <!-- TOP STRIPE -->
  <div style="height:5px;background:linear-gradient(90deg,#e84830 0%,#e84830 33%,#1a1614 33%,#1a1614 66%,#f5a800 66%,#f5a800 100%);"></div>

  <!-- HEADER -->
  <div style="padding:48px 56px 40px;background:#faf8f5;border-bottom:2px solid #1a1614;">
    {_LOGO_HTML}
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="vertical-align:top;">
          <div style="{_MONO}font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#e84830;margin-bottom:12px;">{issue_label or f"AI Ignite Update &middot; Issue No. {issue_number}"}</div>
          <h1 style="{_SERIF}font-size:50px;line-height:1.0;color:#1a1614;letter-spacing:-0.02em;font-weight:700;margin:0;">{issue_title}</h1>
        </td>
        <td style="text-align:right;vertical-align:top;padding-left:20px;white-space:nowrap;">
          <div style="{_MONO}font-size:11px;color:#999;letter-spacing:0.12em;margin-bottom:8px;">{today}</div>
          <div style="display:inline-block;background:#1a1614;color:#faf8f5;{_MONO}font-size:11px;letter-spacing:0.12em;padding:6px 12px;border-radius:2px;">{new_count} New</div>
        </td>
      </tr>
    </table>
    <p style="{_SANS}margin-top:22px;font-size:15px;color:#666;font-weight:300;line-height:1.6;max-width:420px;padding-top:20px;border-top:1px solid #e0ddd8;">
      Hand-picked sessions, demos, and deep dives from your team&rsquo;s embedded AI video library.
    </p>
  </div>

  <!-- FEATURED SESSION -->
  <div style="padding:40px 56px 0;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:16px;">
      <tr>
        <td><span style="{_MONO}font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#999;">Featured Session</span></td>
        <td style="text-align:right;"><span style="{_MONO}font-size:11px;color:#ccc;">Editor&rsquo;s Pick</span></td>
      </tr>
    </table>
    <div style="height:1px;background:#e0ddd8;margin-bottom:20px;"></div>
    {featured_card}
  </div>

  <!-- 3-COLUMN GRID -->
  <div style="padding:36px 56px 0;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:16px;">
      <tr>
        <td><span style="{_MONO}font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#999;">New This Week</span></td>
        <td style="text-align:right;"><span style="{_MONO}font-size:11px;color:#ccc;">{max(0, len(featured_items)-1)} more</span></td>
      </tr>
    </table>
    <div style="height:1px;background:#e0ddd8;margin-bottom:20px;"></div>
    {grid_html}
  </div>

  <!-- STATS -->
  <div style="padding:28px 56px 0;">
    {stats_html}
  </div>

  {f'<div style="padding:36px 56px 0;">{series_html}</div>' if series_html else ''}

  <!-- CTA -->
  <div style="margin:36px 56px 0;background:#1a1614;padding:32px;border-radius:2px;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="vertical-align:middle;">
          <div style="{_SERIF}font-size:24px;color:#faf8f5;margin-bottom:6px;">{cta_text}</div>
          <div style="{_SANS}font-size:14px;color:#777;font-weight:300;">Stream, download &amp; share with your team</div>
        </td>
        <td style="text-align:right;vertical-align:middle;padding-left:20px;white-space:nowrap;">
          <a href="{cta_link}"
             style="display:inline-block;background:#e84830;color:#fff;{_MONO}font-size:11px;letter-spacing:0.15em;text-transform:uppercase;text-decoration:none;padding:14px 24px;border-radius:2px;">Open Portal &#8599;</a>
        </td>
      </tr>
    </table>
  </div>

  <!-- FOOTER -->
  <div style="margin-top:36px;padding:24px 56px 32px;border-top:1.5px solid #1a1614;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="vertical-align:top;">
          <div style="{_MONO}font-size:11px;color:#bbb;line-height:1.8;">
            <strong style="color:#777;display:block;">AI Ignite &middot; Internal Portal</strong>
            Weekly digest &middot; Unsubscribe anytime
          </div>
        </td>
        <td style="text-align:right;vertical-align:top;">
          <a href="{cta_link}" style="{_MONO}font-size:11px;color:#bbb;text-decoration:underline;margin-left:16px;">Portal</a>
          <a href="{cta_link}" style="{_MONO}font-size:11px;color:#bbb;text-decoration:underline;margin-left:16px;">Unsubscribe</a>
        </td>
      </tr>
    </table>
  </div>

</div>
</body>
</html>"""

    return html


def _build_chips(tags: list) -> str:
    """Build chip HTML for series tags (inline styles)"""
    chips = ""
    for i, tag in enumerate(tags[:4]):
        is_hot = i == 0
        chip_bg = "rgba(232,72,48,0.06)" if is_hot else "#f5f2ef"
        chip_border = "rgba(232,72,48,0.3)" if is_hot else "#e0ddd8"
        chip_color = "#e84830" if is_hot else "#888"
        chips += (
            f'<span style="{_MONO}font-size:10px;letter-spacing:0.1em;color:{chip_color};'
            f'background:{chip_bg};border:1px solid {chip_border};padding:4px 10px;'
            f'border-radius:2px;margin-right:6px;display:inline-block;">{tag}</span>'
        )
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
    issue_number: int = None,
) -> str:
    today = datetime.utcnow().strftime("%b %d, %Y")

    CARD_STYLE = (
        "background:#faf8f5;border:1px solid #d8d4ce;"
        "border-radius:2px;overflow:hidden;margin-bottom:28px;"
    )
    STRIPE_RED = "height:5px;background:linear-gradient(90deg,#e84830 0%,#e84830 33%,#1a1614 33%,#1a1614 66%,#f5a800 66%,#f5a800 100%);"
    STRIPE_BLUE = "height:5px;background:linear-gradient(90deg,#4080ff 0%,#4080ff 33%,#1a1614 33%,#1a1614 66%,#a040ff 66%,#a040ff 100%);"
    STRIPE_GREEN = "height:5px;background:linear-gradient(90deg,#40c060 0%,#40c060 33%,#1a1614 33%,#1a1614 66%,#f5a800 66%,#f5a800 100%);"

    def _item_cards(items: list, accent: str, icon: str) -> str:
        if not items:
            return f'<p style="{_SANS}color:#999;font-size:15px;padding:16px 0;">No new items this period.</p>'
        cards = ""
        for item in items:
            cards += f"""
        <div style="{_SANS}background:#fff;border:1px solid #e0ddd8;border-radius:2px;padding:20px 22px;margin-bottom:12px;">
          <a href="{item.get('link','#')}" style="text-decoration:none;color:inherit;display:block;">
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:10px;">
              <tr>
                <td><span style="{_MONO}font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#fff;background:{accent};padding:4px 9px;border-radius:2px;">{item.get('tag','New')}</span></td>
                <td style="text-align:right;"><span style="{_MONO}font-size:10px;color:#bbb;letter-spacing:0.1em;">{item.get('category','')}</span></td>
              </tr>
            </table>
            <div style="{_SERIF}font-size:18px;color:#1a1614;margin-bottom:8px;line-height:1.3;">{item.get('title','')}</div>
            <p style="font-size:14px;color:#777;line-height:1.6;margin:0 0 12px 0;">{item.get('description','')}</p>
            <a href="{item.get('link','#')}" style="{_MONO}font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{accent};text-decoration:none;">View {icon} &#8599;</a>
          </a>
        </div>"""
        return cards

    def _page_nav(current: int) -> str:
        pages = [(1, "Learning"), (2, "Marketplace"), (3, "Articles")]
        cells = ""
        for num, label in pages:
            is_active = num == current
            bg = "#e84830" if is_active else "#e0ddd8"
            color = "#fff" if is_active else "#999"
            weight = "700" if is_active else "400"
            cells += (
                f'<td style="padding:0 3px;"><span style="{_MONO}display:inline-block;'
                f'padding:6px 14px;background:{bg};color:{color};font-size:11px;'
                f'font-weight:{weight};letter-spacing:0.1em;border-radius:2px;">{label}</span></td>'
            )
        return (
            f'<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 16px;">'
            f'<tr>{cells}</tr></table>'
        )

    # Stats bar (table-based, no flex)
    stats_cells = ""
    for i, (label, value) in enumerate(list(stats.items())[:4]):
        sep = "border-left:1px solid #e0ddd8;" if i > 0 else ""
        stats_cells += (
            f'<td style="width:25%;padding:18px 10px;text-align:center;'
            f'background:#fff;vertical-align:top;{sep}">'
            f'<div style="{_SERIF}font-size:30px;color:#1a1614;line-height:1;margin-bottom:5px;">{value}</div>'
            f'<div style="{_MONO}font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#bbb;margin-top:4px;">{label}</div>'
            f'</td>'
        )
    stats_bar = (
        f'<table cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;border:1px solid #e0ddd8;border-radius:2px;overflow:hidden;">'
        f'<tr>{stats_cells}</tr></table>'
    )

    # Announcements
    ann_html = ""
    if announcements:
        ann_items = ""
        for ann in announcements[:3]:
            badge = ann.get("badge", "")
            badge_html = (
                f'<span style="{_MONO}font-size:9px;background:#1a1614;color:#faf8f5;'
                f'padding:2px 7px;border-radius:2px;margin-right:8px;">{badge}</span>'
                if badge else ""
            )
            ann_items += (
                f'<div style="{_SANS}padding:12px 0;border-bottom:1px solid #f0ede8;'
                f'font-size:14px;color:#555;">'
                f'{badge_html}<strong style="color:#1a1614;">{ann.get("title","")}</strong>'
                f' &mdash; {ann.get("content","")}</div>'
            )
        ann_html = (
            f'<div style="margin:24px 0 0 0;">'
            f'<div style="{_MONO}font-size:10px;letter-spacing:0.2em;text-transform:uppercase;'
            f'color:#e84830;margin-bottom:12px;">Announcements</div>'
            f'{ann_items}</div>'
        )

    # Custom content
    custom_html = ""
    if custom_content:
        custom_html = (
            f'<div style="margin:20px 0;padding:18px 22px;background:rgba(232,72,48,0.04);'
            f'border-left:3px solid #e84830;border-radius:2px;">'
            f'<div style="{_MONO}font-size:10px;letter-spacing:0.15em;text-transform:uppercase;'
            f'color:#e84830;margin-bottom:8px;">Message from the team</div>'
            f'<p style="{_SANS}font-size:14px;color:#555;line-height:1.65;margin:0;">{custom_content}</p>'
            f'</div>'
        )

    section_hdr = lambda title, count: (
        f'<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:10px;">'
        f'<tr>'
        f'<td><span style="{_MONO}font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#999;">{title}</span></td>'
        f'<td style="text-align:right;"><span style="{_MONO}font-size:11px;color:#ccc;">{count}</span></td>'
        f'</tr></table>'
        f'<div style="height:1px;background:#e0ddd8;margin-bottom:16px;"></div>'
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AI Ignite &mdash; Learning Digest</title>
</head>
<body style="margin:0;padding:40px 20px;background:#f0ede8;{_SANS}color:#1a1614;">

<div style="max-width:680px;margin:0 auto;">

  <!-- ══ HEADER CARD ══ -->
  <div style="{CARD_STYLE}">
    <div style="{STRIPE_RED}"></div>
    <div style="padding:44px 52px 36px;">
      {_LOGO_HTML}
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:top;">
            <div style="{_MONO}font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#e84830;margin-bottom:12px;">
              AI Ignite Digest &middot; {days}-Day Update{f" &mdash; Issue #{issue_number}" if issue_number else ""}
            </div>
            <h1 style="{_SERIF}font-size:44px;line-height:1.05;color:#1a1614;letter-spacing:-0.02em;margin:0;font-weight:700;">
              Learning<br><em style="color:#e84830;">Digest</em>
            </h1>
          </td>
          <td style="text-align:right;vertical-align:top;padding-left:16px;white-space:nowrap;">
            <div style="{_MONO}font-size:11px;color:#999;letter-spacing:0.12em;">{today}</div>
          </td>
        </tr>
      </table>
      <p style="{_SANS}margin-top:18px;font-size:15px;color:#777;font-weight:300;line-height:1.65;max-width:460px;padding-top:16px;border-top:1px solid #e0ddd8;">
        Your curated update covering new learning sessions, marketplace additions, and articles from the AI Ignite Portal.
      </p>
      {custom_html}
    </div>
    <div style="margin:0 52px 36px;">
      {stats_bar}
    </div>
    {f'<div style="padding:0 52px 36px;">{ann_html}</div>' if ann_html else ''}
  </div>

  <!-- ══ PAGE 1: LEARNING ══ -->
  <div style="{CARD_STYLE}">
    <div style="{STRIPE_RED}"></div>
    <div style="padding:36px 52px;">
      {_page_nav(1)}
      {section_hdr("Learning &mdash; Videos", f"{stats.get('videos','0')} new")}
      {f'<p style="{_SANS}font-size:14px;color:#666;line-height:1.65;margin-bottom:18px;font-style:italic;">{learning_summary}</p>' if learning_summary else ''}
      {_item_cards(learning_items, '#e84830', 'Video')}
    </div>
  </div>

  <!-- ══ PAGE 2: MARKETPLACE ══ -->
  <div style="{CARD_STYLE}">
    <div style="{STRIPE_BLUE}"></div>
    <div style="padding:36px 52px;">
      {_page_nav(2)}
      {section_hdr("Marketplace &mdash; Components &amp; Solutions", f"{int(stats.get('marketplace','0'))+int(stats.get('solutions','0'))} items")}
      {f'<p style="{_SANS}font-size:14px;color:#666;line-height:1.65;margin-bottom:18px;font-style:italic;">{marketplace_summary}</p>' if marketplace_summary else ''}
      {_item_cards(marketplace_items, '#4080ff', 'Component')}
    </div>
  </div>

  <!-- ══ PAGE 3: ARTICLES ══ -->
  <div style="{CARD_STYLE}">
    <div style="{STRIPE_GREEN}"></div>
    <div style="padding:36px 52px;">
      {_page_nav(3)}
      {section_hdr("Articles &amp; Insights", f"{stats.get('articles','0')} new")}
      {f'<p style="{_SANS}font-size:14px;color:#666;line-height:1.65;margin-bottom:18px;font-style:italic;">{articles_summary}</p>' if articles_summary else ''}
      {_item_cards(article_items, '#40c060', 'Article')}
    </div>
  </div>

  <!-- ══ CTA + FOOTER ══ -->
  <div style="{CARD_STYLE}">
    <div style="background:#1a1614;padding:30px 52px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:middle;">
            <div style="{_SERIF}font-size:22px;color:#faf8f5;margin-bottom:5px;">Explore the full portal</div>
            <div style="{_SANS}font-size:13px;color:#777;">Stream, download &amp; share with your team</div>
          </td>
          <td style="text-align:right;vertical-align:middle;padding-left:16px;white-space:nowrap;">
            <a href="{portal_url}"
               style="display:inline-block;background:#e84830;color:#fff;{_MONO}font-size:11px;letter-spacing:0.15em;text-transform:uppercase;text-decoration:none;padding:13px 22px;border-radius:2px;">Open Portal &#8599;</a>
          </td>
        </tr>
      </table>
    </div>
    <div style="padding:22px 52px;border-top:1px solid #e0ddd8;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:top;">
            <div style="{_MONO}font-size:11px;color:#bbb;line-height:1.8;">
              <strong style="color:#777;display:block;">AI Ignite &middot; Internal Portal</strong>
              {days}-day digest &middot; {today}
            </div>
          </td>
          <td style="text-align:right;vertical-align:top;">
            <a href="{portal_url}" style="{_MONO}font-size:11px;color:#bbb;text-decoration:underline;margin-left:16px;">Portal</a>
            <a href="{portal_url}" style="{_MONO}font-size:11px;color:#bbb;text-decoration:underline;margin-left:16px;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </div>
  </div>

</div>
</body>
</html>"""

    return html
