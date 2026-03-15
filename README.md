# MST AI Portal

A full-stack learning platform for AI/ML courses with video streaming, chapter marking, and interactive content.

## 🎯 Overview

The MST AI Portal is a modern web application designed to deliver AI/ML educational content through an intuitive interface. It features video transcoding with HLS streaming, interactive chapter marking, progress tracking, and an admin panel for content management.

### Key Features

- **Video Streaming**: HLS adaptive bitrate streaming with multiple quality levels (360p, 720p, 1080p)
- **Chapter System**: Admins can mark chapters with timeline-based video player
- **Progress Tracking**: User progress monitoring across courses and videos
- **Interactive Notes**: Time-stamped notes for videos with rich text support
- **Admin Panel**: Complete content management system
- **Responsive Design**: Modern UI built with React, TypeScript, and TailwindCSS

## 🏗️ Architecture

### Frontend (`react-portal/`)
- **React 19** with TypeScript
- **Vite** for fast development and building
- **TailwindCSS** for styling with dark mode support
- **Material Symbols** for icons
- **hls.js** for HLS video playback
- **React Router** for navigation

### Backend (`api/`)
- **FastAPI** with async/await support
- **PostgreSQL** with asyncpg driver
- **JWT** authentication (bcrypt password hashing)
- **FFmpeg** for video transcoding to HLS
- **Worker process** for background transcoding jobs

### Database (`db/`)
- **PostgreSQL 16** with 15 tables
- **Seed data** for capabilities, courses, and components
- **Migration-ready** with init.sql schema

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** and npm
- **Python 3.10+**
- **PostgreSQL 16**
- **FFmpeg** (for video transcoding)

### 1. Clone and Setup

```bash
git clone <repository-url>
cd mst-ai-portal
```

### 2. Initialize Everything

```bash
./run.sh init
```

### 3. Start All Services

```bash
./run.sh start
```

### Management Script

The project includes a comprehensive management script (`run.sh`) for easy development:

```bash
# Install tab completion (one-time setup)
./install-completion.sh
source ~/.bash_completion  # or restart terminal

# Available commands with tab completion:
./run.sh <TAB>              # Show all commands
./run.sh start              # Start all services
./run.sh stop               # Stop all services  
./run.sh restart            # Restart all services
./run.sh init               # Initialize backend & database
./run.sh ui                 # Start frontend only
./run.sh backend            # Start backend only
./run.sh transcode-worker   # Start transcoder worker only
./run.sh status             # Show service status
./run.sh logs <TAB>         # View logs (backend|frontend|worker)
./run.sh docker-compose ps  # Run docker-compose commands
./run.sh help               # Show help
```

### Manual Setup (Alternative)

If you prefer manual setup instead of the management script:

```bash
# Database Setup
docker-compose up -d
cd db
psql -h localhost -U portal -d mst_portal -f init.sql
cd ..

# Backend Setup
cd api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
mkdir -p storage/videos storage/thumbnails
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
cd ..

# Frontend Setup
cd react-portal
npm install
npm run dev
cd ..

# Start Transcoder Worker
cd api
source venv/bin/activate
python worker/transcoder.py
```

## 🌐 Access Points

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Admin Panel**: http://localhost:5173/admin/videos

### Default Credentials
- **Username**: `admin`
- **Password**: `admin`

## 📁 Project Structure

```
mst-ai-portal/
├── api/                    # FastAPI backend
│   ├── main.py            # Main application entry point
│   ├── config.py          # Configuration settings
│   ├── worker/            # Background worker processes
│   │   └── transcoder.py  # Video transcoding worker
│   ├── auth/              # Authentication handlers
│   ├── video/             # Video management endpoints
│   ├── solutions/         # Solutions API
│   ├── forge/             # Forge components API
│   ├── course/            # Course management
│   └── storage/           # File storage directory
├── react-portal/          # React frontend
│   ├── src/
│   │   ├── components/    # Reusable React components
│   │   │   ├── HlsPlayer.tsx    # HLS video player
│   │   │   ├── Navbar.tsx       # Navigation bar
│   │   │   └── AdminLayout.tsx  # Admin layout wrapper
│   │   ├── pages/         # Page components
│   │   │   ├── Ignite.tsx       # Learning interface
│   │   │   ├── AdminVideos.tsx  # Video management
│   │   │   └── Login.tsx        # Authentication
│   │   ├── api/           # API client utilities
│   │   └── App.tsx        # Main app with routing
│   ├── public/            # Static assets
│   └── package.json       # Dependencies and scripts
├── db/                    # Database
│   ├── init.sql          # Database schema and seed data
│   └── schema.sql        # Schema definition
├── docker-compose.yml     # PostgreSQL service
└── README.md             # This file
```

## 🔧 Configuration

### Backend Configuration (`api/config.py`)

```python
# Authentication
AUTH_MODE = "open"  # or "ldap"
JWT_SECRET_KEY = "your-secret-key"
JWT_ALGORITHM = "HS256"

# Database
DATABASE_URL = "postgresql://portal:portal123@localhost:5432/mst_portal"

# Storage
VIDEO_STORAGE_PATH = "/home/vishwa/mst-ai-portal/api/storage/videos"
THUMBNAIL_STORAGE_PATH = "/home/vishwa/mst-ai-portal/api/storage/thumbnails"
```

### Frontend Environment (`.env`)

```bash
VITE_API_URL=http://localhost:8000
```

## 📊 Features in Detail

### Video Pipeline

1. **Upload**: Admin uploads raw video files through the admin panel
2. **Transcoding**: Background worker converts videos to HLS with multiple quality levels
3. **Streaming**: Videos are served via HLS with adaptive bitrate
4. **Chapter Marking**: Admins can mark chapters using the timeline-based player

### User Experience

- **Course Navigation**: Browse courses and videos with progress tracking
- **Interactive Player**: Full-featured video player with quality selection
- **Note Taking**: Time-stamped notes with rich text support
- **Chapter Navigation**: Jump to specific chapters during playback

### Admin Features

- **Content Management**: Upload, organize, and manage videos
- **Chapter Creation**: Timeline-based chapter marking with visual feedback
- **User Progress**: Monitor learning progress across all users
- **Quality Control**: Manage video quality and transcoding settings

## 🛠️ Development

### Backend Development

```bash
cd api
source venv/bin/activate

# Run with auto-reload
uvicorn main:app --reload

# Run tests
pytest

# Database migrations
psql -h localhost -U portal -d mst_portal -f db/migration.sql
```

### Frontend Development

```bash
cd react-portal

# Development server
npm run dev

# Type checking
npm run type-check

# Build for production
npm run build

# Preview production build
npm run preview
```

### Adding New Features

1. **Backend**: Add new endpoints in appropriate router files
2. **Frontend**: Create components in `src/components/` and pages in `src/pages/`
3. **Database**: Modify `db/init.sql` for schema changes
4. **Styling**: Use TailwindCSS classes with the existing design system

## 🔄 Video Transcoding

The transcoder worker processes videos in the background:

```bash
# Start worker
python worker/transcoder.py

# Monitor worker logs
tail -f worker.log
```

**Transcoding Process:**
1. Worker polls `transcode_jobs` table every 5 seconds
2. Processes pending jobs with FFmpeg
3. Creates HLS streams with 3 quality levels:
   - 360p (800 kbps)
   - 720p (2500 kbps) 
   - 1080p (5000 kbps)
4. Updates video status to 'ready' when complete

## 🐛 Troubleshooting

### Common Issues

**Video stuck on "pending":**
- Ensure transcoder worker is running
- Check worker logs for FFmpeg errors
- Verify storage directory permissions

**Video playback not working:**
- Confirm `/streams/` static files are mounted in FastAPI
- Check HLS files exist in storage directory
- Verify CORS settings if accessing from different domain

**Database connection errors:**
- Ensure PostgreSQL is running
- Check connection string in config.py
- Verify database user permissions

### Logs

- **Backend**: Console output from uvicorn
- **Worker**: Console output from transcoder.py
- **Frontend**: Browser developer console

## 📝 API Documentation

Once the backend is running, visit http://localhost:8000/docs for interactive API documentation.

### Key Endpoints

- `POST /auth/login` - Authentication
- `GET /video/courses` - List courses
- `GET /video/courses/{slug}` - Get course with videos
- `POST /video/videos/{slug}/notes` - Add video notes
- `GET /admin/videos` - Admin video management
- `POST /admin/videos/{id}/upload` - Upload video files

## 🚀 Deployment

### Production Setup

1. **Environment Variables**: Set production values in `.env`
2. **Database**: Use production PostgreSQL instance
3. **Storage**: Configure cloud storage for videos
4. **Worker**: Run transcoder as systemd service
5. **Frontend**: Build and serve with Nginx
6. **Backend**: Run with Gunicorn instead of uvicorn

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up --build
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Support

For support and questions:
- Create an issue in the repository
- Check the API documentation at `/docs`
- Review the troubleshooting section above

---

**Built with ❤️ using React, FastAPI, and PostgreSQL**
