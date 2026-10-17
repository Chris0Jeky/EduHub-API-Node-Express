const express = require('express');
const router = express.Router();
const lessonController = require('../controllers/lessonController');
const { lessonValidationRules, paginationValidationRules, validate } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');

// Route to get all lessons with advanced filtering
router.get('/', 
    paginationValidationRules,
    lessonValidationRules.getLessons,
    validate,
    asyncHandler(lessonController.getAllLessons)
);

// Route to get lesson statistics (must be before /:id)
router.get('/stats/overview',
    asyncHandler(lessonController.getLessonStats)
);

// Route to get a single lesson by ID
router.get('/:id',
    asyncHandler(lessonController.getLessonById)
);

// Route to update a lesson by ID
router.put('/:id',
    lessonValidationRules.updateLesson,
    validate,
    asyncHandler(lessonController.updateLesson)
);

module.exports = router;