// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { MongoClient } = require('mongodb');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy for Render deployment
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet());

// Compression middleware
app.use(compression());

// Request logging
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// CORS configuration
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://chris0jeky.github.io', 'https://your-github-pages-url.github.io'] // Add your actual URLs
        : true,
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file middleware for images with caching
app.use('/images', express.static('images', {
    maxAge: '1d', // Cache images for 1 day
    fallthrough: false,
}));

// API Routes
const lessonRoutes = require('./routes/lessonRoutes');
const orderRoutes = require('./routes/orderRoutes');

app.use('/api/lessons', lessonRoutes);
app.use('/api/orders', orderRoutes);

// API documentation route
app.get('/api', (req, res) => {
    res.json({
        name: 'AfterSchool Lessons API',
        version: '2.0.0',
        description: 'RESTful API for managing after-school lessons and student enrollments',
        endpoints: {
            lessons: {
                'GET /api/lessons': 'Get all lessons with optional filtering and sorting',
                'GET /api/lessons/:id': 'Get a specific lesson by ID',
                'PUT /api/lessons/:id': 'Update lesson details'
            },
            orders: {
                'POST /api/orders': 'Create a new order',
                'GET /api/orders': 'Get all orders (admin)'
            }
        },
        documentation: '/api/docs'
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        status: 'fail',
        message: `Cannot find ${req.originalUrl} on this server`
    });
});

// Global error handling middleware
app.use(errorHandler);

// MongoDB connection with retry logic
const connectWithRetry = async () => {
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            const client = await MongoClient.connect(process.env.MONGODB_URI, {
                useUnifiedTopology: true,
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
            });

            const db = client.db();
            // Must exist before accepting keyed requests; duplicate keys are transaction conflicts.
            await db.collection('orders').createIndex({ checkoutKey: 1 }, { unique: true, sparse: true });
            console.log('✅ Connected to MongoDB Atlas');

            // Store db in app.locals for access in routes/controllers
            app.locals.db = db;
            app.locals.client = client;

            // Graceful shutdown
            process.on('SIGINT', async () => {
                console.log('\n🛑 Shutting down gracefully...');
                await client.close();
                process.exit(0);
            });

            return db;
        } catch (err) {
            retries++;
            console.error(`❌ MongoDB connection attempt ${retries} failed:`, err.message);
            if (retries < maxRetries) {
                console.log(`⏳ Retrying in 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                console.error('❌ Failed to connect to MongoDB after maximum retries');
                process.exit(1);
            }
        }
    }
};

// Start server after database connection
connectWithRetry().then(() => {
    app.listen(port, () => {
        console.log(`🚀 Server running at http://localhost:${port}`);
        console.log(`📝 API documentation available at http://localhost:${port}/api`);
        console.log(`🏥 Health check available at http://localhost:${port}/api/health`);
    });
});