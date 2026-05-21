import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  recordSpoilageHandler,
  getSpoilageHandler,
  listSpoilageHandler,
  getSpoilageSummaryHandler,
  getSpoilageAnalyticsHandler,
  updateSpoilageHandler,
  deleteSpoilageHandler,
} from '#controllers/spoiledStock.controller.js';

const router = express.Router();

router.use(authenticateToken);

// POST /api/spoiled-stock/record
// NOTE: revenueGuard removed — spoilage recording is free
router.post('/record', recordSpoilageHandler);

router.get('/:businessId/summary', getSpoilageSummaryHandler);
router.get('/:businessId/analytics', getSpoilageAnalyticsHandler);
router.get('/:businessId/:spoilageId', getSpoilageHandler);
router.get('/:businessId', listSpoilageHandler);
router.patch('/:businessId/:spoilageId', updateSpoilageHandler);
router.delete('/:businessId/:spoilageId', deleteSpoilageHandler);

export default router;
