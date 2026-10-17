const { ObjectId } = require('mongodb');
const { getLessonsCollection } = require('../models/lessonModel');
const { AppError } = require('../middleware/errorHandler');

// Controller function to get all lessons with advanced filtering
async function getAllLessons(req, res) {
    const db = req.app.locals.db;
    const lessonsCollection = getLessonsCollection(db);

    // Extract query parameters
    const { 
        search, 
        sortBy = 'topic', 
        order = 'asc',
        minPrice,
        maxPrice,
        minSpaces,
        topic,
        location,
        page = 1,
        limit = 20
    } = req.query;

    // Build filter object
    let filter = {};

    // Topic and location filters
    if (topic) filter.topic = topic;
    if (location) filter.location = location;

    // Price range filter
    if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = parseFloat(minPrice);
        if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    // Available spaces filter (handle both 'spaces' and 'space' fields)
    if (minSpaces) {
        filter.$and = [{ $or: [
            { spaces: { $gte: parseInt(minSpaces) } },
            { space: { $gte: parseInt(minSpaces) } }
        ] }];
    }

    // Search filter (searches across multiple fields)
    if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [
            { topic: searchRegex },
            { location: searchRegex },
            { description: searchRegex }
        ];
    }

    // Sorting
    const sortOptions = {
        [sortBy]: order === 'desc' ? -1 : 1
    };

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    try {
        // Get total count for pagination
        const totalCount = await lessonsCollection.countDocuments(filter, { maxTimeMS: 1000 });

        // Fetch lessons with pagination
        const lessons = await lessonsCollection
            .find(filter, { maxTimeMS: 1000 })
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit))
            .toArray();

        // Add additional computed fields and normalize space/spaces field
        const enhancedLessons = lessons.map(lesson => {
            const availableSpaces = lesson.spaces !== undefined ? lesson.spaces : (lesson.space || 0);
            return {
                ...lesson,
                spaces: availableSpaces,  // Normalize to 'spaces'
                space: availableSpaces,   // Keep 'space' for backward compatibility
                available: availableSpaces > 0,
                imageUrl: `/images/${lesson.image || 'default.gif'}`
            };
        });

        res.json({
            status: 'success',
            data: {
                lessons: enhancedLessons,
                pagination: {
                    total: totalCount,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(totalCount / parseInt(limit))
                }
            }
        });
    } catch (err) {
        throw new AppError('Failed to fetch lessons', 500);
    }
}

// Get single lesson by ID
async function getLessonById(req, res) {
    const db = req.app.locals.db;
    const lessonsCollection = getLessonsCollection(db);
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        throw new AppError('Invalid lesson ID format', 400);
    }

    try {
        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });

        if (!lesson) {
            throw new AppError('Lesson not found', 404);
        }

        const availableSpaces = lesson.spaces !== undefined ? lesson.spaces : (lesson.space || 0);
        res.json({
            status: 'success',
            data: {
                lesson: {
                    ...lesson,
                    spaces: availableSpaces,  // Normalize to 'spaces'
                    space: availableSpaces,   // Keep 'space' for backward compatibility
                    available: availableSpaces > 0,
                    imageUrl: `/images/${lesson.image || 'default.gif'}`
                }
            }
        });
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Failed to fetch lesson', 500);
    }
}

// Update lesson
async function updateLesson(req, res) {
    const db = req.app.locals.db;
    const lessonsCollection = getLessonsCollection(db);
    const { id } = req.params;
    const updateData = req.body;

    if (!ObjectId.isValid(id)) {
        throw new AppError('Invalid lesson ID format', 400);
    }

    // Remove undefined fields
    Object.keys(updateData).forEach(key => 
        updateData[key] === undefined && delete updateData[key]
    );

    // Handle both 'space' and 'spaces' fields
    if (updateData.space !== undefined && updateData.spaces === undefined) {
        updateData.spaces = updateData.space;
    } else if (updateData.spaces !== undefined && updateData.space === undefined) {
        updateData.space = updateData.spaces;
    }

    if (Object.keys(updateData).length === 0) {
        throw new AppError('No valid update data provided', 400);
    }

    try {
        const result = await lessonsCollection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new AppError('Lesson not found', 404);
        }

        res.json({
            status: 'success',
            message: 'Lesson updated successfully',
            data: {
                lesson: result
            }
        });
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Failed to update lesson', 500);
    }
}

// Get lesson statistics
async function getLessonStats(req, res) {
    const db = req.app.locals.db;
    const lessonsCollection = getLessonsCollection(db);

    try {
        const stats = await lessonsCollection.aggregate([
            {
                $group: {
                    _id: null,
                    totalLessons: { $sum: 1 },
                    totalSpaces: { $sum: '$spaces' },
                    avgPrice: { $avg: '$price' },
                    minPrice: { $min: '$price' },
                    maxPrice: { $max: '$price' },
                    lessonsWithSpaces: {
                        $sum: { $cond: [{ $gt: ['$spaces', 0] }, 1, 0] }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalLessons: 1,
                    totalSpaces: 1,
                    avgPrice: { $round: ['$avgPrice', 2] },
                    minPrice: 1,
                    maxPrice: 1,
                    lessonsWithSpaces: 1,
                    percentageAvailable: {
                        $round: [
                            { $multiply: [
                                { $divide: ['$lessonsWithSpaces', '$totalLessons'] },
                                100
                            ]},
                            2
                        ]
                    }
                }
            }
        ]).toArray();

        // Get lessons by topic
        const byTopic = await lessonsCollection.aggregate([
            {
                $group: {
                    _id: '$topic',
                    count: { $sum: 1 },
                    totalSpaces: { $sum: '$spaces' },
                    avgPrice: { $avg: '$price' }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]).toArray();

        res.json({
            status: 'success',
            data: {
                overview: stats[0] || {},
                byTopic: byTopic
            }
        });
    } catch (err) {
        throw new AppError('Failed to fetch lesson statistics', 500);
    }
}

module.exports = {
    getAllLessons,
    getLessonById,
    updateLesson,
    getLessonStats
};