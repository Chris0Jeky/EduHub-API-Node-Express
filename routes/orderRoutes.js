const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { orderValidationRules, paginationValidationRules, validate } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');

// Route to create a new order
router.post('/',
    orderValidationRules.createOrder,
    validate,
    asyncHandler(orderController.createOrder)
);

// Route to get order statistics (must be before /:id)
router.get('/stats/overview',
    asyncHandler(orderController.getOrderStats)
);

// Route to get all orders (admin)
router.get('/',
    paginationValidationRules,
    orderValidationRules.getOrders,
    validate,
    asyncHandler(orderController.getAllOrders)
);

// Route to get order by ID
router.get('/:id',
    asyncHandler(orderController.getOrderById)
);

module.exports = router;