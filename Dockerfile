# Multi-stage build for complete application
FROM node:18-alpine as frontend-builder

WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps

COPY frontend/ ./
ENV REACT_APP_API_URL=/api
RUN npm run build

# Backend and serving stage
FROM python:3.11-slim

# Install nginx and supervisor
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Setup backend
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/main.py .
RUN mkdir -p input_files cache

# Setup frontend
COPY --from=frontend-builder /app/build /var/www/html
COPY frontend/nginx.prod.conf /etc/nginx/sites-available/default

# Configure supervisor to run both nginx and uvicorn
RUN echo "[supervisord]\n\
nodaemon=true\n\
\n\
[program:nginx]\n\
command=/usr/sbin/nginx -g 'daemon off;'\n\
autostart=true\n\
autorestart=true\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
\n\
[program:backend]\n\
command=uvicorn main:app --host 127.0.0.1 --port 8000 --timeout-keep-alive 300\n\
directory=/app\n\
autostart=true\n\
autorestart=true\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0" > /etc/supervisor/conf.d/supervisord.conf

# Update nginx config to serve from /var/www/html and proxy to localhost
RUN sed -i 's|/usr/share/nginx/html|/var/www/html|g' /etc/nginx/sites-available/default && \
    sed -i 's|proxy_pass http://backend:8000|proxy_pass http://127.0.0.1:8000|g' /etc/nginx/sites-available/default

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]