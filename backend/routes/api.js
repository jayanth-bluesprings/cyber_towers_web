const express = require('express');
const router = express.Router();
const { getLive, getNew, search, getAuthorizedVehicles } = require('../controllers/liveController');
const { getVehicleStats, getVehicleTypeCount, getVehicleCount, getEventCounts } = require('../controllers/statsController');
const { getDebug, getReportSummary, getReportRecords, getVehicleOccupancy, trigger24hAlert } = require('../controllers/reportcontroller');

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
router.get('/alerts/trigger-24h', trigger24hAlert);
router.get('/health/events', getEventCounts);

module.exports = router;
