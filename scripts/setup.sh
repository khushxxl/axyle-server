#!/bin/bash

# Setup script for Expo Analytics API

echo "🚀 Setting up Expo Analytics API..."

# Check if .env exists
if [ ! -f .env ]; then
  echo "📝 Creating .env file from .env.example..."
  cp .env.example .env
  echo "⚠️  Please edit .env with your database credentials!"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check if PostgreSQL is available
if command -v psql &> /dev/null; then
  echo "✅ PostgreSQL found"
  echo "💡 To set up database, run:"
  echo "   createdb expo_analytics"
  echo "   psql -d expo_analytics -f migrations/001_initial_schema.sql"
else
  echo "⚠️  PostgreSQL not found. Please install PostgreSQL first."
fi

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your database credentials"
echo "2. Set up PostgreSQL database (see README.md)"
echo "3. Run 'npm run dev' to start the server"

