const express = require('express');
const router = express.Router();
const { getLive, getNew, search } = require('../controllers/liveController');
const { getVehicleStats, getVehicleTypeCount, getVehicleCount } = require('../controllers/statsController');

router.get('/live', getLive);
router.get('/new', getNew);
router.get('/search', search);
router.get('/vehicle-stats', getVehicleStats);
router.get('/vehicle-type-count', getVehicleTypeCount);
router.get('/vehicle-count', getVehicleCount);

module.exports = router;
