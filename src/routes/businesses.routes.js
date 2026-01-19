import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  createBusiness,
  listMyBusinesses,
  getMyBusinessById,
  updateMyBusiness,
} from '#controllers/businesses.controller.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createBusiness);
router.get('/', listMyBusinesses);
router.get('/:id', getMyBusinessById);
router.put('/:id', updateMyBusiness);

export default router;
