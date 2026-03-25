"""Chart generation utilities for analytics PDF exports."""

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
from datetime import datetime, timedelta
import io
import base64
from typing import List, Dict, Any

# Set matplotlib to use a non-interactive backend
plt.switch_backend('Agg')

# Configure matplotlib for better looking charts
plt.rcParams['figure.dpi'] = 150
plt.rcParams['savefig.dpi'] = 150
plt.rcParams['font.size'] = 10
plt.rcParams['axes.titlesize'] = 12
plt.rcParams['axes.labelsize'] = 10
plt.rcParams['xtick.labelsize'] = 9
plt.rcParams['ytick.labelsize'] = 9
plt.rcParams['legend.fontsize'] = 9
plt.rcParams['figure.titlesize'] = 14

# Color scheme matching the portal
COLORS = {
    'primary': '#4299e1',
    'success': '#48bb78',
    'warning': '#ed8936',
    'danger': '#f56565',
    'purple': '#9f7aea',
    'cyan': '#38b2ac',
    'orange': '#ed8936',
    'indigo': '#667eea',
    'gray': '#718096',
    'light_gray': '#e2e8f0'
}


def generate_daily_traffic_chart(traffic_data: List[Dict[str, Any]]) -> str:
    """Generate daily traffic line chart and return as base64 image."""
    if not traffic_data:
        return generate_empty_chart("No traffic data available")
    
    fig, ax = plt.subplots(figsize=(10, 4))
    
    # Handle both string and date objects
    dates = []
    for d in traffic_data:
        day = d['day']
        if isinstance(day, str):
            dates.append(datetime.strptime(day, '%Y-%m-%d'))
        else:
            # It's already a date object
            dates.append(datetime.combine(day, datetime.min.time()))
    
    views = [d['views'] for d in traffic_data]
    unique_visitors = [d['unique_visitors'] for d in traffic_data]
    
    # Plot lines
    line1 = ax.plot(dates, views, color=COLORS['primary'], linewidth=2, marker='o', markersize=3, label='Views')
    line2 = ax.plot(dates, unique_visitors, color=COLORS['success'], linewidth=2, marker='s', markersize=3, label='Unique Visitors')
    
    # Fill under lines
    ax.fill_between(dates, views, alpha=0.1, color=COLORS['primary'])
    ax.fill_between(dates, unique_visitors, alpha=0.1, color=COLORS['success'])
    
    # Formatting
    ax.set_title('Daily Traffic Overview', fontweight='bold', pad=20)
    ax.set_xlabel('Date')
    ax.set_ylabel('Count')
    ax.legend(loc='upper left')
    ax.grid(True, alpha=0.3)
    
    # Format x-axis
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
    ax.xaxis.set_major_locator(mdates.DayLocator(interval=max(1, len(dates)//10)))
    plt.xticks(rotation=45)
    
    # Set y-axis to start at 0
    ax.set_ylim(bottom=0)
    
    plt.tight_layout()
    return fig_to_base64(fig)


def generate_section_views_chart(section_data: List[Dict[str, Any]]) -> str:
    """Generate section views doughnut chart and return as base64 image."""
    if not section_data:
        return generate_empty_chart("No section data available")
    
    fig, ax = plt.subplots(figsize=(8, 6))
    
    sections = [s['section'].title() for s in section_data]
    views = [s['views'] for s in section_data]
    colors = [COLORS['primary'], COLORS['success'], COLORS['warning'], COLORS['danger'], COLORS['purple'], COLORS['cyan']]
    
    # Create pie chart (doughnut effect)
    wedges, texts, autotexts = ax.pie(views, labels=sections, colors=colors[:len(sections)], 
                                      autopct='%1.1f%%', startangle=90, pctdistance=0.85)
    
    # Create doughnut effect
    centre_circle = plt.Circle((0,0), 0.70, fc='white')
    fig.gca().add_artist(centre_circle)
    
    ax.set_title('Views by Section', fontweight='bold', pad=20)
    
    # Equal aspect ratio ensures that pie is drawn as a circle
    ax.axis('equal')
    
    plt.tight_layout()
    return fig_to_base64(fig)


def generate_daily_likes_chart(likes_data: List[Dict[str, Any]]) -> str:
    """Generate daily likes bar chart and return as base64 image."""
    if not likes_data:
        return generate_empty_chart("No likes data available")
    
    fig, ax = plt.subplots(figsize=(10, 4))
    
    # Handle both string and date objects
    dates = []
    for d in likes_data:
        day = d['day']
        if isinstance(day, str):
            dates.append(datetime.strptime(day, '%Y-%m-%d'))
        else:
            dates.append(datetime.combine(day, datetime.min.time()))
    
    likes = [d['likes'] for d in likes_data]
    
    # Create bars
    bars = ax.bar(dates, likes, color=COLORS['danger'], alpha=0.8, width=0.8)
    
    # Add value labels on bars
    for bar in bars:
        height = bar.get_height()
        if height > 0:
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{int(height)}', ha='center', va='bottom', fontsize=8)
    
    ax.set_title('Daily Video Likes', fontweight='bold', pad=20)
    ax.set_xlabel('Date')
    ax.set_ylabel('Likes')
    ax.grid(True, alpha=0.3, axis='y')
    
    # Format x-axis
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
    ax.xaxis.set_major_locator(mdates.DayLocator(interval=max(1, len(dates)//10)))
    plt.xticks(rotation=45)
    
    # Set y-axis to start at 0 and use integer ticks
    ax.set_ylim(bottom=0)
    ax.yaxis.set_major_locator(plt.MaxNLocator(integer=True))
    
    plt.tight_layout()
    return fig_to_base64(fig)


def generate_daily_installs_chart(installs_data: List[Dict[str, Any]]) -> str:
    """Generate daily installs bar chart and return as base64 image."""
    if not installs_data:
        return generate_empty_chart("No installs data available")
    
    fig, ax = plt.subplots(figsize=(10, 4))
    
    # Handle both string and date objects
    dates = []
    for d in installs_data:
        day = d['day']
        if isinstance(day, str):
            dates.append(datetime.strptime(day, '%Y-%m-%d'))
        else:
            dates.append(datetime.combine(day, datetime.min.time()))
    
    installs = [d['installs'] for d in installs_data]
    
    # Create bars
    bars = ax.bar(dates, installs, color=COLORS['purple'], alpha=0.8, width=0.8)
    
    # Add value labels on bars
    for bar in bars:
        height = bar.get_height()
        if height > 0:
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{int(height)}', ha='center', va='bottom', fontsize=8)
    
    ax.set_title('Daily Component Installs', fontweight='bold', pad=20)
    ax.set_xlabel('Date')
    ax.set_ylabel('Installs')
    ax.grid(True, alpha=0.3, axis='y')
    
    # Format x-axis
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
    ax.xaxis.set_major_locator(mdates.DayLocator(interval=max(1, len(dates)//10)))
    plt.xticks(rotation=45)
    
    # Set y-axis to start at 0 and use integer ticks
    ax.set_ylim(bottom=0)
    ax.yaxis.set_major_locator(plt.MaxNLocator(integer=True))
    
    plt.tight_layout()
    return fig_to_base64(fig)


def generate_activity_heatmap(heatmap_data: List[Dict[str, Any]]) -> str:
    """Generate activity heatmap and return as base64 image."""
    if not heatmap_data:
        return generate_empty_chart("No heatmap data available")
    
    fig, ax = plt.subplots(figsize=(12, 6))
    
    # Create 7x24 grid (days x hours)
    days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    hours = list(range(24))
    
    # Initialize grid with zeros
    grid = np.zeros((7, 24))
    
    # Fill grid with data
    for d in heatmap_data:
        dow = int(d['dow'])  # 0=Sunday, 6=Saturday
        hour = int(d['hour'])
        views = int(d['views'])
        if 0 <= dow < 7 and 0 <= hour < 24:
            grid[dow, hour] = views
    
    # Create heatmap
    im = ax.imshow(grid, cmap='RdYlGn_r', aspect='auto', interpolation='nearest')
    
    # Set ticks and labels
    ax.set_xticks(range(24))
    ax.set_xticklabels([str(h) for h in hours], fontsize=8)
    ax.set_yticks(range(7))
    ax.set_yticklabels(days, fontsize=9)
    
    ax.set_xlabel('Hour of Day', fontsize=10)
    ax.set_ylabel('Day of Week', fontsize=10)
    ax.set_title('Activity Heatmap (Day × Hour)', fontweight='bold', pad=20)
    
    # Add colorbar
    cbar = plt.colorbar(im, ax=ax, shrink=0.8)
    cbar.set_label('Views', fontsize=9)
    cbar.ax.tick_params(labelsize=8)
    
    # Add grid
    ax.set_xticks(np.arange(-0.5, 24, 1), minor=True)
    ax.set_yticks(np.arange(-0.5, 7, 1), minor=True)
    ax.grid(which='minor', color='white', linestyle='-', linewidth=0.5, alpha=0.3)
    
    plt.tight_layout()
    return fig_to_base64(fig)


def generate_empty_chart(message: str = "No data available") -> str:
    """Generate an empty chart with a message."""
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.text(0.5, 0.5, message, horizontalalignment='center', verticalalignment='center',
            transform=ax.transAxes, fontsize=12, color=COLORS['gray'])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis('off')
    plt.tight_layout()
    return fig_to_base64(fig)


def fig_to_base64(fig) -> str:
    """Convert matplotlib figure to base64 string."""
    buffer = io.BytesIO()
    fig.savefig(buffer, format='png', bbox_inches='tight', facecolor='white')
    buffer.seek(0)
    image_base64 = base64.b64encode(buffer.getvalue()).decode()
    plt.close(fig)
    return f"data:image/png;base64,{image_base64}"
