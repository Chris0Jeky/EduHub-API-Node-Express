const { body, param, query, validationResult } = require('express-validator');
const { AppError } = require('./errorHandler');

// Validation middleware
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(error => error.msg).join(', ');
        return next(new AppError(errorMessages, 400));
    }
    next();
};

const paginationValidationRules = [
    query('page').optional().custom(value =>
        typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= 10001
    ).withMessage('Page must be an integer between 1 and 10001'),
    query('limit').optional().custom(value =>
        typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= 100
    ).withMessage('Limit must be an integer between 1 and 100'),
    query('page').custom((value, { req }) =>
        (Number(value ?? 1) - 1) * Number(req.query.limit ?? 20) <= 10000
    ).withMessage('Pagination offset must not exceed 10000')
];

// Lesson validation rules
const lessonUpdateFields = new Set([
    'topic', 'location', 'price', 'space', 'spaces', 'description', 'image'
]);

const lessonValidationRules = {
    updateLesson: [
        param('id').isMongoId().withMessage('Invalid lesson ID'),
        body().custom(value => value !== null && typeof value === 'object'
            && !Array.isArray(value)
            && Object.keys(value).every(field => lessonUpdateFields.has(field)))
            .withMessage('Lesson updates must contain only supported fields'),
        body('spaces').optional().isInt({ min: 0 }).withMessage('Spaces must be a non-negative integer'),
        body('space').optional().isInt({ min: 0 }).withMessage('Space must be a non-negative integer'),
        body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('topic').optional().isString().trim().notEmpty().withMessage('Topic cannot be empty'),
        body('location').optional().isString().trim().notEmpty().withMessage('Location cannot be empty')
    ],
    
    getLessons: [
        query('topic').optional().isString(),
        query('location').optional().isString(),
        query('search').optional().isString().bail()
            .isLength({ max: 200 }).withMessage('Search must not exceed 200 characters')
            .not().contains('\0').withMessage('Search must not contain null bytes').trim(),
        query('sortBy').optional().isIn(['topic', 'location', 'price', 'spaces']).withMessage('Invalid sort field'),
        query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be asc or desc'),
        query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be positive'),
        query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be positive'),
        query('minSpaces').optional().isString().bail()
            .isInt({ min: 0, max: Number.MAX_SAFE_INTEGER }).withMessage('Min spaces must be a non-negative safe integer')
    ]
};

// Order validation rules
const orderValidationRules = {
    getOrders: [
        query('status').optional().isString(),
        query('paymentStatus').optional().isString()
    ],
    createOrder: [
        body('name').isString().trim().notEmpty().withMessage('Name is required')
            .matches(/^[a-zA-Z\s]+$/).withMessage('Name must contain only letters and spaces'),
        body('phone').isString().trim().notEmpty().withMessage('Phone is required')
            .matches(/^[\d\s\-\+\(\)]+$/).withMessage('Invalid phone format'),
        body('lessons').isArray({ min: 1 }).withMessage('At least one lesson is required'),
        body('lessons.*.lessonId').isMongoId().withMessage('Invalid lesson ID'),
        body('lessons.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
    ]
};

module.exports = {
    validate,
    paginationValidationRules,
    lessonValidationRules,
    orderValidationRules
};
