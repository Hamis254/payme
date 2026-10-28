import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { validateBusinessId } from '#middleware/businessId.middleware.js';
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
router.post('/record', validateBusinessId('body'), recordSpoilageHandler);

router.get('/:businessId/summary', validateBusinessId('params'), getSpoilageSummaryHandler);
router.get('/:businessId/analytics', validateBusinessId('params'), getSpoilageAnalyticsHandler);
router.get('/:businessId/:spoilageId', validateBusinessId('params'), getSpoilageHandler);
router.get('/:businessId', validateBusinessId('params'), listSpoilageHandler);
router.patch('/:businessId/:spoilageId', validateBusinessId('params'), updateSpoilageHandler);
router.delete('/:businessId/:spoilageId', validateBusinessId('params'), deleteSpoilageHandler);

export default router;
