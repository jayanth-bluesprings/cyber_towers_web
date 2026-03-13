const express = require('express');
const router = express.Router();
const { getLive, getNew, search, getAuthorizedVehicles } = require('../controllers/liveController');
const { getVehicleStats, getVehicleTypeCount, getVehicleCount } = require('../controllers/statsController');
const { getDebug, getReportSummary, getReportRecords, getVehicleOccupancy } = require('../controllers/reportController');

router.get('/live', getLive);
router.get('/new', getNew);
router.get('/search', search);
router.get('/authorized-vehicles', getAuthorizedVehicles);
router.get('/vehicle-stats', getVehicleStats);
router.get('/vehicle-type-count', getVehicleTypeCount);
router.get('/vehicle-count', getVehicleCount);
router.get('/report/debug', getDebug);
router.get('/report/summary', getReportSummary);
router.get('/report/records', getReportRecords);
router.get('/report/occupancy', getVehicleOccupancy);

module.exports = router;
