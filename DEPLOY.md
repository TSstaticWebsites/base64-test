# Deployment Guide

## DigitalOcean App Platform Deployment

### Prerequisites
1. Push your code to a GitHub repository
2. Have a DigitalOcean account
3. Update the GitHub repo URL in `.do/app.yaml`

### Steps to Deploy

1. **Update Configuration**
   - Edit `.do/app.yaml` and replace `your-username` with your actual GitHub username
   - Ensure your GitHub repo is public or connected to DigitalOcean

2. **One-Click Deploy**
   - Click the "Deploy to DigitalOcean" button in README.md
   - Or manually create a new app at https://cloud.digitalocean.com/apps/new
   - Connect your GitHub repo: `https://github.com/YOUR_USERNAME/browser-base64-decoding`

3. **Configuration**
   The app will automatically:
   - Deploy the backend Python service on port 8000
   - Deploy the frontend React app on port 3000
   - Configure CORS between frontend and backend
   - Set up environment variables

### App Structure
- **Backend Service**: FastAPI server for file processing and chunking
- **Frontend Service**: React app served with static file server
- **Environment Variables**: 
  - `REACT_APP_API_URL`: Automatically set to backend URL
  - `PORT`: Set to appropriate ports for each service

### Costs
- Basic XXS instances: ~$5/month per service
- Total estimated cost: ~$10/month for both services

### Manual Deployment (Alternative)

If you prefer manual deployment:

1. **Create App**: Go to DigitalOcean Apps dashboard
2. **Connect Repo**: Link your GitHub repository
3. **Configure Services**:
   - Backend: Python app, source dir `/backend`, run command `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Frontend: Node.js app, source dir `/frontend`, build then serve static files
4. **Set Environment Variables**: 
   - Frontend needs `REACT_APP_API_URL` pointing to backend URL

### Testing Your Deployment

1. Access your deployed frontend URL
2. Upload a test file to the `backend/input_files/` folder (you'll need to do this via backend interface)
3. Test the browser base64 decoding functionality
4. Monitor performance metrics

### Troubleshooting

- **Frontend can't connect to backend**: Check CORS settings and environment variables
- **Build failures**: Verify Node.js and Python versions match requirements
- **File upload issues**: Ensure input_files directory is writable
- **Performance issues**: Consider upgrading instance sizes for larger files

### Production Considerations

1. **File Storage**: Current setup stores files in memory - consider persistent storage for production
2. **Security**: Add authentication and input validation
3. **Scaling**: Monitor resource usage and scale instances as needed
4. **Monitoring**: Set up alerts for performance and errors